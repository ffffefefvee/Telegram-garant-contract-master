import "jetton-types"

contract TonJettonEscrow {
    author: "Telegram Garant"
    version: "0.2.0-wallet-sealing"
    description: "Immutable per-deal Jetton escrow with post-deployment canonical wallet sealing"
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

    assert (storage.status <= JETTON_STATUS_FUNDED) throw JETTON_ERROR_INVALID_CONFIG;
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
        else => {
            throw JETTON_ERROR_UNKNOWN_MESSAGE;
        }
    }
}

fun onBouncedMessage(_: InMessageBounced) {
    throw JETTON_ERROR_BOUNCED_MESSAGE;
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
