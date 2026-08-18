import "types"

contract TonNativeEscrow {
    author: "Telegram Garant"
    version: "0.1.0"
    description: "Immutable per-deal native TON escrow"
    incomingMessages: AllowedMessage
    storage: Storage
}

fun assertConfigIsValid(storage: Storage) {
    val config = storage.loadConfig();
    val economics = config.loadEconomics();
    val roles = config.loadRoles();
    val tail = roles.loadTail();

    assert (config.dealId != 0) throw ERROR_INVALID_CONFIG;
    assert (config.termsHash != 0) throw ERROR_INVALID_CONFIG;
    assert (config.quoteHash != 0) throw ERROR_INVALID_CONFIG;
    assert (config.fundingDeadline < config.deliveryDeadline) throw ERROR_INVALID_CONFIG;
    assert (config.deliveryDeadline < config.confirmationDeadline) throw ERROR_INVALID_CONFIG;
    assert (economics.buyerTotal > 0) throw ERROR_INVALID_CONFIG;
    assert (
        economics.sellerPayout + economics.platformFee == economics.buyerTotal
    ) throw ERROR_INVALID_CONFIG;
    assert (
        economics.refundToBuyer + economics.refundFee == economics.buyerTotal
    ) throw ERROR_INVALID_CONFIG;
    assert (roles.buyer != roles.seller) throw ERROR_INVALID_CONFIG;
    assert (roles.buyer != tail.arbitrator) throw ERROR_INVALID_CONFIG;
    assert (roles.seller != tail.arbitrator) throw ERROR_INVALID_CONFIG;
    assert (tail.treasury != roles.buyer) throw ERROR_INVALID_CONFIG;
    assert (tail.treasury != roles.seller) throw ERROR_INVALID_CONFIG;
    assert (storage.status <= STATUS_RESOLVED) throw ERROR_INVALID_CONFIG;
    if (storage.status == STATUS_AWAITING_FUNDING) {
        assert (storage.fundedAmount == 0) throw ERROR_INVALID_CONFIG;
    } else {
        assert (storage.fundedAmount == economics.buyerTotal) throw ERROR_INVALID_CONFIG;
    }
}

fun sendPayout(dest: address, amount: coins, queryId: uint64, dealId: uint256, payoutKind: uint8) {
    if (amount > 0) {
        val payoutMessage = createMessage({
            bounce: false,
            dest,
            value: amount,
            body: PayoutNotification { queryId, dealId, payoutKind },
        });
        payoutMessage.send(SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_BOUNCE_ON_ACTION_FAIL);
    }
}

fun paySellerAndTreasury(storage: Storage, queryId: uint64) {
    val config = storage.loadConfig();
    val roles = config.loadRoles();
    val tail = roles.loadTail();
    val economics = config.loadEconomics();

    sendPayout(roles.seller, economics.sellerPayout, queryId, config.dealId, PAYOUT_SELLER);
    sendPayout(tail.treasury, economics.platformFee, queryId, config.dealId, PAYOUT_TREASURY);
}

fun payRefundAndTreasury(storage: Storage, queryId: uint64) {
    val config = storage.loadConfig();
    val roles = config.loadRoles();
    val tail = roles.loadTail();
    val economics = config.loadEconomics();

    sendPayout(roles.buyer, economics.refundToBuyer, queryId, config.dealId, PAYOUT_BUYER);
    sendPayout(tail.treasury, economics.refundFee, queryId, config.dealId, PAYOUT_TREASURY);
}

fun onInternalMessage(in: InMessage) {
    if (in.body.isEmpty()) {
        val storage = Storage.load();
        assertConfigIsValid(storage);
        return;
    }

    val incomingMessage = lazy AllowedMessage.fromSlice(in.body);
    var storage = Storage.load();
    assertConfigIsValid(storage);
    val config = storage.loadConfig();
    val roles = config.loadRoles();
    val tail = roles.loadTail();
    val economics = config.loadEconomics();

    match (incomingMessage) {
        Fund => {
            assert (storage.status == STATUS_AWAITING_FUNDING) throw ERROR_WRONG_STATE;
            assert (in.senderAddress == roles.buyer) throw ERROR_UNAUTHORIZED;
            assert (blockchain.now() <= config.fundingDeadline) throw ERROR_DEADLINE_PASSED;
            assert (
                in.valueCoins >= economics.buyerTotal + MIN_OPERATIONAL_RESERVE
            ) throw ERROR_INSUFFICIENT_VALUE;

            storage.status = STATUS_FUNDED;
            storage.fundedAmount = economics.buyerTotal;
            storage.lastQueryId = incomingMessage.queryId;
            storage.save();

            val excess = in.valueCoins - economics.buyerTotal - MIN_OPERATIONAL_RESERVE;
            sendPayout(roles.buyer, excess, incomingMessage.queryId, config.dealId, PAYOUT_EXCESS);
        }
        MarkDelivered => {
            assert (storage.status == STATUS_FUNDED) throw ERROR_WRONG_STATE;
            assert (in.senderAddress == roles.seller) throw ERROR_UNAUTHORIZED;
            assert (blockchain.now() <= config.deliveryDeadline) throw ERROR_DEADLINE_PASSED;

            storage.status = STATUS_DELIVERED;
            storage.lastQueryId = incomingMessage.queryId;
            storage.save();
        }
        Release => {
            assert (storage.status == STATUS_DELIVERED) throw ERROR_WRONG_STATE;
            assert (in.senderAddress == roles.buyer) throw ERROR_UNAUTHORIZED;
            assert (blockchain.now() <= config.confirmationDeadline) throw ERROR_DEADLINE_PASSED;

            storage.status = STATUS_RELEASED;
            storage.lastQueryId = incomingMessage.queryId;
            storage.save();
            paySellerAndTreasury(storage, incomingMessage.queryId);
        }
        OpenDispute => {
            assert (
                (storage.status == STATUS_FUNDED) | (storage.status == STATUS_DELIVERED)
            ) throw ERROR_WRONG_STATE;
            assert (
                (in.senderAddress == roles.buyer) | (in.senderAddress == roles.seller)
            ) throw ERROR_UNAUTHORIZED;
            if (storage.status == STATUS_FUNDED) {
                assert (blockchain.now() <= config.deliveryDeadline) throw ERROR_DEADLINE_PASSED;
            } else {
                assert (
                    blockchain.now() <= config.confirmationDeadline
                ) throw ERROR_DEADLINE_PASSED;
            }

            storage.status = STATUS_DISPUTED;
            storage.lastQueryId = incomingMessage.queryId;
            storage.save();
        }
        RefundBuyer => {
            assert (
                (storage.status == STATUS_FUNDED) | (storage.status == STATUS_DELIVERED)
            ) throw ERROR_WRONG_STATE;
            assert (in.senderAddress == roles.seller) throw ERROR_UNAUTHORIZED;

            storage.status = STATUS_REFUNDED;
            storage.lastQueryId = incomingMessage.queryId;
            storage.save();
            payRefundAndTreasury(storage, incomingMessage.queryId);
        }
        RefundAfterSellerTimeout => {
            assert (storage.status == STATUS_FUNDED) throw ERROR_WRONG_STATE;
            assert (blockchain.now() > config.deliveryDeadline) throw ERROR_DEADLINE_NOT_REACHED;

            storage.status = STATUS_REFUNDED;
            storage.lastQueryId = incomingMessage.queryId;
            storage.save();
            payRefundAndTreasury(storage, incomingMessage.queryId);
        }
        ReleaseAfterBuyerTimeout => {
            assert (storage.status == STATUS_DELIVERED) throw ERROR_WRONG_STATE;
            assert (
                blockchain.now() > config.confirmationDeadline
            ) throw ERROR_DEADLINE_NOT_REACHED;

            storage.status = STATUS_RELEASED;
            storage.lastQueryId = incomingMessage.queryId;
            storage.save();
            paySellerAndTreasury(storage, incomingMessage.queryId);
        }
        Resolve => {
            assert (storage.status == STATUS_DISPUTED) throw ERROR_WRONG_STATE;
            assert (in.senderAddress == tail.arbitrator) throw ERROR_UNAUTHORIZED;
            assert (
                incomingMessage.buyerAward + incomingMessage.sellerAward + economics.platformFee ==
                economics.buyerTotal
            ) throw ERROR_INVALID_AWARD;

            storage.status = STATUS_RESOLVED;
            storage.lastQueryId = incomingMessage.queryId;
            storage.save();
            sendPayout(
                roles.buyer,
                incomingMessage.buyerAward,
                incomingMessage.queryId,
                config.dealId,
                PAYOUT_BUYER,
            );
            sendPayout(
                roles.seller,
                incomingMessage.sellerAward,
                incomingMessage.queryId,
                config.dealId,
                PAYOUT_SELLER,
            );
            sendPayout(
                tail.treasury,
                economics.platformFee,
                incomingMessage.queryId,
                config.dealId,
                PAYOUT_TREASURY,
            );
        }
        else => {
            throw ERROR_UNKNOWN_MESSAGE;
        }
    }
}

get fun getStatus(): int {
    return Storage.load().status;
}

get fun getFundedAmount(): int {
    return Storage.load().fundedAmount;
}

get fun getLastQueryId(): int {
    return Storage.load().lastQueryId;
}

get fun getConfigHash(): int {
    return Storage.load().config.hash();
}
