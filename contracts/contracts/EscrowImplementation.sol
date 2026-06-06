// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import {PlatformTreasury} from "./PlatformTreasury.sol";
import {ArbitratorRegistry} from "./ArbitratorRegistry.sol";

/// @title EscrowImplementation
/// @notice Эскроу одной сделки (за каждой сделкой клонится через EIP-1167). См. PRODUCT_PLAN §3-§4.
/// @dev Замена legacy `Escrow.sol`. Фиксы:
///      - release() только покупатель
///      - refund() только продавец (он сам отказывается от сделки)
///      - dispute() — любая сторона
///      - resolve() — только назначенный арбитр
///      - комиссия проводится в PlatformTreasury (никаких «застрявших» денег)
///      - ReentrancyGuard на всех мутирующих переводах
///      - арбитражный штраф (D15) — clawback из эскроу + Treasury Reserve по shares
contract EscrowImplementation is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        UNINITIALIZED,
        AWAITING_FUNDING,
        FUNDED,
        RELEASED,
        REFUNDED,
        DISPUTED,
        RESOLVED,
        CANCELLED,
        EXPIRED
    }

    // Storage
    IERC20 public token;
    PlatformTreasury public treasury;
    ArbitratorRegistry public registry;
    address public factory;
    address public relay;

    bytes32 public dealId;
    address public buyer;
    address public seller;

    uint256 public amount;     // цена сделки в USDT-wei
    uint256 public buyerFee;   // часть totalFee, оплачиваемая покупателем поверх amount (в эскроу)
    uint256 public sellerFee;  // часть totalFee, удерживаемая из выплаты продавцу

    /// @notice Параметры штрафа арбитру (D15). Считается на основе amount.
    uint256 public fineMin;
    uint256 public fineMax;
    uint16 public fineBps;     // 1000 = 10%

    uint64 public fundingDeadline;
    Status public status;

    address public assignedArbitrator;

    event Initialized(bytes32 indexed dealId, address indexed buyer, address indexed seller, uint256 amount);
    event Funded(uint256 totalReceived);
    event Cancelled();
    event Released(address indexed seller, uint256 sellerPayout, uint256 toTreasury);
    event Refunded(address indexed buyer, uint256 amount);
    event Disputed(address indexed by);
    event ArbitratorAssigned(address indexed arbitrator);
    event Resolved(
        address indexed arbitrator,
        uint16 buyerSharePct,
        uint16 sellerSharePct,
        uint256 buyerPayout,
        uint256 sellerPayout,
        uint256 fineToArbitrator,
        uint256 fineFromReserve
    );

    error NotBuyer();
    error NotSeller();
    error NotParty();
    error NotRelay();
    error NotAssignedArbitrator();
    error WrongStatus();
    error InvalidShares();
    error AlreadyAssigned();
    error ArbitratorNotEligible();
    error InsufficientFunding(uint256 expected, uint256 got);
    error FundingDeadlinePassed();
    error FundingDeadlineNotPassed();

    modifier onlyBuyer() {
        if (msg.sender != buyer) revert NotBuyer();
        _;
    }

    modifier onlySeller() {
        if (msg.sender != seller) revert NotSeller();
        _;
    }

    modifier onlyParty() {
        if (msg.sender != buyer && msg.sender != seller) revert NotParty();
        _;
    }

    modifier onlyRelay() {
        if (msg.sender != relay) revert NotRelay();
        _;
    }

    modifier inStatus(Status expected) {
        if (status != expected) revert WrongStatus();
        _;
    }

    /// @notice Инициализация клона. Вызывает Factory сразу после cloneDeterministic.
    /// @dev Параметры упакованы в struct из-за лимита stack-depth solc.
    struct InitParams {
        IERC20 token;
        PlatformTreasury treasury;
        ArbitratorRegistry registry;
        address relay;
        bytes32 dealId;
        address buyer;
        address seller;
        uint256 amount;
        uint256 buyerFee;
        uint256 sellerFee;
        uint64 fundingDeadline;
        uint256 fineMin;
        uint256 fineMax;
        uint16 fineBps;
    }

    function initialize(InitParams calldata p) external initializer {
        token = p.token;
        treasury = p.treasury;
        registry = p.registry;
        factory = msg.sender;
        relay = p.relay;
        dealId = p.dealId;
        buyer = p.buyer;
        seller = p.seller;
        amount = p.amount;
        buyerFee = p.buyerFee;
        sellerFee = p.sellerFee;
        fundingDeadline = p.fundingDeadline;
        fineMin = p.fineMin;
        fineMax = p.fineMax;
        fineBps = p.fineBps;
        status = Status.AWAITING_FUNDING;

        emit Initialized(p.dealId, p.buyer, p.seller, p.amount);
    }

    /// @notice Relay вызывает после получения USDT на адрес контракта.
    /// @dev Сверяем on-chain balance ≥ amount + buyerFee. Если ниже — revert.
    function notifyFunded() external onlyRelay inStatus(Status.AWAITING_FUNDING) {
        if (block.timestamp > fundingDeadline) revert FundingDeadlinePassed();
        uint256 expected = amount + buyerFee;
        uint256 got = token.balanceOf(address(this));
        if (got < expected) revert InsufficientFunding(expected, got);
        status = Status.FUNDED;
        emit Funded(got);
    }

    /// @notice Отменить сделку до funding'а (любая сторона) или после deadline.
    function cancel() external onlyParty {
        if (status != Status.AWAITING_FUNDING) revert WrongStatus();
        status = Status.CANCELLED;
        emit Cancelled();
    }

    /// @notice Истёкший funding deadline — любой может пометить EXPIRED.
    function expire() external inStatus(Status.AWAITING_FUNDING) {
        if (block.timestamp <= fundingDeadline) revert FundingDeadlineNotPassed();
        status = Status.EXPIRED;
        emit Cancelled();
    }

    /// @notice Покупатель подтверждает получение → продавцу payout, в treasury комиссия.
    function release() external onlyBuyer inStatus(Status.FUNDED) nonReentrant {
        uint256 sellerPayout = amount - sellerFee;
        uint256 totalFee = buyerFee + sellerFee;
        status = Status.RELEASED;
        if (sellerPayout > 0) {
            token.safeTransfer(seller, sellerPayout);
        }
        if (totalFee > 0) {
            token.safeTransfer(address(treasury), totalFee);
            treasury.depositFee(totalFee);
        }
        emit Released(seller, sellerPayout, totalFee);
    }

    /// @notice Продавец сам отказывается → полный возврат покупателю (без комиссии).
    function refund() external onlySeller inStatus(Status.FUNDED) nonReentrant {
        uint256 refundAmount = amount + buyerFee;
        status = Status.REFUNDED;
        token.safeTransfer(buyer, refundAmount);
        emit Refunded(buyer, refundAmount);
    }

    /// @notice Любая сторона открывает спор.
    function dispute() external onlyParty inStatus(Status.FUNDED) {
        status = Status.DISPUTED;
        emit Disputed(msg.sender);
    }

    /// @notice Relay назначает арбитра (после off-chain CoI/load-balancing проверок).
    function assignArbitrator(address arbitrator) external onlyRelay inStatus(Status.DISPUTED) {
        if (assignedArbitrator != address(0)) revert AlreadyAssigned();
        if (!registry.isEligible(arbitrator)) revert ArbitratorNotEligible();
        assignedArbitrator = arbitrator;
        emit ArbitratorAssigned(arbitrator);
    }

    /// @notice Арбитр выносит решение. См. PRODUCT_PLAN §6.5.
    /// @param buyerSharePct 0..100, sellerSharePct = 100 - buyerSharePct.
    function resolve(uint16 buyerSharePct, uint16 sellerSharePct)
        external
        inStatus(Status.DISPUTED)
        nonReentrant
    {
        if (msg.sender != assignedArbitrator) revert NotAssignedArbitrator();
        if (uint256(buyerSharePct) + uint256(sellerSharePct) != 100) revert InvalidShares();

        // Штраф D15: пропорция между escrow (buyer-side fault) и Treasury Reserve (seller-side fault).
        uint256 fine = _computeFine();
        uint256 escrowBalance = token.balanceOf(address(this));

        // fineFromEscrow = fine * sellerSharePct / 100; capped at escrowBalance to avoid underflow
        uint256 fineFromEscrow = (fine * sellerSharePct) / 100;
        if (fineFromEscrow > escrowBalance) {
            fineFromEscrow = escrowBalance;
        }
        uint256 fineFromReserve = fine - fineFromEscrow;

        uint256 remaining = escrowBalance - fineFromEscrow;
        uint256 buyerPayout = (remaining * buyerSharePct) / 100;
        uint256 sellerPayout = remaining - buyerPayout; // sellerSharePct = 100 - buyerSharePct → no rounding loss

        status = Status.RESOLVED;

        // Effects
        registry.incrementResolved(assignedArbitrator);

        // Interactions
        if (fineFromEscrow > 0) {
            token.safeTransfer(assignedArbitrator, fineFromEscrow);
        }
        if (fineFromReserve > 0) {
            treasury.payArbitratorFromReserve(assignedArbitrator, fineFromReserve, dealId);
        }
        if (buyerPayout > 0) {
            token.safeTransfer(buyer, buyerPayout);
        }
        if (sellerPayout > 0) {
            token.safeTransfer(seller, sellerPayout);
        }

        emit Resolved(
            assignedArbitrator,
            buyerSharePct,
            sellerSharePct,
            buyerPayout,
            sellerPayout,
            fine,
            fineFromReserve
        );
    }

    function _computeFine() internal view returns (uint256) {
        uint256 percentFine = (amount * fineBps) / 10000;
        if (percentFine < fineMin) return fineMin;
        if (percentFine > fineMax) return fineMax;
        return percentFine;
    }

    /// @notice Удобный view для backend.
    function getBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
