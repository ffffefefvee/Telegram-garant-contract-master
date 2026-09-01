const JETTON_STATUS_AWAITING_FUNDING = 0
const JETTON_STATUS_FUNDED = 1
const JETTON_STATUS_DELIVERED = 2
const JETTON_STATUS_DISPUTED = 3
const JETTON_STATUS_SETTLEMENT_PENDING = 4
const JETTON_STATUS_RECOVERY_REQUIRED = 5
const JETTON_STATUS_SETTLED_FINALIZED = 6

const JETTON_OUTCOME_RELEASE = 1
const JETTON_OUTCOME_REFUND = 2
const JETTON_OUTCOME_RESOLUTION = 3

const JETTON_LEG_BUYER = 1
const JETTON_LEG_SELLER = 2
const JETTON_LEG_TREASURY = 4
const JETTON_ALL_LEGS = 7

const JETTON_PAYOUT_MESSAGE_VALUE: coins = 50000000

const JETTON_TRANSFER_NOTIFICATION_OPCODE = 0x7362d09c
const JETTON_TRANSFER_OPCODE = 0x0f8a7ea5

const JETTON_ERROR_INVALID_CONFIG = 720
const JETTON_ERROR_WRONG_STATE = 721
const JETTON_ERROR_UNAUTHORIZED_WALLET = 722
const JETTON_ERROR_DEADLINE_PASSED = 723
const JETTON_ERROR_WRONG_QUERY_ID = 724
const JETTON_ERROR_WRONG_AMOUNT = 725
const JETTON_ERROR_WRONG_BUYER = 726
const JETTON_ERROR_WRONG_FORWARD_PAYLOAD = 727
const JETTON_ERROR_MALFORMED_FORWARD_PAYLOAD = 728
const JETTON_ERROR_UNKNOWN_MESSAGE = 729
const JETTON_ERROR_BOUNCED_MESSAGE = 730
const JETTON_ERROR_UNAUTHORIZED_INITIALIZER = 731
const JETTON_ERROR_WALLET_NOT_SEALED = 732
const JETTON_ERROR_WALLET_ALREADY_SEALED = 733
const JETTON_ERROR_INVALID_WALLET_SEAL = 734
const JETTON_ERROR_UNAUTHORIZED = 735
const JETTON_ERROR_DEADLINE_NOT_REACHED = 736
const JETTON_ERROR_INVALID_SETTLEMENT = 737
const JETTON_ERROR_INVALID_MASK = 738
const JETTON_ERROR_STALE_ATTEMPT = 739
const JETTON_ERROR_INCOMPLETE_RECONCILIATION = 740
const JETTON_ERROR_INVALID_BOUNCE = 741
const JETTON_ERROR_QUERY_EXHAUSTED = 742
const JETTON_ERROR_SETTLEMENT_FINALIZED = 743

struct JettonRolesTail {
    arbitrator: address
    treasury: address
}

struct JettonRoles {
    buyer: address
    seller: address
    tail: cell
}

/// Both authorities are immutable threshold/multisig identities. The initializer is allowed to
/// seal the canonical wallet once; the reconciliation authority has no power in this slice.
struct JettonAuthorities {
    initializer: address
    reconciliation: address
}

/// The wallet address is deliberately absent from StateInit. It can only be derived after the
/// escrow address exists. The pinned wallet-code hash is an immutable seal-time commitment.
struct JettonAsset {
    master: address
    walletCodeHash: uint256
}

struct JettonEconomics {
    buyerTotal: coins
    sellerPayout: coins
    platformFee: coins
    refundToBuyer: coins
    refundFee: coins
}

struct JettonFundingCommitment {
    expectedQueryId: uint64
    forwardPayloadHash: uint256
    roles: cell
    authorities: cell
    asset: cell
    economics: cell
}

struct JettonEscrowConfig {
    dealId: uint256
    termsHash: uint256
    quoteHash: uint256
    fundingDeadline: uint64
    deliveryDeadline: uint64
    confirmationDeadline: uint64
    commitment: cell
}

struct JettonSealedWallet {
    wallet: address
    verificationEvidenceHash: uint256
}

struct JettonEscrowStorage {
    status: uint8
    walletSealed: uint8
    fundedAmount: coins
    lastQueryId: uint64
    config: cell
    sealedWallet: cell
    settlement: cell
}

fun JettonEscrowStorage.load(): JettonEscrowStorage {
    return JettonEscrowStorage.fromCell(contract.getData());
}

fun JettonEscrowStorage.save(self) {
    contract.setData(self.toCell());
}

fun JettonEscrowStorage.loadConfig(self): JettonEscrowConfig {
    return JettonEscrowConfig.fromCell(self.config);
}

fun JettonEscrowStorage.loadSealedWallet(self): JettonSealedWallet {
    return JettonSealedWallet.fromCell(self.sealedWallet);
}

struct JettonSettlementDestinations {
    buyer: address
    seller: address
    treasury: address
}

struct JettonSettlementAmounts {
    buyer: coins
    seller: coins
    treasury: coins
    total: coins
}

struct JettonSettlementQueries {
    buyer: uint64
    seller: uint64
    treasury: uint64
}

struct JettonSettlementBase {
    settlementId: uint256
    outcome: uint8
    activeMask: uint8
    conservationCommitment: uint256
    destinations: cell
    amounts: cell
}

struct JettonSettlementAttempt {
    attempt: uint32
    activeMask: uint8
    confirmedMask: uint8
    failedMask: uint8
    bouncedMask: uint8
    reconciliationEvidenceHash: uint256
    queries: cell
}

struct JettonSettlement {
    base: cell
    attempt: cell
}

fun JettonEscrowStorage.loadSettlement(self): JettonSettlement {
    return JettonSettlement.fromCell(self.settlement);
}

fun JettonSettlement.loadBase(self): JettonSettlementBase {
    return JettonSettlementBase.fromCell(self.base);
}

fun JettonSettlement.loadAttempt(self): JettonSettlementAttempt {
    return JettonSettlementAttempt.fromCell(self.attempt);
}

fun JettonSettlementBase.loadDestinations(self): JettonSettlementDestinations {
    return JettonSettlementDestinations.fromCell(self.destinations);
}

fun JettonSettlementBase.loadAmounts(self): JettonSettlementAmounts {
    return JettonSettlementAmounts.fromCell(self.amounts);
}

fun JettonSettlementAttempt.loadQueries(self): JettonSettlementQueries {
    return JettonSettlementQueries.fromCell(self.queries);
}

fun JettonEscrowConfig.loadCommitment(self): JettonFundingCommitment {
    return JettonFundingCommitment.fromCell(self.commitment);
}

fun JettonFundingCommitment.loadRoles(self): JettonRoles {
    return JettonRoles.fromCell(self.roles);
}

fun JettonRoles.loadTail(self): JettonRolesTail {
    return JettonRolesTail.fromCell(self.tail);
}

fun JettonFundingCommitment.loadAuthorities(self): JettonAuthorities {
    return JettonAuthorities.fromCell(self.authorities);
}

fun JettonFundingCommitment.loadAsset(self): JettonAsset {
    return JettonAsset.fromCell(self.asset);
}

fun JettonFundingCommitment.loadEconomics(self): JettonEconomics {
    return JettonEconomics.fromCell(self.economics);
}

struct (0x6a736561) SealCanonicalJettonWallet {
    queryId: uint64
    wallet: address
    walletCodeHash: uint256
    verificationEvidenceHash: uint256
}

/// TEP-74 transfer_notification#7362d09c. The final field deliberately captures the
/// complete Either Cell ^Cell encoding so the contract can validate its canonical shape.
struct (0x7362d09c) JettonTransferNotification {
    queryId: uint64
    amount: coins
    sender: address
    forwardPayload: RemainingBitsAndRefs
}

struct JettonSettlementCommand {
    queryId: uint64
    settlementId: uint256
    buyerQueryId: uint64
    sellerQueryId: uint64
    treasuryQueryId: uint64
}

struct (0x64656c76) JettonMarkDelivered {
    queryId: uint64
}

struct (0x72656c73) JettonRelease {
    queryId: uint64
    settlementId: uint256
    buyerQueryId: uint64
    sellerQueryId: uint64
    treasuryQueryId: uint64
}

struct (0x72656664) JettonRefundBuyer {
    queryId: uint64
    settlementId: uint256
    buyerQueryId: uint64
    sellerQueryId: uint64
    treasuryQueryId: uint64
}

struct (0x73746d6f) JettonRefundAfterSellerTimeout {
    queryId: uint64
    settlementId: uint256
    buyerQueryId: uint64
    sellerQueryId: uint64
    treasuryQueryId: uint64
}

struct (0x62746d6f) JettonReleaseAfterBuyerTimeout {
    queryId: uint64
    settlementId: uint256
    buyerQueryId: uint64
    sellerQueryId: uint64
    treasuryQueryId: uint64
}

struct (0x64737074) JettonOpenDispute {
    queryId: uint64
}

struct (0x72736c76) JettonResolve {
    queryId: uint64
    settlementId: uint256
    buyerAward: coins
    sellerAward: coins
    buyerQueryId: uint64
    sellerQueryId: uint64
    treasuryQueryId: uint64
}

struct (0x72636e63) JettonReconcileAttempt {
    queryId: uint64
    settlementId: uint256
    attempt: uint32
    activeMask: uint8
    confirmedMask: uint8
    failedMask: uint8
    evidenceHash: uint256
}

struct (0x72747279) JettonRetryFailedLegs {
    queryId: uint64
    settlementId: uint256
    previousAttempt: uint32
    buyerQueryId: uint64
    sellerQueryId: uint64
    treasuryQueryId: uint64
}

struct (0x666e6c7a) JettonFinalizeSettlement {
    queryId: uint64
    settlementId: uint256
    attempt: uint32
    evidenceHash: uint256
}

/// TEP-74 transfer#0f8a7ea5. The custom payload is always present and commits the
/// immutable plan, attempt and leg. The forward payload is the canonical empty inline cell.
struct (0x0f8a7ea5) JettonTransfer {
    queryId: uint64
    amount: coins
    destination: address
    responseDestination: address
    customPayload: cell?
    forwardTonAmount: coins
    forwardPayload: RemainingBitsAndRefs
}

struct JettonPayoutCommitment {
    settlementId: uint256
    planHash: uint256
    attempt: uint32
    leg: uint8
}

type JettonAllowedMessage =
    | SealCanonicalJettonWallet
    | JettonTransferNotification
    | JettonMarkDelivered
    | JettonRelease
    | JettonRefundBuyer
    | JettonRefundAfterSellerTimeout
    | JettonReleaseAfterBuyerTimeout
    | JettonOpenDispute
    | JettonResolve
    | JettonReconcileAttempt
    | JettonRetryFailedLegs
    | JettonFinalizeSettlement
