// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./EscrowContract.sol";

/**
 * @title EscrowFactory
 * @dev Создает уникальные смарт-контракты для каждой сделки.
 * Это позволяет изолировать средства каждой сделки и привязать их к dealId.
 */
contract EscrowFactory {
    address public owner;
    address public arbitratorPool;

    // Mapping dealId => EscrowContract Address
    mapping(string => address) public dealEscrows;
    
    event EscrowCreated(string dealId, address escrowAddress, address buyer, address seller, uint256 amount);

    constructor(address _arbitratorPool) {
        owner = msg.sender;
        arbitratorPool = _arbitratorPool;
    }

    /**
     * @dev Создает новый контракт эскроу для сделки
     * @param dealId ID сделки в базе данных
     * @param buyer Адрес покупателя (или мультисиг платформы)
     * @param seller Адрес продавца
     * @param amount Сумма сделки (в минимальных единицах токена, напр. 6 знаков для USDT)
     * @param tokenAddress Адрес токена (напр. USDT в Polygon)
     */
    function createEscrow(
        string memory dealId,
        address buyer,
        address seller,
        address arbitrator,
        uint256 amount,
        address tokenAddress
    ) external returns (address) {
        require(dealEscrows[dealId] == address(0), "Escrow already exists");
        require(amount > 0, "Amount must be > 0");

        // Деплой нового контракта
        EscrowContract newEscrow = new EscrowContract(
            dealId,
            buyer,
            seller,
            arbitrator,
            amount,
            tokenAddress,
            address(this)
        );

        // Сохраняем адрес
        dealEscrows[dealId] = address(newEscrow);

        emit EscrowCreated(dealId, address(newEscrow), buyer, seller, amount);

        return address(newEscrow);
    }

    /**
     * @dev Получить адрес эскроу по ID сделки
     */
    function getEscrow(string memory dealId) external view returns (address) {
        return dealEscrows[dealId];
    }

    /**
     * @dev Обновить адрес пула арбитров (админка)
     */
    function setArbitratorPool(address _pool) external {
        require(msg.sender == owner, "Only owner");
        arbitratorPool = _pool;
    }
}
