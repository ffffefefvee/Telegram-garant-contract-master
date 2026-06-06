// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title Escrow
 * @notice Дочерний escrow контракт для отдельной сделки
 * @dev Создаётся фабрикой. Каждый адрес уникален для одной сделки.
 */
contract Escrow {
    using SafeERC20 for IERC20;

    enum Status { CREATED, FUNDED, RELEASED, REFUNDED, DISPUTED, RESOLVED }
    
    Status public status;
    
    address public immutable factory;
    address public immutable buyer;
    address public immutable seller;
    address public immutable arbitrator;
    address public immutable token;
    uint256 public immutable dealId; // bytes32 deal ID из базы данных
    
    uint256 public amount;
    uint256 public buyerFee;
    uint256 public sellerFee;
    uint256 public arbitratorFee;
    
    address public platformWallet;
    uint256 public platformFeePercent = 500; // 5% = 500 базисных пунктов
    
    event Funded(uint256 amount);
    event Released(address to, uint256 amount);
    event Refunded(address to, uint256 amount);
    event Disputed();
    event Resolved(address buyerShare, address sellerShare);
    event FeeUpdated(uint256 platformFeePercent);
    
    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory");
        _;
    }
    
    modifier onlyParties() {
        require(msg.sender == buyer || msg.sender == seller || msg.sender == arbitrator, "Only parties");
        _;
    }
    
    constructor(
        address _factory,
        address _buyer,
        address _seller,
        address _arbitrator,
        address _token,
        bytes32 _dealId
    ) {
        factory = _factory;
        buyer = _buyer;
        seller = _seller;
        arbitrator = _arbitrator;
        token = _token;
        dealId = _dealId;
        status = Status.CREATED;
    }
    
    /**
     * @notice Принять USDT платёж. Вызывается после transferFrom подтверждения.
     */
    function fund(uint256 _amount) external onlyFactory {
        require(status == Status.CREATED, "Already funded or closed");
        require(_amount > 0, "Amount must be > 0");
        
        amount = _amount;
        
        // Расчёт комиссий
        platformFeePercent = 500; // 5%
        buyerFee = (_amount * platformFeePercent) / 10000;
        sellerFee = _amount - buyerFee;
        arbitratorFee = 0; // Будет установлен позже при dispute
        
        status = Status.FUNDED;
        
        emit Funded(_amount);
    }
    
    /**
     * @notice Освободить средства продавцу (после подтверждения покупателем)
     */
    function release() external onlyParties {
        require(status == Status.FUNDED, "Not funded or already closed");
        
        // Отправляем sellerFee продавцу
        if (sellerFee > 0) {
            IERC20(token).safeTransfer(seller, sellerFee);
        }
        // platformFee уходит на factory
        if (buyerFee > 0) {
            IERC20(token).safeTransfer(factory, buyerFee);
        }
        
        status = Status.RELEASED;
        
        emit Released(seller, sellerFee);
    }
    
    /**
     * @notice Вернуть средства покупателю (возврат)
     */
    function refund() external onlyParties {
        require(status == Status.FUNDED || status == Status.DISPUTED, "Not funded or already closed");
        
        uint256 refundAmount = amount;
        
        IERC20(token).safeTransfer(buyer, refundAmount);
        
        status = Status.REFUNDED;
        
        emit Refunded(buyer, refundAmount);
    }
    
    /**
     * @notice Открыть спор
     */
    function dispute() external onlyParties {
        require(status == Status.FUNDED, "Not funded");
        
        status = Status.DISPUTED;
        
        emit Disputed();
    }
    
    /**
     * @notice Арбитр распределяет средства после спора
     * @param buyerPercent Доля покупателя (0-100)
     */
    function resolve(uint256 buyerPercent) external {
        require(msg.sender == arbitrator, "Only arbitrator");
        require(status == Status.DISPUTED, "Not disputed");
        require(buyerPercent <= 100, "Invalid percent");
        
        uint256 buyerShare = (amount * buyerPercent) / 100;
        uint256 sellerShare = amount - buyerShare;
        
        if (buyerShare > 0) {
            IERC20(token).safeTransfer(buyer, buyerShare);
        }
        if (sellerShare > 0) {
            IERC20(token).safeTransfer(seller, sellerShare);
        }
        
        status = Status.RESOLVED;
        
        emit Resolved(buyer, seller);
    }
    
    /**
     * @notice Получить баланс токенов на контракте
     */
    function getBalance() external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
    
    /**
     * @notice Проверить, открыт ли спор
     */
    function isDisputed() external view returns (bool) {
        return status == Status.DISPUTED;
    }
}