import "jetton-types"

contract TonJettonEscrow {
    author: "Telegram Garant"
    version: "0.1.0-funding-only"
    description: "Immutable per-deal Jetton escrow funding authenticator"
    incomingMessages: JettonTransferNotification
    storage: JettonEscrowStorage
}

fun assertJettonConfigIsValid(storage: JettonEscrowStorage) {
    val config = storage.loadConfig();
    val commitment = config.loadCommitment();
    val roles = commitment.loadRoles();
    val tail = roles.loadTail();
    val asset = commitment.loadAsset();
    val economics = commitment.loadEconomics();

    assert (config.dealId != 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (config.termsHash != 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (config.quoteHash != 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (config.fundingDeadline != 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (commitment.forwardPayloadHash != 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (economics.buyerTotal > 0) throw JETTON_ERROR_INVALID_CONFIG;
    assert (
        economics.sellerPayout + economics.platformFee == economics.buyerTotal
    ) throw JETTON_ERROR_INVALID_CONFIG;
    assert (
        economics.refundToBuyer + economics.refundFee == economics.buyerTotal
    ) throw JETTON_ERROR_INVALID_CONFIG;

    assert (roles.buyer != roles.seller) throw JETTON_ERROR_INVALID_CONFIG;
    assert (roles.buyer != tail.arbitrator) throw JETTON_ERROR_INVALID_CONFIG;
    assert (roles.seller != tail.arbitrator) throw JETTON_ERROR_INVALID_CONFIG;
    assert (tail.treasury != roles.buyer) throw JETTON_ERROR_INVALID_CONFIG;
    assert (tail.treasury != roles.seller) throw JETTON_ERROR_INVALID_CONFIG;
    assert (asset.master != asset.escrowWallet) throw JETTON_ERROR_INVALID_CONFIG;
    assert (asset.escrowWallet != roles.buyer) throw JETTON_ERROR_INVALID_CONFIG;
    assert (asset.escrowWallet != roles.seller) throw JETTON_ERROR_INVALID_CONFIG;

    assert (storage.status <= JETTON_STATUS_FUNDED) throw JETTON_ERROR_INVALID_CONFIG;
    if (storage.status == JETTON_STATUS_AWAITING_FUNDING) {
        assert (storage.fundedAmount == 0) throw JETTON_ERROR_INVALID_CONFIG;
    } else {
        assert (storage.fundedAmount == economics.buyerTotal) throw JETTON_ERROR_INVALID_CONFIG;
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

fun onInternalMessage(in: InMessage) {
    var storage = JettonEscrowStorage.load();
    assertJettonConfigIsValid(storage);

    // Empty bodies are reserved for deployment/account top-ups and can never fund a deal.
    if (in.body.isEmpty()) {
        return;
    }

    val config = storage.loadConfig();
    val commitment = config.loadCommitment();
    val roles = commitment.loadRoles();
    val asset = commitment.loadAsset();
    val economics = commitment.loadEconomics();

    assert (storage.status == JETTON_STATUS_AWAITING_FUNDING) throw JETTON_ERROR_WRONG_STATE;
    assert (in.senderAddress == asset.escrowWallet) throw JETTON_ERROR_UNAUTHORIZED_WALLET;
    assert (blockchain.now() <= config.fundingDeadline) throw JETTON_ERROR_DEADLINE_PASSED;

    val notification = JettonTransferNotification.fromSlice(
        in.body,
        { throwIfOpcodeDoesNotMatch: JETTON_ERROR_UNKNOWN_MESSAGE },
    );
    assert (notification.queryId == commitment.expectedQueryId) throw JETTON_ERROR_WRONG_QUERY_ID;
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

fun onBouncedMessage(_: InMessageBounced) {
    throw JETTON_ERROR_BOUNCED_MESSAGE;
}

get fun getJettonStatus(): int {
    return JettonEscrowStorage.load().status;
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
