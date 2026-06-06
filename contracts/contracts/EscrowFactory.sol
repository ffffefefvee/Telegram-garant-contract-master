// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {EscrowImplementation} from "./EscrowImplementation.sol";
import {PlatformTreasury} from "./PlatformTreasury.sol";
import {ArbitratorRegistry} from "./ArbitratorRegistry.sol";

/// @title EscrowFactory
/// @notice Фабрика для деплоя escrow-клонов (EIP-1167) под каждую сделку. См. PRODUCT_PLAN §4 + D9.
/// @dev Хранит конфиг тарифной сетки (D5) + штрафа (D15). Backend (relay) дёргает createEscrow.
contract EscrowFactory is AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant RELAY_ROLE = keccak256("RELAY_ROLE");

    enum FeeModel {
        SPLIT_50_50, // дефолт по D4: каждая сторона платит 50% totalFee
        BUYER_100,   // покупатель платит весь fee
        SELLER_100   // продавец платит весь fee (вычитается из payout)
    }

    /// @notice Тарифная сетка (D5). Если amount < threshold → flatFee. Иначе → percentFeeBps.
    struct TariffConfig {
        uint256 threshold; // в USDT-wei (с decimals токена)
        uint256 flatFee;   // в USDT-wei
        uint16 percentFeeBps; // 500 = 5%
    }

    /// @notice Параметры арбитражного штрафа (D15).
    struct FineConfig {
        uint16 fineBps; // 1000 = 10%
        uint256 fineMin;
        uint256 fineMax;
    }

    address public immutable implementation;
    IERC20 public immutable token;
    PlatformTreasury public immutable treasury;
    ArbitratorRegistry public immutable registry;
    address public relay;

    /// @notice Минимальная сумма сделки (D6, ≈ 300 ₽ в USDT).
    uint256 public minDealAmount;
    TariffConfig public tariff;
    FineConfig public fine;

    mapping(bytes32 => address) public escrowOf;

    event EscrowCreated(
        bytes32 indexed dealId,
        address indexed escrow,
        address buyer,
        address seller,
        uint256 amount,
        uint256 buyerFee,
        uint256 sellerFee,
        FeeModel feeModel
    );
    event RelayUpdated(address oldRelay, address newRelay);
    event MinDealAmountUpdated(uint256 oldMin, uint256 newMin);
    event TariffUpdated(TariffConfig newTariff);
    event FineUpdated(FineConfig newFine);

    error ZeroAddress();
    error AmountBelowMinimum();
    error EscrowAlreadyExists();
    error InvalidFeeModel();

    constructor(
        address implementation_,
        IERC20 token_,
        PlatformTreasury treasury_,
        ArbitratorRegistry registry_,
        address relay_,
        address admin,
        uint256 minDealAmount_,
        TariffConfig memory tariff_,
        FineConfig memory fine_
    ) {
        if (
            implementation_ == address(0) ||
            address(token_) == address(0) ||
            address(treasury_) == address(0) ||
            address(registry_) == address(0) ||
            relay_ == address(0) ||
            admin == address(0)
        ) revert ZeroAddress();

        implementation = implementation_;
        token = token_;
        treasury = treasury_;
        registry = registry_;
        relay = relay_;
        minDealAmount = minDealAmount_;
        tariff = tariff_;
        fine = fine_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(RELAY_ROLE, relay_);
    }

    /// @notice Расчёт платформенной комиссии по тарифной сетке (D5).
    function computeTotalFee(uint256 dealAmount) public view returns (uint256) {
        if (dealAmount < tariff.threshold) {
            return tariff.flatFee;
        }
        return (dealAmount * tariff.percentFeeBps) / 10000;
    }

    /// @notice Расчёт buyerFee/sellerFee по модели распределения D4.
    function splitFee(uint256 totalFee, FeeModel model)
        public
        pure
        returns (uint256 buyerFee, uint256 sellerFee)
    {
        if (model == FeeModel.SPLIT_50_50) {
            buyerFee = totalFee / 2;
            sellerFee = totalFee - buyerFee;
        } else if (model == FeeModel.BUYER_100) {
            buyerFee = totalFee;
            sellerFee = 0;
        } else if (model == FeeModel.SELLER_100) {
            buyerFee = 0;
            sellerFee = totalFee;
        } else {
            revert InvalidFeeModel();
        }
    }

    /// @notice Предсказать адрес escrow-клона для dealId (CREATE2).
    function predictEscrowAddress(bytes32 dealId) public view returns (address) {
        return Clones.predictDeterministicAddress(implementation, dealId, address(this));
    }

    /// @notice Создать escrow для сделки. Backend / relay вызывает после акцепта продавца.
    function createEscrow(
        bytes32 dealId,
        address buyer,
        address seller,
        uint256 amount,
        FeeModel feeModel,
        uint64 fundingDeadline
    ) external onlyRole(RELAY_ROLE) returns (address escrow) {
        if (buyer == address(0) || seller == address(0)) revert ZeroAddress();
        if (amount < minDealAmount) revert AmountBelowMinimum();
        if (escrowOf[dealId] != address(0)) revert EscrowAlreadyExists();

        uint256 totalFee = computeTotalFee(amount);
        (uint256 buyerFee, uint256 sellerFee) = splitFee(totalFee, feeModel);

        escrow = Clones.cloneDeterministic(implementation, dealId);
        escrowOf[dealId] = escrow;

        EscrowImplementation.InitParams memory params = EscrowImplementation.InitParams({
            token: token,
            treasury: treasury,
            registry: registry,
            relay: relay,
            dealId: dealId,
            buyer: buyer,
            seller: seller,
            amount: amount,
            buyerFee: buyerFee,
            sellerFee: sellerFee,
            fundingDeadline: fundingDeadline,
            fineMin: fine.fineMin,
            fineMax: fine.fineMax,
            fineBps: fine.fineBps
        });
        EscrowImplementation(escrow).initialize(params);

        // Дать клону роли в Treasury / Registry, чтобы он мог вызывать
        // depositFee / payArbitrator / incrementResolved. Factory должна иметь
        // FACTORY_ROLE на обоих контрактах (выдаётся deploy-скриптом).
        treasury.authorizeEscrow(escrow);
        registry.authorizeEscrow(escrow);

        emit EscrowCreated(dealId, escrow, buyer, seller, amount, buyerFee, sellerFee, feeModel);
    }

    // ---------- Admin ----------

    function setRelay(address newRelay) external onlyRole(ADMIN_ROLE) {
        if (newRelay == address(0)) revert ZeroAddress();
        _revokeRole(RELAY_ROLE, relay);
        emit RelayUpdated(relay, newRelay);
        relay = newRelay;
        _grantRole(RELAY_ROLE, newRelay);
    }

    function setMinDealAmount(uint256 newMin) external onlyRole(ADMIN_ROLE) {
        emit MinDealAmountUpdated(minDealAmount, newMin);
        minDealAmount = newMin;
    }

    function setTariff(TariffConfig calldata newTariff) external onlyRole(ADMIN_ROLE) {
        tariff = newTariff;
        emit TariffUpdated(newTariff);
    }

    function setFine(FineConfig calldata newFine) external onlyRole(ADMIN_ROLE) {
        fine = newFine;
        emit FineUpdated(newFine);
    }
}
