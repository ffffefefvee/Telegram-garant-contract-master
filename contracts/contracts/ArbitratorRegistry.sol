// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {PlatformTreasury} from "./PlatformTreasury.sol";

/// @title ArbitratorRegistry
/// @notice On-chain реестр арбитров: stake, level, status, slashing. См. PRODUCT_PLAN §6.6 (D16).
/// @dev Только on-chain аспекты: депозит/вывод залога, текущий уровень/статус, slashing.
///      Vacation, capacity, KPI, conflict-of-interest — в backend (off-chain),
///      т.к. эти поля меняются часто и не требуют ончейн-доверия.
contract ArbitratorRegistry is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    enum Level {
        TRAINEE,
        JUNIOR,
        SENIOR,
        HEAD
    }

    enum Status {
        NONE,
        ACTIVE,
        PROBATION,
        SUSPENDED,
        TERMINATED
    }

    struct Arbitrator {
        Status status;
        Level level;
        uint256 stake;
        uint256 totalResolved;
        uint256 totalSlashed;
        uint64 hiredAt;
        uint64 withdrawRequestAt; // 0 если нет активного запроса
        uint256 withdrawRequestAmount;
    }

    IERC20 public immutable token;
    PlatformTreasury public immutable treasury;

    /// @notice Минимальный stake для JUNIOR/TRAINEE/HEAD (200 USDT по D16).
    uint256 public minStake;
    /// @notice Пониженный stake для SENIOR (100 USDT по D16).
    uint256 public seniorMinStake;
    /// @notice Cooldown между запросом вывода и собственно выводом.
    uint64 public withdrawCooldown = 14 days;

    mapping(address => Arbitrator) private _arbitrators;
    address[] public arbitratorList;
    mapping(address => uint256) private _arbitratorIndexPlusOne; // index + 1, 0 = not in list

    event ArbitratorHired(address indexed arbitrator, Level level);
    event StakeDeposited(address indexed arbitrator, uint256 amount, uint256 newStake);
    event WithdrawRequested(address indexed arbitrator, uint256 amount, uint64 readyAt);
    event StakeWithdrawn(address indexed arbitrator, uint256 amount);
    event StakeSlashed(
        address indexed arbitrator,
        uint256 amount,
        bytes32 indexed reason,
        address indexed beneficiary
    );
    event StatusChanged(address indexed arbitrator, Status oldStatus, Status newStatus);
    event LevelChanged(address indexed arbitrator, Level oldLevel, Level newLevel);
    event ResolvedIncremented(address indexed arbitrator, uint256 totalResolved);

    error ZeroAddress();
    error ZeroAmount();
    error AlreadyHired();
    error NotHired();
    error InsufficientStake();
    error WithdrawAlreadyRequested();
    error WithdrawNotRequested();
    error WithdrawCooldownActive();
    error WithdrawWouldBreachMin();
    error NotEligibleForWithdraw();

    constructor(
        IERC20 token_,
        PlatformTreasury treasury_,
        uint256 minStake_,
        uint256 seniorMinStake_,
        address admin
    ) {
        if (address(token_) == address(0) || address(treasury_) == address(0) || admin == address(0)) {
            revert ZeroAddress();
        }
        token = token_;
        treasury = treasury_;
        minStake = minStake_;
        seniorMinStake = seniorMinStake_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
    }

    // ---------- Lifecycle (admin) ----------

    function hire(address wallet, Level initialLevel) external onlyRole(ADMIN_ROLE) {
        if (wallet == address(0)) revert ZeroAddress();
        Arbitrator storage a = _arbitrators[wallet];
        if (a.status != Status.NONE) revert AlreadyHired();
        a.status = Status.ACTIVE;
        a.level = initialLevel;
        a.hiredAt = uint64(block.timestamp);
        arbitratorList.push(wallet);
        _arbitratorIndexPlusOne[wallet] = arbitratorList.length;
        emit ArbitratorHired(wallet, initialLevel);
        emit StatusChanged(wallet, Status.NONE, Status.ACTIVE);
    }

    function setStatus(address arbitrator, Status newStatus) external onlyRole(ADMIN_ROLE) {
        Arbitrator storage a = _arbitrators[arbitrator];
        if (a.status == Status.NONE) revert NotHired();
        Status old = a.status;
        a.status = newStatus;
        emit StatusChanged(arbitrator, old, newStatus);
    }

    function setLevel(address arbitrator, Level newLevel) external onlyRole(ADMIN_ROLE) {
        Arbitrator storage a = _arbitrators[arbitrator];
        if (a.status == Status.NONE) revert NotHired();
        Level old = a.level;
        a.level = newLevel;
        emit LevelChanged(arbitrator, old, newLevel);
    }

    // ---------- Stake (self-service) ----------

    /// @notice Внести stake. Токены должны быть pre-approved.
    function depositStake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Arbitrator storage a = _arbitrators[msg.sender];
        if (a.status == Status.NONE) revert NotHired();
        token.safeTransferFrom(msg.sender, address(this), amount);
        a.stake += amount;
        emit StakeDeposited(msg.sender, amount, a.stake);
    }

    /// @notice Запросить вывод stake. После cooldown можно забрать.
    function requestWithdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Arbitrator storage a = _arbitrators[msg.sender];
        if (a.status == Status.NONE) revert NotHired();
        if (a.status == Status.PROBATION || a.status == Status.SUSPENDED) revert NotEligibleForWithdraw();
        if (amount > a.stake) revert InsufficientStake();
        if (a.withdrawRequestAt != 0) revert WithdrawAlreadyRequested();

        // Если арбитр не TERMINATED — не разрешаем выводить ниже minStake для текущего уровня.
        if (a.status != Status.TERMINATED) {
            uint256 minForLevel = _minStakeForLevel(a.level);
            if (a.stake - amount < minForLevel) revert WithdrawWouldBreachMin();
        }

        a.withdrawRequestAt = uint64(block.timestamp);
        a.withdrawRequestAmount = amount;
        emit WithdrawRequested(msg.sender, amount, uint64(block.timestamp) + withdrawCooldown);
    }

    function withdraw() external nonReentrant {
        Arbitrator storage a = _arbitrators[msg.sender];
        if (a.withdrawRequestAt == 0) revert WithdrawNotRequested();
        if (block.timestamp < a.withdrawRequestAt + withdrawCooldown) revert WithdrawCooldownActive();
        if (a.status == Status.PROBATION || a.status == Status.SUSPENDED) revert NotEligibleForWithdraw();

        uint256 amount = a.withdrawRequestAmount;
        if (amount > a.stake) revert InsufficientStake();
        a.stake -= amount;
        a.withdrawRequestAt = 0;
        a.withdrawRequestAmount = 0;
        token.safeTransfer(msg.sender, amount);
        emit StakeWithdrawn(msg.sender, amount);
    }

    /// @notice Отменить запрос на вывод (например, чтобы продолжить работать).
    function cancelWithdrawRequest() external {
        Arbitrator storage a = _arbitrators[msg.sender];
        if (a.withdrawRequestAt == 0) revert WithdrawNotRequested();
        a.withdrawRequestAt = 0;
        a.withdrawRequestAmount = 0;
    }

    // ---------- Slashing ----------

    /// @notice Изъять часть stake у арбитра.
    /// @param arbitrator Чей stake урезаем.
    /// @param amount Сумма (в токенах). Если > текущего stake — урезаем до 0.
    /// @param reason Хэш-код причины (фронт расшифровывает).
    /// @param beneficiary Куда идут средства: адрес жертвы или address(0) → в Treasury Reserve.
    function slash(
        address arbitrator,
        uint256 amount,
        bytes32 reason,
        address beneficiary
    ) external onlyRole(ADMIN_ROLE) nonReentrant {
        Arbitrator storage a = _arbitrators[arbitrator];
        if (a.status == Status.NONE) revert NotHired();
        if (amount == 0) revert ZeroAmount();

        uint256 actual = amount > a.stake ? a.stake : amount;
        if (actual == 0) return;

        a.stake -= actual;
        a.totalSlashed += actual;

        if (beneficiary == address(0)) {
            // в Treasury Reserve
            token.safeTransfer(address(treasury), actual);
            treasury.depositSlashedStake(actual);
        } else {
            token.safeTransfer(beneficiary, actual);
        }

        emit StakeSlashed(arbitrator, actual, reason, beneficiary);
    }

    /// @notice Инкремент счётчика разрешённых споров (вызывается из Escrow при resolve()).
    function incrementResolved(address arbitrator) external onlyRole(ESCROW_ROLE) {
        Arbitrator storage a = _arbitrators[arbitrator];
        if (a.status == Status.NONE) revert NotHired();
        a.totalResolved += 1;
        emit ResolvedIncremented(arbitrator, a.totalResolved);
    }

    // ---------- Admin params ----------

    /// @notice Выдать свежему escrow-клону ESCROW_ROLE. Вызывает EscrowFactory.
    function authorizeEscrow(address escrow) external onlyRole(FACTORY_ROLE) {
        if (escrow == address(0)) revert ZeroAddress();
        _grantRole(ESCROW_ROLE, escrow);
    }

    function setMinStake(uint256 newMin, uint256 newSeniorMin) external onlyRole(ADMIN_ROLE) {
        minStake = newMin;
        seniorMinStake = newSeniorMin;
    }

    function setWithdrawCooldown(uint64 newCooldown) external onlyRole(ADMIN_ROLE) {
        withdrawCooldown = newCooldown;
    }

    // ---------- Views ----------

    function getArbitrator(address wallet) external view returns (Arbitrator memory) {
        return _arbitrators[wallet];
    }

    function arbitratorCount() external view returns (uint256) {
        return arbitratorList.length;
    }

    /// @notice Может ли этот адрес быть назначен на спор (on-chain критерий).
    /// @dev Backend дополнительно проверяет CoI, vacation, capacity, level vs disputeAmount.
    function isEligible(address arbitrator) external view returns (bool) {
        Arbitrator storage a = _arbitrators[arbitrator];
        if (a.status != Status.ACTIVE) return false;
        if (a.stake < _minStakeForLevel(a.level)) return false;
        return true;
    }

    function _minStakeForLevel(Level lvl) internal view returns (uint256) {
        if (lvl == Level.SENIOR) return seniorMinStake;
        return minStake;
    }
}
