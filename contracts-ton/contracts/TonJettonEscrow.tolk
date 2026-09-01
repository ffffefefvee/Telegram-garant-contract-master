import "jetton-types"

contract TonJettonEscrow {
    author: "Telegram Garant"
    version: "0.3.0-settlement-lifecycle"
    description: "Immutable per-deal Jetton escrow with proof-gated settlement recovery"
    incomingMessages: JettonAllowedMessage
    storage: JettonEscrowStorage
}

fun assertJettonIdentitySetIsDistinct(
    roles: JettonRoles,
    tail: JettonRolesTail,
    authorities: JettonAuthorities,
    asset: JettonAsset,
) {
    assert (roles.buyer != roles.seller) throw JETTON_ERROR_INVALID_CONFIG;
    assert (roles.buyer != tail.arbitrator) throw JETTON_ERROR_INVALID_CONFIG;
    assert (roles.buyer != tail.treasury) throw JETTON_ERROR_INVALID_CONFIG;
    assert (roles.buyer != authorities.initializer) throw JETTON_ERROR_INVALID_CONFIG;
    assert (roles.buyer != authorities.reconciliation) throw JETTON_ERROR_INVALID_CONFIG;
    assert (roles.buyer != asset.master) throw JETTON_ERROR_INVALID_CONFIG;

    assert (roles.seller != tail.arbitrator) throw JETTON_ERROR_INVALID_CONFIG;
    assert (roles.seller != tail.treasury) throw JETTON_ERROR_INVALID_CONFIG;
    assert (roles.seller != authorities.initializer) throw JETTON_ERROR_INVALID_CONFIG;
    assert (roles.seller != authorities.reconciliation) throw JETTON_ERROR_INVALID_CONFIG;
    assert (roles.seller != asset.master) throw JETTON_ERROR_INVALID_CONFIG;

    assert (tail.arbitrator != tail.treasury) throw JETTON_ERROR_INVALID_CONFIG;
    assert (tail.arbitrator != authorities.initializer) throw JETTON_ERROR_INVALID_CONFIG;
    assert (tail.arbitrator != authorities.reconciliation) throw JETTON_ERROR_INVALID_CONFIG;
    assert (tail.arbitrator != asset.master) throw JETTON_ERROR_INVALID_CONFIG;

    assert (tail.treasury != authorities.initializer) throw JETTON_ERROR_INVALID_CONFIG;
    assert (tail.treasury != authorities.reconciliation) throw JETTON_ERROR_INVALID_CONFIG;
    assert (tail.treasury != asset.master) throw JETTON_ERROR_INVALID_CONFIG;

    assert (
        authorities.initializer != authorities.reconciliation
    ) throw JETTON_ERROR_INVALID_CONFIG;
    assert (authorities.initializer != asset.master) throw JETTON_ERROR_INVALID_CONFIG;
    assert (authorities.reconciliation != asset.master) throw JETTON_ERROR_INVALID_CONFIG;
}

fun assertSealedWalletIsDistinct(
    wallet: address,
    roles: JettonRoles,
    tail: JettonRolesTail,
    authorities: JettonAuthorities,
    asset: JettonAsset,
) {
    assert (wallet != roles.buyer) throw JETTON_ERROR_INVALID_WALLET_SEAL;
    assert (wallet != roles.seller) throw JETTON_ERROR_INVALID_WALLET_SEAL;
    assert (wallet != tail.arbitrator) throw JETTON_ERROR_INVALID_WALLET_SEAL;
    assert (wallet != tail.treasury) throw JETTON_ERROR_INVALID_WALLET_SEAL;
    assert (wallet != authorities.initializer) throw JETTON_ERROR_INVALID_WALLET_SEAL;
    assert (wallet != authorities.reconciliation) throw JETTON_ERROR_INVALID_WALLET_SEAL;
    assert (wallet != asset.master) throw JETTON_ERROR_INVALID_WALLET_SEAL;
}

fun assertJettonConfigIsValid(storage: JettonEscrowStorage) {
    val config = storage.loadConfig();
    val commitment = config.loadCommitment();
    val roles = commitment.loadRoles();
    val tail = roles.loadTail();
    val authorities = commitment.loadAuthorities();
    val asset = commitment.loadAsset();
    val economics = commitment.loadEconomics();

    assert (config.dealId != 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (config.termsHash != 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (config.quoteHash != 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (config.fundingDeadline != 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (config.fundingDeadline < config.deliveryDeadline) throw JETTON_ERROR_INVALID_CONFIG;
    assert (
        config.deliveryDeadline < config.confirmationDeadline
    ) throw JETTON_ERROR_INVALID_CONFIG;
    // Query zero is reserved as the initial replay cursor, and sealing must use
    // a strictly positive query below the immutable funding query.
    assert (commitment.expectedQueryId > 1) throw JETTON_ERROR_INVALID_CONFIG;
    assert (commitment.forwardPayloadHash != 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (asset.walletCodeHash != 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (economics.buyerTotal > 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (
        economics.sellerPayout + economics.platformFee == economics.buyerTotal
    ) throw JETTON_ERROR_INVALID_CONFIG;
    assert (
        economics.refundToBuyer + economics.refundFee == economics.buyerTotal
    ) throw JETTON_ERROR_INVALID_CONFIG;
    assertJettonIdentitySetIsDistinct(roles, tail, authorities, asset);

    assert (storage.status <= JETTON_STATUS_SETTLED_FINALIZED) throw JETTON_ERROR_INVALID_CONFIG;
    assert (storage.walletSealed <= 1) throw JETTON_ERROR_INVALID_CONFIG;
    if (storage.status == JETTON_STATUS_AWAITING_FUNDING) {
        assert (storage.fundedAmount == 0) throw JETTON_ERROR_INVALID_CONFIG;
    } else {
        assert (storage.walletSealed == 1) throw JETTON_ERROR_INVALID_CONFIG;
        assert (storage.fundedAmount == economics.buyerTotal) throw JETTON_ERROR_INVALID_CONFIG;
    }

    if (storage.walletSealed == 0) {
        assert (storage.sealedWallet.beginParse().isEmpty()) throw JETTON_ERROR_INVALID_CONFIG;
    } else {
        val sealed = storage.loadSealedWallet();
        assert (sealed.verificationEvidenceHash != 0) throw JETTON_ERROR_INVALID_CONFIG;
        assertSealedWalletIsDistinct(sealed.wallet, roles, tail, authorities, asset);
    }

    if (storage.status < JETTON_STATUS_SETTLEMENT_PENDING) {
        assert (storage.settlement.beginParse().isEmpty()) throw JETTON_ERROR_INVALID_CONFIG;
    } else {
        val settlement = storage.loadSettlement();
        val base = settlement.loadBase();
        val attempt = settlement.loadAttempt();
        val destinations = base.loadDestinations();
        val amounts = base.loadAmounts();
        assert (base.settlementId != 0) throw JETTON_ERROR_INVALID_CONFIG;
        assert (
            (base.outcome >= JETTON_OUTCOME_RELEASE) & (base.outcome <= JETTON_OUTCOME_RESOLUTION)
        ) throw JETTON_ERROR_INVALID_CONFIG;
        assert ((base.activeMask & ~JETTON_ALL_LEGS) == 0) throw JETTON_ERROR_INVALID_CONFIG;
        assert (base.activeMask != 0) throw JETTON_ERROR_INVALID_CONFIG;
        assert (
            (attempt.confirmedMask & attempt.failedMask) == 0
        ) throw JETTON_ERROR_INVALID_CONFIG;
        assert ((attempt.confirmedMask & ~base.activeMask) == 0) throw JETTON_ERROR_INVALID_CONFIG;
        assert ((attempt.failedMask & ~base.activeMask) == 0) throw JETTON_ERROR_INVALID_CONFIG;
        assert ((attempt.bouncedMask & ~attempt.activeMask) == 0) throw JETTON_ERROR_INVALID_CONFIG;
        assert (destinations.buyer == roles.buyer) throw JETTON_ERROR_INVALID_CONFIG;
        assert (destinations.seller == roles.seller) throw JETTON_ERROR_INVALID_CONFIG;
        assert (destinations.treasury == tail.treasury) throw JETTON_ERROR_INVALID_CONFIG;
        assert (amounts.total == economics.buyerTotal) throw JETTON_ERROR_INVALID_CONFIG;
        assert (
            amounts.buyer + amounts.seller + amounts.treasury == amounts.total
        ) throw JETTON_ERROR_INVALID_CONFIG;
        assert (
            base.conservationCommitment == base.amounts.hash()
        ) throw JETTON_ERROR_INVALID_CONFIG;
        assert (
            attempt.activeMask == (base.activeMask & ~attempt.confirmedMask)
        ) throw JETTON_ERROR_INVALID_CONFIG;
        if (storage.status == JETTON_STATUS_RECOVERY_REQUIRED) {
            assert (attempt.failedMask == attempt.activeMask) throw JETTON_ERROR_INVALID_CONFIG;
            assert (attempt.reconciliationEvidenceHash != 0) throw JETTON_ERROR_INVALID_CONFIG;
        }
        if (storage.status == JETTON_STATUS_SETTLED_FINALIZED) {
            assert (attempt.confirmedMask == base.activeMask) throw JETTON_ERROR_INVALID_CONFIG;
            assert (attempt.reconciliationEvidenceHash != 0) throw JETTON_ERROR_INVALID_CONFIG;
        }
    }
}

fun loadCommittedForwardPayload(encoded: slice): cell {
    var cursor = encoded;
    assert (cursor.remainingBitsCount() >= 1) throw JETTON_ERROR_MALFORMED_FORWARD_PAYLOAD;

    val storedByReference = cursor.loadUint(1);
    if (storedByReference == 0) {
        return beginCell().storeSlice(cursor).endCell();
    }

    assert (cursor.remainingBitsCount() == 0) throw JETTON_ERROR_MALFORMED_FORWARD_PAYLOAD;
    assert (cursor.remainingRefsCount() == 1) throw JETTON_ERROR_MALFORMED_FORWARD_PAYLOAD;
    val payload = cursor.loadRef();
    cursor.assertEnd();
    return payload;
}

fun sealCanonicalWallet(
    sender: address,
    message: SealCanonicalJettonWallet,
    mutate storage: JettonEscrowStorage,
) {
    assert (storage.status == JETTON_STATUS_AWAITING_FUNDING) throw JETTON_ERROR_WRONG_STATE;
    assert (storage.walletSealed == 0) throw JETTON_ERROR_WALLET_ALREADY_SEALED;
    val commitment = storage.loadConfig().loadCommitment();
    val roles = commitment.loadRoles();
    val tail = roles.loadTail();
    val authorities = commitment.loadAuthorities();
    val asset = commitment.loadAsset();
    assert (sender == authorities.initializer) throw JETTON_ERROR_UNAUTHORIZED_INITIALIZER;
    assert (message.queryId > storage.lastQueryId) throw JETTON_ERROR_WRONG_QUERY_ID;
    assert (message.queryId < commitment.expectedQueryId) throw JETTON_ERROR_WRONG_QUERY_ID;
    assert (message.walletCodeHash == asset.walletCodeHash) throw JETTON_ERROR_INVALID_WALLET_SEAL;
    assert (message.verificationEvidenceHash != 0) throw JETTON_ERROR_INVALID_WALLET_SEAL;
    assertSealedWalletIsDistinct(message.wallet, roles, tail, authorities, asset);

    storage.walletSealed = 1;
    storage.lastQueryId = message.queryId;
    storage.sealedWallet = JettonSealedWallet {
        wallet: message.wallet,
        verificationEvidenceHash: message.verificationEvidenceHash,
    }.toCell();
    storage.save();
}

fun authenticateJettonFunding(
    sender: address,
    notification: JettonTransferNotification,
    mutate storage: JettonEscrowStorage,
) {
    assert (storage.status == JETTON_STATUS_AWAITING_FUNDING) throw JETTON_ERROR_WRONG_STATE;
    assert (storage.walletSealed == 1) throw JETTON_ERROR_WALLET_NOT_SEALED;
    val config = storage.loadConfig();
    val commitment = config.loadCommitment();
    val roles = commitment.loadRoles();
    val economics = commitment.loadEconomics();
    val sealed = storage.loadSealedWallet();
    assert (sender == sealed.wallet) throw JETTON_ERROR_UNAUTHORIZED_WALLET;
    assert (blockchain.now() <= config.fundingDeadline) throw JETTON_ERROR_DEADLINE_PASSED;
    assert (notification.queryId == commitment.expectedQueryId) throw JETTON_ERROR_WRONG_QUERY_ID;
    assert (notification.queryId > storage.lastQueryId) throw JETTON_ERROR_WRONG_QUERY_ID;
    assert (notification.amount == economics.buyerTotal) throw JETTON_ERROR_WRONG_AMOUNT;
    assert (notification.sender == roles.buyer) throw JETTON_ERROR_WRONG_BUYER;

    val payload = loadCommittedForwardPayload(notification.forwardPayload);
    assert (
        payload.hash() == commitment.forwardPayloadHash
    ) throw JETTON_ERROR_WRONG_FORWARD_PAYLOAD;

    storage.status = JETTON_STATUS_FUNDED;
    storage.fundedAmount = notification.amount;
    storage.lastQueryId = notification.queryId;
    storage.save();
}

fun activeLegMask(buyerAmount: coins, sellerAmount: coins, treasuryAmount: coins): uint8 {
    var mask: uint8 = 0;
    if (buyerAmount > 0) {
        mask |= JETTON_LEG_BUYER;
    }
    if (sellerAmount > 0) {
        mask |= JETTON_LEG_SELLER;
    }
    if (treasuryAmount > 0) {
        mask |= JETTON_LEG_TREASURY;
    }
    return mask;
}

fun assertFreshSettlementQueries(
    actionQueryId: uint64,
    buyerQueryId: uint64,
    sellerQueryId: uint64,
    treasuryQueryId: uint64,
    activeMask: uint8,
    lastQueryId: uint64,
): uint64 {
    assert (actionQueryId > lastQueryId) throw JETTON_ERROR_WRONG_QUERY_ID;
    var greatest = actionQueryId;
    if ((activeMask & JETTON_LEG_BUYER) != 0) {
        assert (buyerQueryId > greatest) throw JETTON_ERROR_WRONG_QUERY_ID;
        greatest = buyerQueryId;
    } else {
        assert (buyerQueryId == 0) throw JETTON_ERROR_WRONG_QUERY_ID;
    }
    if ((activeMask & JETTON_LEG_SELLER) != 0) {
        assert (sellerQueryId > greatest) throw JETTON_ERROR_WRONG_QUERY_ID;
        greatest = sellerQueryId;
    } else {
        assert (sellerQueryId == 0) throw JETTON_ERROR_WRONG_QUERY_ID;
    }
    if ((activeMask & JETTON_LEG_TREASURY) != 0) {
        assert (treasuryQueryId > greatest) throw JETTON_ERROR_WRONG_QUERY_ID;
        greatest = treasuryQueryId;
    } else {
        assert (treasuryQueryId == 0) throw JETTON_ERROR_WRONG_QUERY_ID;
    }
    assert (greatest != 0xffffffffffffffff) throw JETTON_ERROR_QUERY_EXHAUSTED;
    return greatest;
}

fun sendJettonPayout(
    wallet: address,
    destination: address,
    amount: coins,
    queryId: uint64,
    settlementId: uint256,
    planHash: uint256,
    attempt: uint32,
    leg: uint8,
) {
    val commitment = JettonPayoutCommitment { settlementId, planHash, attempt, leg }.toCell();
    val transfer = JettonTransfer {
        queryId,
        amount,
        destination,
        responseDestination: contract.getAddress(),
        customPayload: commitment,
        forwardTonAmount: 0,
        forwardPayload: beginCell().storeUint(0, 1).endCell().beginParse(),
    };
    val payoutMessage = createMessage({
        bounce: BounceMode.RichBounce,
        dest: wallet,
        value: JETTON_PAYOUT_MESSAGE_VALUE,
        body: transfer,
    });
    payoutMessage.send(SEND_MODE_PAY_FEES_SEPARATELY | SEND_MODE_BOUNCE_ON_ACTION_FAIL);
}

fun dispatchSettlementAttempt(storage: JettonEscrowStorage) {
    val settlement = storage.loadSettlement();
    val base = settlement.loadBase();
    val attempt = settlement.loadAttempt();
    val destinations = base.loadDestinations();
    val amounts = base.loadAmounts();
    val queries = attempt.loadQueries();
    val wallet = storage.loadSealedWallet().wallet;
    val planHash = settlement.base.hash();

    if ((attempt.activeMask & JETTON_LEG_BUYER) != 0) {
        sendJettonPayout(
            wallet,
            destinations.buyer,
            amounts.buyer,
            queries.buyer,
            base.settlementId,
            planHash,
            attempt.attempt,
            JETTON_LEG_BUYER,
        );
    }
    if ((attempt.activeMask & JETTON_LEG_SELLER) != 0) {
        sendJettonPayout(
            wallet,
            destinations.seller,
            amounts.seller,
            queries.seller,
            base.settlementId,
            planHash,
            attempt.attempt,
            JETTON_LEG_SELLER,
        );
    }
    if ((attempt.activeMask & JETTON_LEG_TREASURY) != 0) {
        sendJettonPayout(
            wallet,
            destinations.treasury,
            amounts.treasury,
            queries.treasury,
            base.settlementId,
            planHash,
            attempt.attempt,
            JETTON_LEG_TREASURY,
        );
    }
}

fun beginSettlement(
    outcome: uint8,
    settlementId: uint256,
    actionQueryId: uint64,
    buyerAmount: coins,
    sellerAmount: coins,
    treasuryAmount: coins,
    buyerQueryId: uint64,
    sellerQueryId: uint64,
    treasuryQueryId: uint64,
    mutate storage: JettonEscrowStorage,
) {
    assert (settlementId != 0) throw JETTON_ERROR_INVALID_SETTLEMENT;
    val config = storage.loadConfig();
    val commitment = config.loadCommitment();
    val roles = commitment.loadRoles();
    val tail = roles.loadTail();
    val economics = commitment.loadEconomics();
    val mask = activeLegMask(buyerAmount, sellerAmount, treasuryAmount);
    val greatestQueryId = assertFreshSettlementQueries(
        actionQueryId,
        buyerQueryId,
        sellerQueryId,
        treasuryQueryId,
        mask,
        storage.lastQueryId,
    );
    val amounts = JettonSettlementAmounts {
        buyer: buyerAmount,
        seller: sellerAmount,
        treasury: treasuryAmount,
        total: economics.buyerTotal,
    }.toCell();
    val base = JettonSettlementBase {
        settlementId,
        outcome,
        activeMask: mask,
        conservationCommitment: amounts.hash(),
        destinations: JettonSettlementDestinations {
            buyer: roles.buyer,
            seller: roles.seller,
            treasury: tail.treasury,
        }.toCell(),
        amounts,
    }.toCell();
    val attempt = JettonSettlementAttempt {
        attempt: 0,
        activeMask: mask,
        confirmedMask: 0,
        failedMask: 0,
        bouncedMask: 0,
        reconciliationEvidenceHash: 0,
        queries: JettonSettlementQueries {
            buyer: buyerQueryId,
            seller: sellerQueryId,
            treasury: treasuryQueryId,
        }.toCell(),
    }.toCell();
    storage.status = JETTON_STATUS_SETTLEMENT_PENDING;
    storage.lastQueryId = greatestQueryId;
    storage.settlement = JettonSettlement { base, attempt }.toCell();
    storage.save();
    dispatchSettlementAttempt(storage);
}

fun markDelivered(sender: address, queryId: uint64, mutate storage: JettonEscrowStorage) {
    assert (storage.status == JETTON_STATUS_FUNDED) throw JETTON_ERROR_WRONG_STATE;
    val config = storage.loadConfig();
    val roles = config.loadCommitment().loadRoles();
    assert (sender == roles.seller) throw JETTON_ERROR_UNAUTHORIZED;
    assert (blockchain.now() <= config.deliveryDeadline) throw JETTON_ERROR_DEADLINE_PASSED;
    assert (queryId > storage.lastQueryId) throw JETTON_ERROR_WRONG_QUERY_ID;
    storage.status = JETTON_STATUS_DELIVERED;
    storage.lastQueryId = queryId;
    storage.save();
}

fun openDispute(sender: address, queryId: uint64, mutate storage: JettonEscrowStorage) {
    assert (
        (storage.status == JETTON_STATUS_FUNDED) | (storage.status == JETTON_STATUS_DELIVERED)
    ) throw JETTON_ERROR_WRONG_STATE;
    val config = storage.loadConfig();
    val roles = config.loadCommitment().loadRoles();
    assert ((sender == roles.buyer) | (sender == roles.seller)) throw JETTON_ERROR_UNAUTHORIZED;
    if (storage.status == JETTON_STATUS_FUNDED) {
        assert (blockchain.now() <= config.deliveryDeadline) throw JETTON_ERROR_DEADLINE_PASSED;
    } else {
        assert (blockchain.now() <= config.confirmationDeadline) throw JETTON_ERROR_DEADLINE_PASSED;
    }
    assert (queryId > storage.lastQueryId) throw JETTON_ERROR_WRONG_QUERY_ID;
    storage.status = JETTON_STATUS_DISPUTED;
    storage.lastQueryId = queryId;
    storage.save();
}

fun reconcileAttempt(
    sender: address,
    message: JettonReconcileAttempt,
    mutate storage: JettonEscrowStorage,
) {
    assert (storage.status == JETTON_STATUS_SETTLEMENT_PENDING) throw JETTON_ERROR_WRONG_STATE;
    val authorities = storage.loadConfig().loadCommitment().loadAuthorities();
    assert (sender == authorities.reconciliation) throw JETTON_ERROR_UNAUTHORIZED;
    assert (message.queryId > storage.lastQueryId) throw JETTON_ERROR_WRONG_QUERY_ID;
    assert (message.evidenceHash != 0) throw JETTON_ERROR_INCOMPLETE_RECONCILIATION;
    val settlement = storage.loadSettlement();
    val base = settlement.loadBase();
    var attempt = settlement.loadAttempt();
    assert (message.settlementId == base.settlementId) throw JETTON_ERROR_INVALID_SETTLEMENT;
    assert (message.attempt == attempt.attempt) throw JETTON_ERROR_STALE_ATTEMPT;
    assert (message.activeMask == attempt.activeMask) throw JETTON_ERROR_INVALID_MASK;
    assert ((message.confirmedMask & message.failedMask) == 0) throw JETTON_ERROR_INVALID_MASK;
    assert (
        (message.confirmedMask | message.failedMask) == message.activeMask
    ) throw JETTON_ERROR_INCOMPLETE_RECONCILIATION;
    assert (
        (attempt.bouncedMask & message.failedMask) == attempt.bouncedMask
    ) throw JETTON_ERROR_INVALID_BOUNCE;
    attempt.confirmedMask |= message.confirmedMask;
    attempt.failedMask = message.failedMask;
    attempt.activeMask = message.failedMask;
    attempt.reconciliationEvidenceHash = message.evidenceHash;
    storage.lastQueryId = message.queryId;
    if (message.failedMask != 0) {
        storage.status = JETTON_STATUS_RECOVERY_REQUIRED;
    }
    storage.settlement = JettonSettlement {
        base: settlement.base,
        attempt: attempt.toCell(),
    }.toCell();
    storage.save();
}

fun retryFailedLegs(
    sender: address,
    message: JettonRetryFailedLegs,
    mutate storage: JettonEscrowStorage,
) {
    assert (storage.status == JETTON_STATUS_RECOVERY_REQUIRED) throw JETTON_ERROR_WRONG_STATE;
    val authorities = storage.loadConfig().loadCommitment().loadAuthorities();
    assert (sender == authorities.reconciliation) throw JETTON_ERROR_UNAUTHORIZED;
    val settlement = storage.loadSettlement();
    val base = settlement.loadBase();
    val previous = settlement.loadAttempt();
    assert (message.settlementId == base.settlementId) throw JETTON_ERROR_INVALID_SETTLEMENT;
    assert (message.previousAttempt == previous.attempt) throw JETTON_ERROR_STALE_ATTEMPT;
    assert (previous.attempt < 0xffffffff) throw JETTON_ERROR_QUERY_EXHAUSTED;
    val greatestQueryId = assertFreshSettlementQueries(
        message.queryId,
        message.buyerQueryId,
        message.sellerQueryId,
        message.treasuryQueryId,
        previous.failedMask,
        storage.lastQueryId,
    );
    val next = JettonSettlementAttempt {
        attempt: previous.attempt + 1,
        activeMask: previous.failedMask,
        confirmedMask: previous.confirmedMask,
        failedMask: 0,
        bouncedMask: 0,
        reconciliationEvidenceHash: 0,
        queries: JettonSettlementQueries {
            buyer: message.buyerQueryId,
            seller: message.sellerQueryId,
            treasury: message.treasuryQueryId,
        }.toCell(),
    };
    storage.status = JETTON_STATUS_SETTLEMENT_PENDING;
    storage.lastQueryId = greatestQueryId;
    storage.settlement = JettonSettlement {
        base: settlement.base,
        attempt: next.toCell(),
    }.toCell();
    storage.save();
    dispatchSettlementAttempt(storage);
}

fun finalizeSettlement(
    sender: address,
    message: JettonFinalizeSettlement,
    mutate storage: JettonEscrowStorage,
) {
    assert (storage.status == JETTON_STATUS_SETTLEMENT_PENDING) throw JETTON_ERROR_WRONG_STATE;
    val authorities = storage.loadConfig().loadCommitment().loadAuthorities();
    assert (sender == authorities.reconciliation) throw JETTON_ERROR_UNAUTHORIZED;
    assert (message.queryId > storage.lastQueryId) throw JETTON_ERROR_WRONG_QUERY_ID;
    val settlement = storage.loadSettlement();
    val base = settlement.loadBase();
    var attempt = settlement.loadAttempt();
    assert (message.settlementId == base.settlementId) throw JETTON_ERROR_INVALID_SETTLEMENT;
    assert (message.attempt == attempt.attempt) throw JETTON_ERROR_STALE_ATTEMPT;
    assert (
        message.evidenceHash == attempt.reconciliationEvidenceHash
    ) throw JETTON_ERROR_INCOMPLETE_RECONCILIATION;
    assert (message.evidenceHash != 0) throw JETTON_ERROR_INCOMPLETE_RECONCILIATION;
    assert (attempt.confirmedMask == base.activeMask) throw JETTON_ERROR_INCOMPLETE_RECONCILIATION;
    storage.status = JETTON_STATUS_SETTLED_FINALIZED;
    storage.lastQueryId = message.queryId;
    storage.settlement = JettonSettlement {
        base: settlement.base,
        attempt: attempt.toCell(),
    }.toCell();
    storage.save();
}

fun onInternalMessage(in: InMessage) {
    var storage = JettonEscrowStorage.load();
    assertJettonConfigIsValid(storage);
    if (in.body.isEmpty()) {
        return;
    }

    val message = lazy JettonAllowedMessage.fromSlice(
        in.body,
        { throwIfOpcodeDoesNotMatch: JETTON_ERROR_UNKNOWN_MESSAGE },
    );
    match (message) {
        SealCanonicalJettonWallet => {
            sealCanonicalWallet(in.senderAddress, message, mutate storage);
        }
        JettonTransferNotification => {
            authenticateJettonFunding(in.senderAddress, message, mutate storage);
        }
        JettonMarkDelivered => {
            markDelivered(in.senderAddress, message.queryId, mutate storage);
        }
        JettonRelease => {
            assert (storage.status == JETTON_STATUS_DELIVERED) throw JETTON_ERROR_WRONG_STATE;
            val config = storage.loadConfig();
            val commitment = config.loadCommitment();
            val roles = commitment.loadRoles();
            val economics = commitment.loadEconomics();
            assert (in.senderAddress == roles.buyer) throw JETTON_ERROR_UNAUTHORIZED;
            assert (
                blockchain.now() <= config.confirmationDeadline
            ) throw JETTON_ERROR_DEADLINE_PASSED;
            beginSettlement(
                JETTON_OUTCOME_RELEASE,
                message.settlementId,
                message.queryId,
                0,
                economics.sellerPayout,
                economics.platformFee,
                message.buyerQueryId,
                message.sellerQueryId,
                message.treasuryQueryId,
                mutate storage,
            );
        }
        JettonRefundBuyer => {
            assert (
                (storage.status == JETTON_STATUS_FUNDED) |
                (storage.status == JETTON_STATUS_DELIVERED)
            ) throw JETTON_ERROR_WRONG_STATE;
            val commitment = storage.loadConfig().loadCommitment();
            val roles = commitment.loadRoles();
            val economics = commitment.loadEconomics();
            assert (in.senderAddress == roles.seller) throw JETTON_ERROR_UNAUTHORIZED;
            beginSettlement(
                JETTON_OUTCOME_REFUND,
                message.settlementId,
                message.queryId,
                economics.refundToBuyer,
                0,
                economics.refundFee,
                message.buyerQueryId,
                message.sellerQueryId,
                message.treasuryQueryId,
                mutate storage,
            );
        }
        JettonRefundAfterSellerTimeout => {
            assert (storage.status == JETTON_STATUS_FUNDED) throw JETTON_ERROR_WRONG_STATE;
            val config = storage.loadConfig();
            val economics = config.loadCommitment().loadEconomics();
            assert (
                blockchain.now() > config.deliveryDeadline
            ) throw JETTON_ERROR_DEADLINE_NOT_REACHED;
            beginSettlement(
                JETTON_OUTCOME_REFUND,
                message.settlementId,
                message.queryId,
                economics.refundToBuyer,
                0,
                economics.refundFee,
                message.buyerQueryId,
                message.sellerQueryId,
                message.treasuryQueryId,
                mutate storage,
            );
        }
        JettonReleaseAfterBuyerTimeout => {
            assert (storage.status == JETTON_STATUS_DELIVERED) throw JETTON_ERROR_WRONG_STATE;
            val config = storage.loadConfig();
            val economics = config.loadCommitment().loadEconomics();
            assert (
                blockchain.now() > config.confirmationDeadline
            ) throw JETTON_ERROR_DEADLINE_NOT_REACHED;
            beginSettlement(
                JETTON_OUTCOME_RELEASE,
                message.settlementId,
                message.queryId,
                0,
                economics.sellerPayout,
                economics.platformFee,
                message.buyerQueryId,
                message.sellerQueryId,
                message.treasuryQueryId,
                mutate storage,
            );
        }
        JettonOpenDispute => {
            openDispute(in.senderAddress, message.queryId, mutate storage);
        }
        JettonResolve => {
            assert (storage.status == JETTON_STATUS_DISPUTED) throw JETTON_ERROR_WRONG_STATE;
            val commitment = storage.loadConfig().loadCommitment();
            val roles = commitment.loadRoles();
            val tail = roles.loadTail();
            val economics = commitment.loadEconomics();
            assert (in.senderAddress == tail.arbitrator) throw JETTON_ERROR_UNAUTHORIZED;
            assert (
                message.buyerAward + message.sellerAward + economics.platformFee ==
                economics.buyerTotal
            ) throw JETTON_ERROR_INVALID_SETTLEMENT;
            beginSettlement(
                JETTON_OUTCOME_RESOLUTION,
                message.settlementId,
                message.queryId,
                message.buyerAward,
                message.sellerAward,
                economics.platformFee,
                message.buyerQueryId,
                message.sellerQueryId,
                message.treasuryQueryId,
                mutate storage,
            );
        }
        JettonReconcileAttempt => {
            reconcileAttempt(in.senderAddress, message, mutate storage);
        }
        JettonRetryFailedLegs => {
            retryFailedLegs(in.senderAddress, message, mutate storage);
        }
        JettonFinalizeSettlement => {
            finalizeSettlement(in.senderAddress, message, mutate storage);
        }
        else => {
            throw JETTON_ERROR_UNKNOWN_MESSAGE;
        }
    }
}

fun onBouncedMessage(in: InMessageBounced) {
    var storage = JettonEscrowStorage.load();
    assertJettonConfigIsValid(storage);
    assert (storage.status == JETTON_STATUS_SETTLEMENT_PENDING) throw JETTON_ERROR_BOUNCED_MESSAGE;
    assert (
        in.senderAddress == storage.loadSealedWallet().wallet
    ) throw JETTON_ERROR_UNAUTHORIZED_WALLET;

    val rich = lazy RichBounceBody.fromSlice(in.bouncedBody);
    val transfer = lazy JettonTransfer.fromSlice(
        rich.originalBody.beginParse(),
        { throwIfOpcodeDoesNotMatch: JETTON_ERROR_INVALID_BOUNCE },
    );
    val settlement = storage.loadSettlement();
    val base = settlement.loadBase();
    var attempt = settlement.loadAttempt();
    val queries = attempt.loadQueries();
    val destinations = base.loadDestinations();
    val amounts = base.loadAmounts();
    var expectedLeg: uint8 = 0;
    var expectedDestination = destinations.buyer;
    var expectedAmount: coins = 0;
    if (transfer.queryId == queries.buyer) {
        expectedLeg = JETTON_LEG_BUYER;
        expectedDestination = destinations.buyer;
        expectedAmount = amounts.buyer;
    } else if (transfer.queryId == queries.seller) {
        expectedLeg = JETTON_LEG_SELLER;
        expectedDestination = destinations.seller;
        expectedAmount = amounts.seller;
    } else if (transfer.queryId == queries.treasury) {
        expectedLeg = JETTON_LEG_TREASURY;
        expectedDestination = destinations.treasury;
        expectedAmount = amounts.treasury;
    }
    assert ((attempt.activeMask & expectedLeg) != 0) throw JETTON_ERROR_STALE_ATTEMPT;
    assert ((attempt.bouncedMask & expectedLeg) == 0) throw JETTON_ERROR_STALE_ATTEMPT;
    assert (transfer.destination == expectedDestination) throw JETTON_ERROR_INVALID_BOUNCE;
    assert (transfer.amount == expectedAmount) throw JETTON_ERROR_INVALID_BOUNCE;
    assert (
        transfer.responseDestination == contract.getAddress()
    ) throw JETTON_ERROR_INVALID_BOUNCE;
    assert (transfer.forwardTonAmount == 0) throw JETTON_ERROR_INVALID_BOUNCE;
    assert (transfer.customPayload != null) throw JETTON_ERROR_INVALID_BOUNCE;
    val expectedPayload = JettonPayoutCommitment {
        settlementId: base.settlementId,
        planHash: settlement.base.hash(),
        attempt: attempt.attempt,
        leg: expectedLeg,
    }.toCell();
    assert (transfer.customPayload == expectedPayload) throw JETTON_ERROR_INVALID_BOUNCE;
    var forwardPayload = transfer.forwardPayload;
    assert (forwardPayload.remainingBitsCount() == 1) throw JETTON_ERROR_INVALID_BOUNCE;
    assert (forwardPayload.remainingRefsCount() == 0) throw JETTON_ERROR_INVALID_BOUNCE;
    assert (forwardPayload.loadUint(1) == 0) throw JETTON_ERROR_INVALID_BOUNCE;
    forwardPayload.assertEnd();
    attempt.bouncedMask |= expectedLeg;
    storage.settlement = JettonSettlement {
        base: settlement.base,
        attempt: attempt.toCell(),
    }.toCell();
    storage.save();
}

get fun getJettonStatus(): int {
    return JettonEscrowStorage.load().status;
}

get fun getJettonWalletSealed(): int {
    return JettonEscrowStorage.load().walletSealed;
}

get fun getJettonFundedAmount(): int {
    return JettonEscrowStorage.load().fundedAmount;
}

get fun getJettonLastQueryId(): int {
    return JettonEscrowStorage.load().lastQueryId;
}

get fun getJettonConfigHash(): int {
    return JettonEscrowStorage.load().config.hash();
}

get fun getJettonSealedWalletHash(): int {
    return JettonEscrowStorage.load().sealedWallet.hash();
}

get fun getJettonSettlementHash(): int {
    return JettonEscrowStorage.load().settlement.hash();
}
