// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import {PlatformTreasury} from "./PlatformTreasury.sol";
import {ArbitratorRegistry} from "./ArbitratorRegistry.sol";

/// @dev Минимальный интерфейс фабрики (полный import создал бы циклическую зависимость).
interface IEscrowFactoryRelay {
    function relay() external view returns (address);
}

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

    /// @notice Уменьшенная ставка платформенной комиссии при арбитраже.
    ///         Доля от штатной комиссии сделки (buyerFee + sellerFee). 5000 = 50%.
    /// @dev Комиссия в споре удерживается ТОЛЬКО из доли ВИНОВНОЙ стороны и никогда
    ///      не уменьшает выплату невиновному — пострадавший от скамера не платит
    ///      комиссию за чужую вину (PRODUCT_PLAN §6.5).
    uint16 public constant DISPUTE_FEE_BPS = 5000;
    uint16 private constant BPS_DENOMINATOR = 10000;
    uint16 private constant SHARE_DENOMINATOR = 100;

    uint64 public fundingDeadline;
    Status public status;

    address public assignedArbitrator;

    event Initialized(bytes32 indexed dealId, address indexed buyer, address indexed seller, uint256 amount);
    event Funded(uint256 totalReceived);
    event Rescued(address indexed to, uint256 amount);
    event Cancelled();
    event Released(address indexed seller, uint256 sellerPayout, uint256 toTreasury);
    event Refunded(address indexed buyer, uint256 amount);
    event Disputed(address indexed by);
    event FundingDeadlineExtended(uint64 previousDeadline, uint64 newDeadline);
    event ArbitratorAssigned(address indexed arbitrator);
    event Resolved(
        address indexed arbitrator,
        uint16 buyerSharePct,
        uint16 sellerSharePct,
        uint256 buyerPayout,
        uint256 sellerPayout,
        uint256 fineToArbitrator,
        uint256 fineFromReserve,
        uint256 feeToTreasury
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
    error NothingToRescue();
    error InvalidNewDeadline();

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
        if (msg.sender != relay()) revert NotRelay();
        _;
    }

    modifier inStatus(Status expected) {
        if (status != expected) revert WrongStatus();
        _;
    }

    /// @dev Имплементация-синглтон не должна быть инициализируемой (только клоны).
    constructor() {
        _disableInitializers();
    }

    /// @notice Актуальный relay читается из фабрики — ротация ключа (setRelay)
    ///         мгновенно действует и на уже развёрнутые клоны.
    function relay() public view returns (address) {
        return IEscrowFactoryRelay(factory).relay();
    }

    /// @notice Инициализация клона. Вызывает Factory сразу после cloneDeterministic.
    /// @dev Параметры упакованы в struct из-за лимита stack-depth solc.
    struct InitParams {
        IERC20 token;
        PlatformTreasury treasury;
        ArbitratorRegistry registry;
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

    /// @notice Платформа (relay) продлевает funding deadline — спасение «поздних» депозитов:
    ///         деньги покупателя пришли после дедлайна, но эскроу ещё никто не отменил/не
    ///         пометил EXPIRED. Продление → штатный путь notifyFunded() вместо ручного возврата.
    /// @dev Работает ТОЛЬКО пока эскроу в AWAITING_FUNDING (даже если дедлайн уже прошёл).
    ///      После cancel()/expire() продление невозможно — покупатель уже вправе забрать
    ///      средства через rescue(), менять это задним числом нельзя. Сократить дедлайн
    ///      нельзя тоже: это могло бы отрезать уже платящего покупателя.
    function extendFundingDeadline(uint64 newDeadline)
        external
        onlyRelay
        inStatus(Status.AWAITING_FUNDING)
    {
        if (newDeadline <= fundingDeadline || newDeadline <= block.timestamp) {
            revert InvalidNewDeadline();
        }
        uint64 previous = fundingDeadline;
        fundingDeadline = newDeadline;
        emit FundingDeadlineExtended(previous, newDeadline);
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

    /// @notice Вернуть «застрявшие» токены. Permissionless: получатель детерминирован статусом.
    /// @dev Два кейса:
    ///      1) CANCELLED / EXPIRED — relay успел перевести USDT, но notifyFunded() не прошёл
    ///         (гонка с deadline / падение tx) либо кто-то прислал токены напрямую на
    ///         предсказуемый CREATE2-адрес. Весь остаток возвращается покупателю.
    ///      2) RELEASED / REFUNDED / RESOLVED — излишек сверх расчётных выплат (переплата)
    ///         уходит в Treasury; admin признаёт его через reconcile().
    function rescue() external nonReentrant {
        Status s = status;
        // `to` is assigned on every non-reverting path below.
        // slither-disable-next-line uninitialized-local
        address to;
        if (s == Status.CANCELLED || s == Status.EXPIRED) {
            to = buyer;
        } else if (s == Status.RELEASED || s == Status.REFUNDED || s == Status.RESOLVED) {
            to = address(treasury);
        } else {
            revert WrongStatus();
        }
        uint256 bal = token.balanceOf(address(this));
        // Benign zero-check guard, not balance-based state logic.
        // slither-disable-next-line incorrect-equality
        if (bal == 0) revert NothingToRescue();
        token.safeTransfer(to, bal);
        emit Rescued(to, bal);
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
        registry.beginDispute(arbitrator);
        emit ArbitratorAssigned(arbitrator);
    }

    /// @notice Результат расчёта распределения средств при resolve() (вынесен в struct
    ///         из-за лимита stack-depth solc и для читаемости).
    struct ResolveSplit {
        uint256 fine;            // полный штраф арбитру (D15)
        uint256 fineFromEscrow;  // часть штрафа из эскроу (виновен покупатель)
        uint256 fineFromReserve; // часть штрафа из Treasury Reserve (виновен продавец)
        uint256 buyerPayout;     // выплата покупателю (за вычетом его доли комиссии)
        uint256 sellerPayout;    // выплата продавцу (за вычетом его доли комиссии)
        uint256 feeToTreasury;   // уменьшенная комиссия платформы
    }

    /// @notice Арбитр выносит решение. См. PRODUCT_PLAN §6.5.
    /// @param buyerSharePct 0..100, sellerSharePct = 100 - buyerSharePct.
    function resolve(uint16 buyerSharePct, uint16 sellerSharePct)
        external
        inStatus(Status.DISPUTED)
        nonReentrant
    {
        if (msg.sender != assignedArbitrator) revert NotAssignedArbitrator();
        if (uint256(buyerSharePct) + uint256(sellerSharePct) != SHARE_DENOMINATOR) revert InvalidShares();

        uint256 escrowBalance = token.balanceOf(address(this));
        ResolveSplit memory s = _computeResolveSplit(escrowBalance, buyerSharePct, sellerSharePct);

        status = Status.RESOLVED;

        // Effects
        registry.endDispute(assignedArbitrator);

        // Interactions
        if (s.fineFromEscrow > 0) {
            token.safeTransfer(assignedArbitrator, s.fineFromEscrow);
        }
        if (s.fineFromReserve > 0) {
            treasury.payArbitratorFromReserve(assignedArbitrator, s.fineFromReserve, dealId);
        }
        if (s.feeToTreasury > 0) {
            token.safeTransfer(address(treasury), s.feeToTreasury);
            treasury.depositFee(s.feeToTreasury);
        }
        if (s.buyerPayout > 0) {
            token.safeTransfer(buyer, s.buyerPayout);
        }
        if (s.sellerPayout > 0) {
            token.safeTransfer(seller, s.sellerPayout);
        }

        emit Resolved(
            assignedArbitrator,
            buyerSharePct,
            sellerSharePct,
            s.buyerPayout,
            s.sellerPayout,
            s.fine,
            s.fineFromReserve,
            s.feeToTreasury
        );
    }

    /// @notice Чистый расчёт распределения средств спора. Инвариант:
    ///         buyerPayout + sellerPayout + feeToTreasury + fineFromEscrow == escrowBalance.
    /// @dev Штраф D15 и комиссия берутся только с виновной стороны:
    ///      вина покупателя = sellerSharePct, вина продавца = buyerSharePct.
    ///      Комиссия удерживается из СОБСТВЕННОЙ доли каждой стороны (cap),
    ///      поэтому полностью невиновная сторона никогда не платит комиссию.
    function _computeResolveSplit(
        uint256 escrowBalance,
        uint16 buyerSharePct,
        uint16 sellerSharePct
    ) internal view returns (ResolveSplit memory s) {
        s.fine = _computeFine();

        // Principal is distributed solely by the award. Neither fine nor platform fee
        // may reduce the innocent party's principal payout (SEC-C01).
        uint256 buyerPrincipal = (amount * buyerSharePct) / SHARE_DENOMINATOR;
        uint256 sellerPrincipal = amount - buyerPrincipal;
        uint256 ancillary = escrowBalance - amount;

        // Buyer-fault fine can consume only buyer-funded ancillary value. The rest of
        // the award is paid/capped/deferred by Treasury, never by the innocent seller.
        uint256 requestedFromEscrow = (s.fine * sellerSharePct) / SHARE_DENOMINATOR;
        s.fineFromEscrow = requestedFromEscrow > ancillary ? ancillary : requestedFromEscrow;
        s.fineFromReserve = s.fine - s.fineFromEscrow;
        ancillary -= s.fineFromEscrow;

        // A fully innocent winner pays no platform fee. For split awards, the reduced
        // dispute fee is capped to ancillary funding, preserving both principals.
        if (buyerSharePct != 0 && sellerSharePct != 0) {
            uint256 disputeFee = ((buyerFee + sellerFee) * DISPUTE_FEE_BPS) / BPS_DENOMINATOR;
            s.feeToTreasury = disputeFee > ancillary ? ancillary : disputeFee;
            ancillary -= s.feeToTreasury;
        }

        // Return unused buyer-funded ancillary value; exact conservation is retained.
        s.buyerPayout = buyerPrincipal + ancillary;
        s.sellerPayout = sellerPrincipal;
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
