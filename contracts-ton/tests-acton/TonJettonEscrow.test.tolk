import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"

import "@contracts/jetton-types"
import "@wrappers/TonJettonEscrow.gen"

const JETTON_TEST_NOW = 2100000000
const JETTON_BUYER_TOTAL: coins = 5000000000
const JETTON_SELLER_PAYOUT: coins = 4900000000
const JETTON_PLATFORM_FEE: coins = 100000000
const JETTON_REFUND_TO_BUYER: coins = 4950000000
const JETTON_REFUND_FEE: coins = 50000000
const JETTON_QUERY_ID: uint64 = 9001
const JETTON_SEAL_QUERY_ID: uint64 = 1
const JETTON_WALLET_CODE_HASH: uint256 = 0xabcde12345
const JETTON_WALLET_EVIDENCE_HASH: uint256 = 0x987654321

struct JettonTestActors {
    buyer: Treasury
    seller: Treasury
    arbitrator: Treasury
    treasury: Treasury
    master: Treasury
    wallet: Treasury
    fakeWallet: Treasury
    initializer: Treasury
    reconciliation: Treasury
    outsider: Treasury
}

struct JettonTestContext {
    escrow: TonJettonEscrow
    actors: JettonTestActors
    payload: cell
    config: JettonEscrowConfig
}

fun jettonActors(): JettonTestActors {
    return JettonTestActors {
        buyer: testing.treasury("jetton-buyer"),
        seller: testing.treasury("jetton-seller"),
        arbitrator: testing.treasury("jetton-arbitrator"),
        treasury: testing.treasury("jetton-treasury"),
        master: testing.treasury("jetton-master"),
        wallet: testing.treasury("canonical-escrow-jetton-wallet"),
        fakeWallet: testing.treasury("master-adjacent-fake-jetton-wallet"),
        initializer: testing.treasury("jetton-wallet-initializer-multisig"),
        reconciliation: testing.treasury("jetton-reconciliation-multisig"),
        outsider: testing.treasury("jetton-outsider"),
    };
}

fun jettonPayload(dealId: uint256): cell {
    return beginCell().storeUint(0x54474152, 32).storeUint(dealId, 256).endCell();
}

fun jettonConfig(
    actors: JettonTestActors,
    dealId: uint256,
    payload: cell,
): JettonEscrowConfig {
    val roles = JettonRoles {
        buyer: actors.buyer.address,
        seller: actors.seller.address,
        tail: JettonRolesTail {
            arbitrator: actors.arbitrator.address,
            treasury: actors.treasury.address,
        }.toCell(),
    };
    val commitment = JettonFundingCommitment {
        expectedQueryId: JETTON_QUERY_ID,
        forwardPayloadHash: payload.hash(),
        roles: roles.toCell(),
        authorities: JettonAuthorities {
            initializer: actors.initializer.address,
            reconciliation: actors.reconciliation.address,
        }.toCell(),
        asset: JettonAsset {
            master: actors.master.address,
            walletCodeHash: JETTON_WALLET_CODE_HASH,
        }.toCell(),
        economics: JettonEconomics {
            buyerTotal: JETTON_BUYER_TOTAL,
            sellerPayout: JETTON_SELLER_PAYOUT,
            platformFee: JETTON_PLATFORM_FEE,
            refundToBuyer: JETTON_REFUND_TO_BUYER,
            refundFee: JETTON_REFUND_FEE,
        }.toCell(),
    };
    return JettonEscrowConfig {
        dealId,
        termsHash: 0x11112222,
        quoteHash: 0x33334444,
        fundingDeadline: JETTON_TEST_NOW + 100,
        commitment: commitment.toCell(),
    };
}

fun jettonEscrow(config: JettonEscrowConfig): TonJettonEscrow {
    return TonJettonEscrow.fromStorage(JettonEscrowStorage {
        status: JETTON_STATUS_AWAITING_FUNDING,
        walletSealed: 0,
        fundedAmount: 0,
        lastQueryId: 0,
        config: config.toCell(),
        sealedWallet: beginCell().endCell(),
    });
}

fun sealJettonWallet(escrow: TonJettonEscrow, actors: JettonTestActors): SendResultList {
    return escrow.sendAny(
        actors.initializer.address,
        SealCanonicalJettonWallet {
            queryId: JETTON_SEAL_QUERY_ID,
            wallet: actors.wallet.address,
            walletCodeHash: JETTON_WALLET_CODE_HASH,
            verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
        }.toCell(),
        { value: ton("0.08"), bounce: false },
    );
}

fun setupJettonEscrow(dealId: uint256, sealWallet: bool = true): JettonTestContext {
    testing.setNow(JETTON_TEST_NOW);
    val actors = jettonActors();
    val payload = jettonPayload(dealId);
    val config = jettonConfig(actors, dealId, payload);
    val escrow = jettonEscrow(config);
    val deploy = escrow.deploy(actors.outsider.address, { value: ton("0.3"), bounce: false });
    expect(deploy).toHaveSuccessfulDeploy({ to: escrow.address });
    if (sealWallet) {
        val sealed = sealJettonWallet(escrow, actors);
        expect(sealed).toHaveSuccessfulTx<SealCanonicalJettonWallet>({
            from: actors.initializer.address,
            to: escrow.address,
        });
        expect(escrow.getJettonWalletSealed()).toEqual(1);
    }
    return JettonTestContext { escrow, actors, payload, config };
}

fun notificationBody(
    queryId: uint64,
    amount: coins,
    buyer: address,
    payload: cell,
    byReference: bool = false,
): cell {
    var body = beginCell()
        .storeUint(JETTON_TRANSFER_NOTIFICATION_OPCODE, 32)
        .storeUint(queryId, 64)
        .storeCoins(amount)
        .storeAddress(buyer);
    if (byReference) {
        body.storeUint(1, 1).storeRef(payload);
    } else {
        body.storeUint(0, 1).storeSlice(payload.beginParse());
    }
    return body.endCell();
}

fun expectJettonFundingFailure(
    ctx: JettonTestContext,
    from: address,
    body: cell,
    exitCode: int,
) {
    val result = ctx.escrow.sendAny(from, body, { value: ton("0.08"), bounce: false });
    expect(result).toHaveFailedTx({
        from,
        to: ctx.escrow.address,
        exitCode,
    });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_AWAITING_FUNDING);
    expect(ctx.escrow.getJettonFundedAmount()).toEqual(0);
    expect(ctx.escrow.getJettonLastQueryId()).toEqual(JETTON_SEAL_QUERY_ID);
}

fun expectInvalidJettonStorage(actors: JettonTestActors, storage: JettonEscrowStorage) {
    val escrow = TonJettonEscrow.fromStorage(storage);
    val deploy = escrow.deploy(actors.outsider.address, { value: ton("0.3"), bounce: false });
    expect(deploy).toHaveFailedTx({
        to: escrow.address,
        exitCode: JETTON_ERROR_INVALID_CONFIG,
    });
}

fun expectInvalidJettonConfig(actors: JettonTestActors, config: JettonEscrowConfig) {
    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: JETTON_STATUS_AWAITING_FUNDING,
            walletSealed: 0,
            fundedAmount: 0,
            lastQueryId: 0,
            config: config.toCell(),
            sealedWallet: beginCell().endCell(),
        },
    );
}

get fun `test Jetton StateInit omits wallet and funding is impossible before one-time seal`() {
    val ctx = setupJettonEscrow(1901, false);
    expect(ctx.escrow.getJettonWalletSealed()).toEqual(0);
    expect(ctx.escrow.getJettonSealedWalletHash()).toEqual(beginCell().endCell().hash());

    val premature = ctx
        .escrow
        .sendAny(
            ctx.actors.wallet.address,
            notificationBody(
                JETTON_QUERY_ID,
                JETTON_BUYER_TOTAL,
                ctx.actors.buyer.address,
                ctx.payload,
            ),
            { value: ton("0.08"), bounce: false },
        );
    expect(premature).toHaveFailedTx({ exitCode: JETTON_ERROR_WALLET_NOT_SEALED });
    expect(ctx.escrow.getJettonWalletSealed()).toEqual(0);
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_AWAITING_FUNDING);

    val configHash = ctx.escrow.getJettonConfigHash();
    val sealed = sealJettonWallet(ctx.escrow, ctx.actors);
    expect(sealed).toHaveSuccessfulTx<SealCanonicalJettonWallet>({
        from: ctx.actors.initializer.address,
        to: ctx.escrow.address,
    });
    expect(ctx.escrow.getJettonWalletSealed()).toEqual(1);
    expect(ctx.escrow.getJettonConfigHash()).toEqual(configHash);
    expect(ctx.escrow.getJettonLastQueryId()).toEqual(JETTON_SEAL_QUERY_ID);

    val replay = sealJettonWallet(ctx.escrow, ctx.actors);
    expect(replay).toHaveFailedTx({ exitCode: JETTON_ERROR_WALLET_ALREADY_SEALED });
}

get fun `test Jetton wallet seal rejects unauthorized and malformed commitments without mutation`() {
    val unauthorized = setupJettonEscrow(1902, false);
    val unauthorizedResult = unauthorized
        .escrow
        .sendAny(
            unauthorized.actors.outsider.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_SEAL_QUERY_ID,
                wallet: unauthorized.actors.wallet.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(unauthorizedResult).toHaveFailedTx({
        exitCode: JETTON_ERROR_UNAUTHORIZED_INITIALIZER,
    });
    expect(unauthorized.escrow.getJettonWalletSealed()).toEqual(0);

    val stale = setupJettonEscrow(1903, false);
    val staleResult = stale
        .escrow
        .sendAny(
            stale.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: 0,
                wallet: stale.actors.wallet.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(staleResult).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });

    val overlapsFunding = setupJettonEscrow(1906, false);
    val overlapsFundingResult = overlapsFunding
        .escrow
        .sendAny(
            overlapsFunding.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_QUERY_ID,
                wallet: overlapsFunding.actors.wallet.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(overlapsFundingResult).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    expect(overlapsFunding.escrow.getJettonWalletSealed()).toEqual(0);
    expect(overlapsFunding.escrow.getJettonLastQueryId()).toEqual(0);

    val aboveFunding = setupJettonEscrow(1907, false);
    val aboveFundingResult = aboveFunding
        .escrow
        .sendAny(
            aboveFunding.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_QUERY_ID + 1,
                wallet: aboveFunding.actors.wallet.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(aboveFundingResult).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });

    val wrongCode = setupJettonEscrow(1904, false);
    val wrongCodeResult = wrongCode
        .escrow
        .sendAny(
            wrongCode.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_SEAL_QUERY_ID,
                wallet: wrongCode.actors.wallet.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH + 1,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(wrongCodeResult).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_WALLET_SEAL });

    val noEvidence = setupJettonEscrow(1905, false);
    val noEvidenceResult = noEvidence
        .escrow
        .sendAny(
            noEvidence.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_SEAL_QUERY_ID,
                wallet: noEvidence.actors.wallet.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: 0,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(noEvidenceResult).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_WALLET_SEAL });
}

get fun `test Jetton wallet seal rejects every privileged identity as candidate`() {
    val buyerAlias = setupJettonEscrow(1910, false);
    val buyerResult = buyerAlias
        .escrow
        .sendAny(
            buyerAlias.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_SEAL_QUERY_ID,
                wallet: buyerAlias.actors.buyer.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(buyerResult).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_WALLET_SEAL });

    val sellerAlias = setupJettonEscrow(1911, false);
    val sellerResult = sellerAlias
        .escrow
        .sendAny(
            sellerAlias.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_SEAL_QUERY_ID,
                wallet: sellerAlias.actors.seller.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(sellerResult).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_WALLET_SEAL });

    val arbitratorAlias = setupJettonEscrow(1912, false);
    val arbitratorResult = arbitratorAlias
        .escrow
        .sendAny(
            arbitratorAlias.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_SEAL_QUERY_ID,
                wallet: arbitratorAlias.actors.arbitrator.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(arbitratorResult).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_WALLET_SEAL });

    val treasuryAlias = setupJettonEscrow(1913, false);
    val treasuryResult = treasuryAlias
        .escrow
        .sendAny(
            treasuryAlias.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_SEAL_QUERY_ID,
                wallet: treasuryAlias.actors.treasury.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(treasuryResult).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_WALLET_SEAL });

    val initializerAlias = setupJettonEscrow(1914, false);
    val initializerResult = initializerAlias
        .escrow
        .sendAny(
            initializerAlias.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_SEAL_QUERY_ID,
                wallet: initializerAlias.actors.initializer.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(initializerResult).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_WALLET_SEAL });

    val reconciliationAlias = setupJettonEscrow(1915, false);
    val reconciliationResult = reconciliationAlias
        .escrow
        .sendAny(
            reconciliationAlias.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_SEAL_QUERY_ID,
                wallet: reconciliationAlias.actors.reconciliation.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(reconciliationResult).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_WALLET_SEAL });

    val masterAlias = setupJettonEscrow(1916, false);
    val masterResult = masterAlias
        .escrow
        .sendAny(
            masterAlias.actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_SEAL_QUERY_ID,
                wallet: masterAlias.actors.master.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(masterResult).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_WALLET_SEAL });
}

get fun `test Jetton escrow accepts exact canonical inline funding once`() {
    val ctx = setupJettonEscrow(2001);
    val configHashBefore = ctx.escrow.getJettonConfigHash();
    val body = notificationBody(
        JETTON_QUERY_ID,
        JETTON_BUYER_TOTAL,
        ctx.actors.buyer.address,
        ctx.payload,
    );

    val result = ctx
        .escrow
        .sendAny(ctx.actors.wallet.address, body, { value: ton("0.08"), bounce: false });
    expect(result).toHaveSuccessfulTx<JettonTransferNotification>({
        from: ctx.actors.wallet.address,
        to: ctx.escrow.address,
    });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_FUNDED);
    expect(ctx.escrow.getJettonFundedAmount()).toEqual(JETTON_BUYER_TOTAL);
    expect(ctx.escrow.getJettonLastQueryId()).toEqual(JETTON_QUERY_ID);
    expect(ctx.escrow.getJettonConfigHash()).toEqual(configHashBefore);

    val replay = ctx
        .escrow
        .sendAny(ctx.actors.wallet.address, body, { value: ton("0.08"), bounce: false });
    expect(replay).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });
    expect(ctx.escrow.getJettonFundedAmount()).toEqual(JETTON_BUYER_TOTAL);
}

get fun `test Jetton escrow accepts exact canonical referenced payload funding`() {
    val ctx = setupJettonEscrow(2002);
    val body = notificationBody(
        JETTON_QUERY_ID,
        JETTON_BUYER_TOTAL,
        ctx.actors.buyer.address,
        ctx.payload,
        true,
    );
    val result = ctx
        .escrow
        .sendAny(ctx.actors.wallet.address, body, { value: ton("0.08"), bounce: false });
    expect(result).toHaveSuccessfulTx<JettonTransferNotification>({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_FUNDED);
}

get fun `test Jetton escrow rejects a master-adjacent fake wallet`() {
    val ctx = setupJettonEscrow(2101);
    val body = notificationBody(
        JETTON_QUERY_ID,
        JETTON_BUYER_TOTAL,
        ctx.actors.buyer.address,
        ctx.payload,
    );
    expectJettonFundingFailure(
        ctx,
        ctx.actors.fakeWallet.address,
        body,
        JETTON_ERROR_UNAUTHORIZED_WALLET,
    );
}

get fun `test Jetton escrow rejects wrong buyer query amount and payload independently`() {
    val wrongBuyer = setupJettonEscrow(2201);
    expectJettonFundingFailure(
        wrongBuyer,
        wrongBuyer.actors.wallet.address,
        notificationBody(
            JETTON_QUERY_ID,
            JETTON_BUYER_TOTAL,
            wrongBuyer.actors.outsider.address,
            wrongBuyer.payload,
        ),
        JETTON_ERROR_WRONG_BUYER,
    );

    val wrongQuery = setupJettonEscrow(2202);
    expectJettonFundingFailure(
        wrongQuery,
        wrongQuery.actors.wallet.address,
        notificationBody(
            JETTON_QUERY_ID + 1,
            JETTON_BUYER_TOTAL,
            wrongQuery.actors.buyer.address,
            wrongQuery.payload,
        ),
        JETTON_ERROR_WRONG_QUERY_ID,
    );

    val wrongAmount = setupJettonEscrow(2203);
    expectJettonFundingFailure(
        wrongAmount,
        wrongAmount.actors.wallet.address,
        notificationBody(
            JETTON_QUERY_ID,
            JETTON_BUYER_TOTAL - 1,
            wrongAmount.actors.buyer.address,
            wrongAmount.payload,
        ),
        JETTON_ERROR_WRONG_AMOUNT,
    );

    val wrongPayload = setupJettonEscrow(2204);
    expectJettonFundingFailure(
        wrongPayload,
        wrongPayload.actors.wallet.address,
        notificationBody(
            JETTON_QUERY_ID,
            JETTON_BUYER_TOTAL,
            wrongPayload.actors.buyer.address,
            jettonPayload(999999),
        ),
        JETTON_ERROR_WRONG_FORWARD_PAYLOAD,
    );
}

get fun `test Jetton escrow rejects malformed notification payloads and unknown opcode`() {
    val missingEither = setupJettonEscrow(2301);
    val missingEitherBody = beginCell()
        .storeUint(JETTON_TRANSFER_NOTIFICATION_OPCODE, 32)
        .storeUint(JETTON_QUERY_ID, 64)
        .storeCoins(JETTON_BUYER_TOTAL)
        .storeAddress(missingEither.actors.buyer.address)
        .endCell();
    expectJettonFundingFailure(
        missingEither,
        missingEither.actors.wallet.address,
        missingEitherBody,
        JETTON_ERROR_MALFORMED_FORWARD_PAYLOAD,
    );

    val missingReference = setupJettonEscrow(2302);
    val missingReferenceBody = beginCell()
        .storeUint(JETTON_TRANSFER_NOTIFICATION_OPCODE, 32)
        .storeUint(JETTON_QUERY_ID, 64)
        .storeCoins(JETTON_BUYER_TOTAL)
        .storeAddress(missingReference.actors.buyer.address)
        .storeUint(1, 1)
        .endCell();
    expectJettonFundingFailure(
        missingReference,
        missingReference.actors.wallet.address,
        missingReferenceBody,
        JETTON_ERROR_MALFORMED_FORWARD_PAYLOAD,
    );

    val nonCanonicalReference = setupJettonEscrow(2304);
    val nonCanonicalReferenceBody = beginCell()
        .storeUint(JETTON_TRANSFER_NOTIFICATION_OPCODE, 32)
        .storeUint(JETTON_QUERY_ID, 64)
        .storeCoins(JETTON_BUYER_TOTAL)
        .storeAddress(nonCanonicalReference.actors.buyer.address)
        .storeUint(1, 1)
        .storeUint(0, 1)
        .storeRef(nonCanonicalReference.payload)
        .endCell();
    expectJettonFundingFailure(
        nonCanonicalReference,
        nonCanonicalReference.actors.wallet.address,
        nonCanonicalReferenceBody,
        JETTON_ERROR_MALFORMED_FORWARD_PAYLOAD,
    );

    val unknown = setupJettonEscrow(2303);
    val unknownBody = beginCell().storeUint(0x11223344, 32).storeUint(0, 64).endCell();
    expectJettonFundingFailure(
        unknown,
        unknown.actors.wallet.address,
        unknownBody,
        JETTON_ERROR_UNKNOWN_MESSAGE,
    );
}

get fun `test Jetton escrow rejects bounced transfer notifications`() {
    val ctx = setupJettonEscrow(2401);
    val body = notificationBody(
        JETTON_QUERY_ID,
        JETTON_BUYER_TOTAL,
        ctx.actors.buyer.address,
        ctx.payload,
    );
    val bouncedMessage = createMessage({
        bounce: false,
        value: ton("0.08"),
        dest: ctx.escrow.address,
        body,
    }).bounced();
    val result = net.send(ctx.actors.wallet.address, bouncedMessage);
    expect(result).toHaveFailedTx({
        to: ctx.escrow.address,
        exitCode: JETTON_ERROR_BOUNCED_MESSAGE,
    });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_AWAITING_FUNDING);
}

get fun `test Jetton escrow enforces funding deadline and immutable conservation`() {
    val atDeadline = setupJettonEscrow(2500);
    testing.setNow(JETTON_TEST_NOW + 100);
    val exactBoundary = atDeadline
        .escrow
        .sendAny(
            atDeadline.actors.wallet.address,
            notificationBody(
                JETTON_QUERY_ID,
                JETTON_BUYER_TOTAL,
                atDeadline.actors.buyer.address,
                atDeadline.payload,
            ),
            { value: ton("0.08"), bounce: false },
        );
    expect(exactBoundary).toHaveSuccessfulTx<JettonTransferNotification>({
        to: atDeadline.escrow.address,
    });

    val late = setupJettonEscrow(2501);
    testing.setNow(JETTON_TEST_NOW + 101);
    expectJettonFundingFailure(
        late,
        late.actors.wallet.address,
        notificationBody(
            JETTON_QUERY_ID,
            JETTON_BUYER_TOTAL,
            late.actors.buyer.address,
            late.payload,
        ),
        JETTON_ERROR_DEADLINE_PASSED,
    );

    testing.setNow(JETTON_TEST_NOW);
    val actors = jettonActors();
    val payload = jettonPayload(2502);
    var invalid = jettonConfig(actors, 2502, payload);
    var commitment = invalid.loadCommitment();
    commitment.economics = JettonEconomics {
        buyerTotal: JETTON_BUYER_TOTAL,
        sellerPayout: JETTON_SELLER_PAYOUT - 1,
        platformFee: JETTON_PLATFORM_FEE,
        refundToBuyer: JETTON_REFUND_TO_BUYER,
        refundFee: JETTON_REFUND_FEE,
    }.toCell();
    invalid.commitment = commitment.toCell();
    val invalidEscrow = jettonEscrow(invalid);
    val invalidDeploy = invalidEscrow.deploy(
        actors.outsider.address,
        { value: ton("0.3"), bounce: false },
    );
    expect(invalidDeploy).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_CONFIG });

    invalid = jettonConfig(actors, 2503, jettonPayload(2503));
    var aliasedCommitment = invalid.loadCommitment();
    aliasedCommitment.asset = JettonAsset {
        master: actors.buyer.address,
        walletCodeHash: JETTON_WALLET_CODE_HASH,
    }.toCell();
    invalid.commitment = aliasedCommitment.toCell();
    val aliasedEscrow = jettonEscrow(invalid);
    val aliasedDeploy = aliasedEscrow.deploy(
        actors.outsider.address,
        { value: ton("0.3"), bounce: false },
    );
    expect(aliasedDeploy).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_CONFIG });
}

get fun `test Jetton escrow enforces every immutable configuration boundary`() {
    testing.setNow(JETTON_TEST_NOW);
    val actors = jettonActors();

    var invalid = jettonConfig(actors, 2701, jettonPayload(2701));
    invalid.dealId = 0;
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2702, jettonPayload(2702));
    invalid.termsHash = 0;
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2703, jettonPayload(2703));
    invalid.quoteHash = 0;
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2704, jettonPayload(2704));
    invalid.fundingDeadline = 0;
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2705, jettonPayload(2705));
    var commitment = invalid.loadCommitment();
    commitment.forwardPayloadHash = 0;
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2706, jettonPayload(2706));
    commitment = invalid.loadCommitment();
    commitment.economics = JettonEconomics {
        buyerTotal: 0,
        sellerPayout: 0,
        platformFee: 0,
        refundToBuyer: 0,
        refundFee: 0,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2707, jettonPayload(2707));
    commitment = invalid.loadCommitment();
    commitment.economics = JettonEconomics {
        buyerTotal: JETTON_BUYER_TOTAL,
        sellerPayout: JETTON_SELLER_PAYOUT,
        platformFee: JETTON_PLATFORM_FEE,
        refundToBuyer: JETTON_REFUND_TO_BUYER - 1,
        refundFee: JETTON_REFUND_FEE,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2708, jettonPayload(2708));
    commitment = invalid.loadCommitment();
    var roles = commitment.loadRoles();
    roles.seller = actors.buyer.address;
    commitment.roles = roles.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2709, jettonPayload(2709));
    commitment = invalid.loadCommitment();
    roles = commitment.loadRoles();
    roles.tail = JettonRolesTail {
        arbitrator: actors.buyer.address,
        treasury: actors.treasury.address,
    }.toCell();
    commitment.roles = roles.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2710, jettonPayload(2710));
    commitment = invalid.loadCommitment();
    roles = commitment.loadRoles();
    roles.tail = JettonRolesTail {
        arbitrator: actors.seller.address,
        treasury: actors.treasury.address,
    }.toCell();
    commitment.roles = roles.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2711, jettonPayload(2711));
    commitment = invalid.loadCommitment();
    roles = commitment.loadRoles();
    roles.tail = JettonRolesTail {
        arbitrator: actors.arbitrator.address,
        treasury: actors.buyer.address,
    }.toCell();
    commitment.roles = roles.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2712, jettonPayload(2712));
    commitment = invalid.loadCommitment();
    roles = commitment.loadRoles();
    roles.tail = JettonRolesTail {
        arbitrator: actors.arbitrator.address,
        treasury: actors.seller.address,
    }.toCell();
    commitment.roles = roles.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2713, jettonPayload(2713));
    commitment = invalid.loadCommitment();
    commitment.asset = JettonAsset {
        master: actors.buyer.address,
        walletCodeHash: JETTON_WALLET_CODE_HASH,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2714, jettonPayload(2714));
    commitment = invalid.loadCommitment();
    commitment.asset = JettonAsset {
        master: actors.master.address,
        walletCodeHash: 0,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2715, jettonPayload(2715));
    commitment = invalid.loadCommitment();
    commitment.expectedQueryId = 0;
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2715, jettonPayload(2715));
    commitment = invalid.loadCommitment();
    commitment.expectedQueryId = 1;
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2716, jettonPayload(2716));
    commitment = invalid.loadCommitment();
    commitment.authorities = JettonAuthorities {
        initializer: actors.buyer.address,
        reconciliation: actors.reconciliation.address,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2717, jettonPayload(2717));
    commitment = invalid.loadCommitment();
    commitment.authorities = JettonAuthorities {
        initializer: actors.initializer.address,
        reconciliation: actors.buyer.address,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2718, jettonPayload(2718));
    commitment = invalid.loadCommitment();
    commitment.authorities = JettonAuthorities {
        initializer: actors.seller.address,
        reconciliation: actors.reconciliation.address,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2719, jettonPayload(2719));
    commitment = invalid.loadCommitment();
    commitment.authorities = JettonAuthorities {
        initializer: actors.initializer.address,
        reconciliation: actors.seller.address,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2720, jettonPayload(2720));
    commitment = invalid.loadCommitment();
    commitment.asset = JettonAsset {
        master: actors.seller.address,
        walletCodeHash: JETTON_WALLET_CODE_HASH,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2721, jettonPayload(2721));
    commitment = invalid.loadCommitment();
    roles = commitment.loadRoles();
    roles.tail = JettonRolesTail {
        arbitrator: actors.arbitrator.address,
        treasury: actors.arbitrator.address,
    }.toCell();
    commitment.roles = roles.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2722, jettonPayload(2722));
    commitment = invalid.loadCommitment();
    commitment.authorities = JettonAuthorities {
        initializer: actors.arbitrator.address,
        reconciliation: actors.reconciliation.address,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2723, jettonPayload(2723));
    commitment = invalid.loadCommitment();
    commitment.authorities = JettonAuthorities {
        initializer: actors.initializer.address,
        reconciliation: actors.arbitrator.address,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2724, jettonPayload(2724));
    commitment = invalid.loadCommitment();
    commitment.asset = JettonAsset {
        master: actors.arbitrator.address,
        walletCodeHash: JETTON_WALLET_CODE_HASH,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2725, jettonPayload(2725));
    commitment = invalid.loadCommitment();
    commitment.authorities = JettonAuthorities {
        initializer: actors.treasury.address,
        reconciliation: actors.reconciliation.address,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2726, jettonPayload(2726));
    commitment = invalid.loadCommitment();
    commitment.authorities = JettonAuthorities {
        initializer: actors.initializer.address,
        reconciliation: actors.treasury.address,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2727, jettonPayload(2727));
    commitment = invalid.loadCommitment();
    commitment.asset = JettonAsset {
        master: actors.treasury.address,
        walletCodeHash: JETTON_WALLET_CODE_HASH,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2728, jettonPayload(2728));
    commitment = invalid.loadCommitment();
    commitment.authorities = JettonAuthorities {
        initializer: actors.initializer.address,
        reconciliation: actors.initializer.address,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2729, jettonPayload(2729));
    commitment = invalid.loadCommitment();
    commitment.asset = JettonAsset {
        master: actors.initializer.address,
        walletCodeHash: JETTON_WALLET_CODE_HASH,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2730, jettonPayload(2730));
    commitment = invalid.loadCommitment();
    commitment.asset = JettonAsset {
        master: actors.reconciliation.address,
        walletCodeHash: JETTON_WALLET_CODE_HASH,
    }.toCell();
    invalid.commitment = commitment.toCell();
    expectInvalidJettonConfig(actors, invalid);
}

get fun `test Jetton escrow rejects impossible persisted funding states`() {
    testing.setNow(JETTON_TEST_NOW);
    val actors = jettonActors();
    val config = jettonConfig(actors, 2601, jettonPayload(2601));

    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: 2,
            walletSealed: 0,
            fundedAmount: JETTON_BUYER_TOTAL,
            lastQueryId: JETTON_QUERY_ID,
            config: config.toCell(),
            sealedWallet: beginCell().endCell(),
        },
    );
    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: JETTON_STATUS_AWAITING_FUNDING,
            walletSealed: 0,
            fundedAmount: 1,
            lastQueryId: 0,
            config: config.toCell(),
            sealedWallet: beginCell().endCell(),
        },
    );
    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: JETTON_STATUS_FUNDED,
            walletSealed: 0,
            fundedAmount: JETTON_BUYER_TOTAL - 1,
            lastQueryId: JETTON_QUERY_ID,
            config: config.toCell(),
            sealedWallet: beginCell().endCell(),
        },
    );
    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: JETTON_STATUS_FUNDED,
            walletSealed: 1,
            fundedAmount: JETTON_BUYER_TOTAL - 1,
            lastQueryId: JETTON_QUERY_ID,
            config: config.toCell(),
            sealedWallet: JettonSealedWallet {
                wallet: actors.wallet.address,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
        },
    );

    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: 2,
            walletSealed: 1,
            fundedAmount: JETTON_BUYER_TOTAL,
            lastQueryId: JETTON_QUERY_ID,
            config: config.toCell(),
            sealedWallet: JettonSealedWallet {
                wallet: actors.wallet.address,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
        },
    );
    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: JETTON_STATUS_AWAITING_FUNDING,
            walletSealed: 2,
            fundedAmount: 0,
            lastQueryId: JETTON_SEAL_QUERY_ID,
            config: config.toCell(),
            sealedWallet: JettonSealedWallet {
                wallet: actors.wallet.address,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
        },
    );
    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: JETTON_STATUS_FUNDED,
            walletSealed: 0,
            fundedAmount: JETTON_BUYER_TOTAL,
            lastQueryId: JETTON_QUERY_ID,
            config: config.toCell(),
            sealedWallet: beginCell().endCell(),
        },
    );
    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: JETTON_STATUS_AWAITING_FUNDING,
            walletSealed: 0,
            fundedAmount: 0,
            lastQueryId: 0,
            config: config.toCell(),
            sealedWallet: JettonSealedWallet {
                wallet: actors.wallet.address,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
        },
    );
    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: JETTON_STATUS_AWAITING_FUNDING,
            walletSealed: 1,
            fundedAmount: 0,
            lastQueryId: JETTON_SEAL_QUERY_ID,
            config: config.toCell(),
            sealedWallet: JettonSealedWallet {
                wallet: actors.wallet.address,
                verificationEvidenceHash: 0,
            }.toCell(),
        },
    );

    val validFunded = TonJettonEscrow.fromStorage(JettonEscrowStorage {
        status: JETTON_STATUS_FUNDED,
        walletSealed: 1,
        fundedAmount: JETTON_BUYER_TOTAL,
        lastQueryId: JETTON_QUERY_ID,
        config: config.toCell(),
        sealedWallet: JettonSealedWallet {
            wallet: actors.wallet.address,
            verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
        }.toCell(),
    });
    val validDeploy = validFunded.deploy(
        actors.outsider.address,
        { value: ton("0.3"), bounce: false },
    );
    expect(validDeploy).toHaveSuccessfulDeploy({ to: validFunded.address });

    val resealFunded = validFunded.sendAny(
        actors.initializer.address,
        SealCanonicalJettonWallet {
            queryId: JETTON_QUERY_ID + 1,
            wallet: actors.fakeWallet.address,
            walletCodeHash: JETTON_WALLET_CODE_HASH,
            verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
        }.toCell(),
        { value: ton("0.08"), bounce: false },
    );
    expect(resealFunded).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });

    val staleFunding = TonJettonEscrow.fromStorage(JettonEscrowStorage {
        status: JETTON_STATUS_AWAITING_FUNDING,
        walletSealed: 1,
        fundedAmount: 0,
        lastQueryId: JETTON_QUERY_ID,
        config: config.toCell(),
        sealedWallet: JettonSealedWallet {
            wallet: actors.wallet.address,
            verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
        }.toCell(),
    });
    val staleDeploy = staleFunding.deploy(
        actors.outsider.address,
        { value: ton("0.3"), bounce: false },
    );
    expect(staleDeploy).toHaveSuccessfulDeploy({ to: staleFunding.address });
    val staleFundingResult = staleFunding.sendAny(
        actors.wallet.address,
        notificationBody(
            JETTON_QUERY_ID,
            JETTON_BUYER_TOTAL,
            actors.buyer.address,
            jettonPayload(2601),
        ),
        { value: ton("0.08"), bounce: false },
    );
    expect(staleFundingResult).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
}
