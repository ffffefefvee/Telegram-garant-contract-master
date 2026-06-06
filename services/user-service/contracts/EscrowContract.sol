// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title EscrowContract
 * @dev Индивидуальный контракт для каждой сделки.
 * Принимает USDT от Cryptomus, хранит их и распределяет по решению сторон или арбитра.
 */
contract EscrowContract {
    using SafeERC20 for IERC20;

    // Deal Details
    string public dealId;
    address public buyer;
    address public seller;
    address public arbitrator;
    uint256 public amount;
    IERC20 public token;

    // Status: 0=Pending, 1=Funded, 2=Completed, 3=Disputed, 4=Refunded, 5=Arbitrated
    uint8 public status;

    // Factory Address
    address public factory;

    // Events
    event Funded(string dealId, uint256 amount);
    event Released(string dealId, address to);
    event Refunded(string dealId, address to);
    event DisputeOpened(string dealId, address by);
    event DisputeResolved(string dealId, uint8 decision);

    /**
     * @dev Конструктор эскроу
     */
    constructor(
        string memory _dealId,
        address _buyer,
        address _seller,
        address _arbitrator,
        uint256 _amount,
        address _tokenAddress,
        address _factory
    ) {
        dealId = _dealId;
        buyer = _buyer;
        seller = _seller;
        arbitrator = _arbitrator;
        amount = _amount;
        token = IERC20(_tokenAddress);
        factory = _factory;
        status = 0; // Pending
    }

    /**
     * @dev Подтверждение поступления средств.
     * Вызывается бэкендом после получения вебхука от Cryptomus о зачислении токенов.
     */
    function confirmFunding() external {
        require(status == 0, "Already funded or processed");
        require(token.balanceOf(address(this)) >= amount, "Insufficient funds");
        
        status = 1;
        emit Funded(dealId, amount);
    }

    /**
     * @dev Покупатель подтверждает получение товара -> Деньги уходят продавцу.
     */
    function releaseToSeller() external {
        require(status == 1, "Not funded");
        require(msg.sender == buyer, "Only buyer");
        
        status = 2;
        token.safeTransfer(seller, amount);
        emit Released(dealId, seller);
    }

    /**
     * @dev Продавец соглашается вернуть деньги (если товар не отправлен).
     */
    function refundToBuyer() external {
        require(status == 1, "Not funded");
        require(msg.sender == seller, "Only seller");
        
        status = 4;
        token.safeTransfer(buyer, amount);
        emit Refunded(dealId, buyer);
    }

    /**
     * @dev Открытие спора любой из сторон.
     */
    function openDispute() external {
        require(status == 1, "Not funded");
        require(msg.sender == buyer || msg.sender == seller, "Not a party");
        
        status = 3;
        emit DisputeOpened(dealId, msg.sender);
    }

    /**
     * @dev Решение арбитра.
     * @param decision 0 = Продавец выиграл (получает всё), 
     *                 1 = Покупатель выиграл (полный возврат),
     *                 2 = Компромисс (50/50).
     */
    function resolveDispute(uint8 decision) external {
        require(status == 3, "Not disputed");
        require(msg.sender == arbitrator, "Only arbitrator");

        status = 5;

        if (decision == 0) {
            // Продавец выиграл -> получает всё
            token.safeTransfer(seller, amount);
            emit Released(dealId, seller);
        } else if (decision == 1) {
            // Покупатель выиграл -> возврат
            token.safeTransfer(buyer, amount);
            emit Refunded(dealId, buyer);
        } else {
            // Компромисс -> 50/50
            uint256 half = amount / 2;
            token.safeTransfer(seller, half);
            token.safeTransfer(buyer, amount - half);
            emit DisputeResolved(dealId, 2);
        }
    }
}
