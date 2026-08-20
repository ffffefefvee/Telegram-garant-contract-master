const JETTON_STATUS_AWAITING_FUNDING = 0
const JETTON_STATUS_FUNDED = 1

const JETTON_TRANSFER_NOTIFICATION_OPCODE = 0x7362d09c

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

type JettonAllowedMessage = SealCanonicalJettonWallet | JettonTransferNotification
