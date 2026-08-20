const STATUS_AWAITING_FUNDING = 0
const STATUS_FUNDED = 1
const STATUS_DELIVERED = 2
const STATUS_DISPUTED = 3
const STATUS_RELEASED = 4
const STATUS_REFUNDED = 5
const STATUS_RESOLVED = 6

const PAYOUT_SELLER = 1
const PAYOUT_BUYER = 2
const PAYOUT_TREASURY = 3
const PAYOUT_EXCESS = 4

const MIN_OPERATIONAL_RESERVE: coins = 200000000

const ERROR_INVALID_CONFIG = 700
const ERROR_WRONG_STATE = 701
const ERROR_UNAUTHORIZED = 702
const ERROR_DEADLINE_PASSED = 703
const ERROR_DEADLINE_NOT_REACHED = 704
const ERROR_INSUFFICIENT_VALUE = 705
const ERROR_INVALID_AWARD = 707
const ERROR_UNKNOWN_MESSAGE = 708

struct RolesTail {
    arbitrator: address
    treasury: address
}

struct Roles {
    buyer: address
    seller: address
    tail: cell
}

struct Economics {
    buyerTotal: coins
    sellerPayout: coins
    platformFee: coins
    refundToBuyer: coins
    refundFee: coins
}

struct EscrowConfig {
    dealId: uint256
    termsHash: uint256
    quoteHash: uint256
    fundingDeadline: uint64
    deliveryDeadline: uint64
    confirmationDeadline: uint64
    roles: cell
    economics: cell
}

struct Storage {
    status: uint8
    fundedAmount: coins
    lastQueryId: uint64
    config: cell
}

fun Storage.load(): Storage {
    return Storage.fromCell(contract.getData());
}

fun Storage.save(self) {
    contract.setData(self.toCell());
}

fun Storage.loadConfig(self): EscrowConfig {
    return EscrowConfig.fromCell(self.config);
}

fun EscrowConfig.loadRoles(self): Roles {
    return Roles.fromCell(self.roles);
}

fun Roles.loadTail(self): RolesTail {
    return RolesTail.fromCell(self.tail);
}

fun EscrowConfig.loadEconomics(self): Economics {
    return Economics.fromCell(self.economics);
}

struct (0x66756e64) Fund {
    queryId: uint64
}

struct (0x64656c76) MarkDelivered {
    queryId: uint64
}

struct (0x72656c73) Release {
    queryId: uint64
}

struct (0x64737074) OpenDispute {
    queryId: uint64
}

struct (0x72656664) RefundBuyer {
    queryId: uint64
}

struct (0x73746d6f) RefundAfterSellerTimeout {
    queryId: uint64
}

struct (0x62746d6f) ReleaseAfterBuyerTimeout {
    queryId: uint64
}

struct (0x72736c76) Resolve {
    queryId: uint64
    buyerAward: coins
    sellerAward: coins
}

struct (0x7061796f) PayoutNotification {
    queryId: uint64
    dealId: uint256
    payoutKind: uint8
}

type AllowedMessage =
    | Fund
    | MarkDelivered
    | Release
    | OpenDispute
    | RefundBuyer
    | RefundAfterSellerTimeout
    | ReleaseAfterBuyerTimeout
    | Resolve
