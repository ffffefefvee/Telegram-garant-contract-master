// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Escrow.sol";

/**
 * @title EscrowFactory
 * @notice Фабрика для создания escrow контрактов по сделкам
 * @dev Каждая сделка получает уникальный адрес escrow
 */
contract EscrowFactory {
    event EscrowCreated(
        address indexed escrow,
        bytes32 indexed dealId,
        address buyer,
        address seller,
        address arbitrator,
        address token
    );
    
    event FeeUpdated(uint256 newFeePercent);
    event PlatformWalletUpdated(address newWallet);
    event TokenAdded(address token, bool allowed);
    
    // Настройки
    uint256 public platformFeePercent = 500; // 5 базисных пунктов = 5%
    address public platformWallet;
    
    // Маппинг dealId -> escrow адрес
    mapping(bytes32 => address) public escrows;
    
    // Маппинг dealId -> проверенный статус
    mapping(bytes32 => bool) public verifiedDeals;
    
    // Список активных escrow
    address[] public activeEscrows;
    
    // Разрешённые токены (USDT на разных сетях)
    mapping(address => bool) public allowedTokens;
    
    // Адрес контракта escrow для клонирования
    address public escrowImplementation;
    
    /**
     * @notice Конструктор
     * @param _platformWallet Кошелёк для сбора комиссий
     */
    constructor(address _platformWallet) {
        platformWallet = _platformWallet;
        
        // Добавляем USDT на основных сетях
        allowedTokens[address(0)] = true; // Native token
    }
    
    /**
     * @notice Создать новый escrow для сделки
     * @param dealId ID сделки в базе данных (string hashed to bytes32)
     * @param buyer Адрес покупателя
     * @param seller Адрес продавца
     * @param arbitrator Адрес арбитра (0 если не назначен)
     * @param token Адрес токена (USDT)
     * @param amount Сумма в wei (для USDT с 6 decimals)
     * @return address Адрес созданного escrow контракта
     */
    function createEscrow(
        bytes32 dealId,
        address buyer,
        address seller,
        address arbitrator,
        address token,
        uint256 amount
    ) external returns (address) {
        require(escrows[dealId] == address(0), "Escrow already exists");
        require(amount > 0, "Amount must be > 0");
        
        // Создаём новый escrow через клонирование
        Escrow escrow = new Escrow(
            address(this),
            buyer,
            seller,
            arbitrator,
            token,
            dealId
        );
        
        escrows[dealId] = address(escrow);
        activeEscrows.push(address(escrow));
        
        emit EscrowCreated(address(escrow), dealId, buyer, seller, arbitrator, token);
        
        return address(escrow);
    }
    
    /**
     * @notice Получить адрес escrow по dealId
     * @param dealId ID сделки
     * @return address Адрес escrow или address(0)
     */
    function getEscrow(bytes32 dealId) external view returns (address) {
        return escrows[dealId];
    }
    
    /**
     * @notice Проверить существование escrow
     */
    function escrowExists(bytes32 dealId) external view returns (bool) {
        return escrows[dealId] != address(0);
    }
    
    /**
     * @notice Получить количество активных escrow
     */
    function getActiveEscrowCount() external view returns (uint256) {
        return activeEscrows.length;
    }
    
    /**
     * @notice Получить информацию об escrow
     */
    function getEscrowInfo(bytes32 dealId) external view returns (
        address escrow,
        address buyer,
        address seller,
        address arbitrator,
        uint256 amount,
        uint8 status
    ) {
        Escrow e = Escrow(escrows[dealId]);
        if (address(e) == address(0)) {
            return (address(0), address(0), address(0), address(0), 0, 0);
        }
        
        return (
            address(e),
            e.buyer(),
            e.seller(),
            e.arbitrator(),
            e.amount(),
            uint8(e.status())
        );
    }
    
    /**
     * @notice Обновить комиссию платформы
     */
    function updatePlatformFee(uint256 newFeePercent) external {
        require(msg.sender == platformWallet, "Only platform wallet");
        require(newFeePercent <= 1000, "Max 10%"); // Максимум 10%
        
        platformFeePercent = newFeePercent;
        
        emit FeeUpdated(newFeePercent);
    }
    
    /**
     * @notice Обновить кошелёк платформы
     */
    function updatePlatformWallet(address newWallet) external {
        require(msg.sender == platformWallet, "Only platform wallet");
        require(newWallet != address(0), "Invalid wallet");
        
        platformWallet = newWallet;
        
        emit PlatformWalletUpdated(newWallet);
    }
    
    /**
     * @notice Добавить/убрать токен из списка разрешённых
     */
    function setTokenAllowed(address token, bool allowed) external {
        require(msg.sender == platformWallet, "Only platform wallet");
        
        allowedTokens[token] = allowed;
        
        emit TokenAdded(token, allowed);
    }
    
    /**
     * @notice Проверить, разрешён ли токен
     */
    function isTokenAllowed(address token) external view returns (bool) {
        if (allowedTokens[address(0)]) return true;
        return allowedTokens[token];
    }
}