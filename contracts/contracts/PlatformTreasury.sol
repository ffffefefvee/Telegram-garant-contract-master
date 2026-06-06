// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PlatformTreasury
/// @notice Аккумулирует комиссии платформы и Treasury Reserve. См. PRODUCT_PLAN §6.5 (D15).
/// @dev Балансы main/reserve учитываются раздельно. На каждое поступление комиссии
///      `reserveBps` процентов идёт в reserve, остальное — в main.
///      Reserve покрывает оплату арбитру в кейсе «виновен продавец», а также
///      компенсации пострадавшим из изъятых stakes (см. ArbitratorRegistry).
contract PlatformTreasury is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
    bytes32 public constant REGISTRY_ROLE = keccak256("REGISTRY_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    IERC20 public immutable token;

    /// @notice Доля поступающей комиссии, отправляемая в reserve, в bps. 2000 = 20% (D15).
    uint16 public reserveBps = 2000;
    uint16 public constant MAX_RESERVE_BPS = 5000;

    uint256 public mainBalance;
    uint256 public reserveBalance;

    event FeeDeposited(address indexed escrow, uint256 totalAmount, uint256 toMain, uint256 toReserve);
    event ArbitratorPaid(address indexed arbitrator, uint256 amount, bytes32 indexed disputeId);
    event UserCompensated(address indexed user, uint256 amount, bytes32 indexed reason);
    event Withdrawn(address indexed to, uint256 amount);
    event ReserveBpsUpdated(uint16 oldBps, uint16 newBps);

    error ReserveBpsTooHigh();
    error InsufficientMainBalance();
    error InsufficientReserveBalance();
    error ZeroAddress();
    error ZeroAmount();

    constructor(IERC20 token_, address admin) {
        if (address(token_) == address(0) || admin == address(0)) revert ZeroAddress();
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    /// @notice Принять комиссию от Escrow (USDT уже должен быть переведён на этот контракт).
    /// @dev Делит сумму между main и reserve по `reserveBps`.
    function depositFee(uint256 amount) external onlyRole(ESCROW_ROLE) {
        if (amount == 0) revert ZeroAmount();
        uint256 toReserve = (amount * reserveBps) / 10000;
        uint256 toMain = amount - toReserve;
        mainBalance += toMain;
        reserveBalance += toReserve;
        emit FeeDeposited(msg.sender, amount, toMain, toReserve);
    }

    /// @notice Оплата арбитру из reserve (кейс «виновен продавец»).
    function payArbitratorFromReserve(
        address arbitrator,
        uint256 amount,
        bytes32 disputeId
    ) external onlyRole(ESCROW_ROLE) nonReentrant {
        if (arbitrator == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > reserveBalance) revert InsufficientReserveBalance();
        reserveBalance -= amount;
        token.safeTransfer(arbitrator, amount);
        emit ArbitratorPaid(arbitrator, amount, disputeId);
    }

    /// @notice Принять slashed stake от ArbitratorRegistry в reserve.
    function depositSlashedStake(uint256 amount) external onlyRole(REGISTRY_ROLE) {
        if (amount == 0) revert ZeroAmount();
        reserveBalance += amount;
    }

    /// @notice Компенсация пострадавшему пользователю из reserve (по решению admin).
    function compensateUser(
        address user,
        uint256 amount,
        bytes32 reason
    ) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > reserveBalance) revert InsufficientReserveBalance();
        reserveBalance -= amount;
        token.safeTransfer(user, amount);
        emit UserCompensated(user, amount, reason);
    }

    /// @notice Вывод платформенных средств из main (в multisig safe).
    /// @dev Должен вызываться через TimelockController в проде.
    function withdraw(address to, uint256 amount) external onlyRole(ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > mainBalance) revert InsufficientMainBalance();
        mainBalance -= amount;
        token.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Выдать свежему escrow-клону ESCROW_ROLE. Вызывает EscrowFactory.
    function authorizeEscrow(address escrow) external onlyRole(FACTORY_ROLE) {
        if (escrow == address(0)) revert ZeroAddress();
        _grantRole(ESCROW_ROLE, escrow);
    }

    function setReserveBps(uint16 newBps) external onlyRole(ADMIN_ROLE) {
        if (newBps > MAX_RESERVE_BPS) revert ReserveBpsTooHigh();
        emit ReserveBpsUpdated(reserveBps, newBps);
        reserveBps = newBps;
    }

    /// @notice Признать неучтённый прямой transfer токенов в main (если кто-то прислал).
    /// @dev Без этого «сиротские» токены оставались бы недоступны.
    function reconcile() external onlyRole(ADMIN_ROLE) returns (uint256 unaccounted) {
        uint256 onChain = token.balanceOf(address(this));
        uint256 accounted = mainBalance + reserveBalance;
        if (onChain > accounted) {
            unaccounted = onChain - accounted;
            mainBalance += unaccounted;
        }
    }
}
