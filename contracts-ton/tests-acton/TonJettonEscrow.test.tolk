import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/types/out_actions"

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
        deliveryDeadline: JETTON_TEST_NOW + 200,
        confirmationDeadline: JETTON_TEST_NOW + 300,
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
        settlement: beginCell().endCell(),
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

fun fundJettonEscrow(ctx: JettonTestContext) {
    val funded = ctx
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
    expect(funded).toHaveSuccessfulTx<JettonTransferNotification>({
        from: ctx.actors.wallet.address,
        to: ctx.escrow.address,
    });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_FUNDED);
}

fun beginJettonRelease(ctx: JettonTestContext, settlementId: uint256) {
    ctx
        .escrow
        .sendAny(
            ctx.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    val released = ctx
        .escrow
        .sendAny(
            ctx.actors.buyer.address,
            JettonRelease {
                queryId: JETTON_QUERY_ID + 2,
                settlementId,
                buyerQueryId: 0,
                sellerQueryId: JETTON_QUERY_ID + 3,
                treasuryQueryId: JETTON_QUERY_ID + 4,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(released).toHaveSuccessfulTx<JettonRelease>({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_SETTLEMENT_PENDING);
}

fun releasePayoutBody(
    ctx: JettonTestContext,
    settlementId: uint256,
    leg: uint8,
    queryId: uint64,
    destination: address,
    amount: coins,
): cell {
    var base = validSettlementBase(ctx.actors);
    base.settlementId = settlementId;
    val commitment = JettonPayoutCommitment {
        settlementId,
        planHash: base.toCell().hash(),
        attempt: 0,
        leg,
    }.toCell();
    return JettonTransfer {
        queryId,
        amount,
        destination,
        responseDestination: ctx.escrow.address,
        customPayload: commitment,
        forwardTonAmount: 0,
        forwardPayload: beginCell().storeUint(0, 1).endCell().beginParse(),
    }.toCell();
}

fun expectJettonPayoutAction(
    actions: OutActionList,
    index: int,
    queryId: uint64,
    destination: address,
    amount: coins,
    responseDestination: address,
    settlementId: uint256,
    planHash: uint256,
    attempt: uint32,
    leg: uint8,
) {
    expect(actions).toBeSendMessageAt<JettonTransfer>(index);
    val payoutOrNull = actions.getSendMessageBodyAt<JettonTransfer>(index);
    expect(payoutOrNull).toBeNotNull();
    val payout = payoutOrNull!;
    expect(payout.queryId).toEqual(queryId);
    expect(payout.destination).toEqual(destination);
    expect(payout.amount).toEqual(amount);
    expect(payout.responseDestination).toEqual(responseDestination);
    expect(payout.forwardTonAmount).toEqual(0);
    expect(payout.customPayload).toBeNotNull();
    expect(payout.customPayload!.hash()).toEqual(
        JettonPayoutCommitment { settlementId, planHash, attempt, leg }.toCell().hash(),
    );
    var forwardPayload = payout.forwardPayload;
    expect(forwardPayload.remainingBitsCount()).toEqual(1);
    expect(forwardPayload.remainingRefsCount()).toEqual(0);
    expect(forwardPayload.loadUint(1)).toEqual(0);
    forwardPayload.assertEnd();
}

fun richBouncedPayout(dest: address, originalBody: cell): OutMessage {
    val originalInfo = beginCell()
        .storeCoins(JETTON_PAYOUT_MESSAGE_VALUE)
        .storeUint(0, 1)
        .storeUint(0, 64)
        .storeUint(0, 32)
        .endCell();
    val richBody = beginCell()
        .storeUint(0xfffffffe, 32)
        .storeRef(originalBody)
        .storeRef(originalInfo)
        .storeUint(0, 8)
        .storeInt(1, 32)
        .storeUint(0, 1)
        .endCell();
    return createMessage({
        bounce: false,
        value: ton("0.04"),
        dest,
        body: richBody,
    }).bounced();
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
            settlement: beginCell().endCell(),
        },
    );
}

fun settlementDestinations(actors: JettonTestActors): cell {
    return JettonSettlementDestinations {
        buyer: actors.buyer.address,
        seller: actors.seller.address,
        treasury: actors.treasury.address,
    }.toCell();
}

fun releaseAmounts(): cell {
    return JettonSettlementAmounts {
        buyer: 0,
        seller: JETTON_SELLER_PAYOUT,
        treasury: JETTON_PLATFORM_FEE,
        total: JETTON_BUYER_TOTAL,
    }.toCell();
}

fun settlementQueries(): cell {
    return JettonSettlementQueries {
        buyer: 0,
        seller: JETTON_QUERY_ID + 3,
        treasury: JETTON_QUERY_ID + 4,
    }.toCell();
}

fun validSettlementBase(actors: JettonTestActors): JettonSettlementBase {
    val amounts = releaseAmounts();
    return JettonSettlementBase {
        settlementId: 0x5151,
        outcome: JETTON_OUTCOME_RELEASE,
        activeMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
        conservationCommitment: amounts.hash(),
        destinations: settlementDestinations(actors),
        amounts,
    };
}

fun validPendingAttempt(): JettonSettlementAttempt {
    return JettonSettlementAttempt {
        attempt: 0,
        activeMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
        confirmedMask: 0,
        failedMask: 0,
        bouncedMask: 0,
        reconciliationEvidenceHash: 0,
        queries: settlementQueries(),
    };
}

fun expectInvalidSettlementStorage(
    actors: JettonTestActors,
    config: JettonEscrowConfig,
    status: uint8,
    base: JettonSettlementBase,
    attempt: JettonSettlementAttempt,
) {
    val escrow = TonJettonEscrow.fromStorage(JettonEscrowStorage {
        status,
        walletSealed: 1,
        fundedAmount: JETTON_BUYER_TOTAL,
        lastQueryId: JETTON_QUERY_ID + 4,
        config: config.toCell(),
        sealedWallet: JettonSealedWallet {
            wallet: actors.wallet.address,
            verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
        }.toCell(),
        settlement: JettonSettlement {
            base: base.toCell(),
            attempt: attempt.toCell(),
        }.toCell(),
    });
    val deploy = escrow.deploy(actors.outsider.address, { value: ton("0.3"), bounce: false });
    expect(deploy).toHaveFailedTx({ to: escrow.address, exitCode: JETTON_ERROR_INVALID_CONFIG });
}

fun persistedSettlementEscrow(
    actors: JettonTestActors,
    config: JettonEscrowConfig,
    status: uint8,
    lastQueryId: uint64,
    base: JettonSettlementBase,
    attempt: JettonSettlementAttempt,
): TonJettonEscrow {
    return TonJettonEscrow.fromStorage(JettonEscrowStorage {
        status,
        walletSealed: 1,
        fundedAmount: JETTON_BUYER_TOTAL,
        lastQueryId,
        config: config.toCell(),
        sealedWallet: JettonSealedWallet {
            wallet: actors.wallet.address,
            verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
        }.toCell(),
        settlement: JettonSettlement {
            base: base.toCell(),
            attempt: attempt.toCell(),
        }.toCell(),
    });
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

get fun `test Jetton lifecycle requires complete reconciliation and retries only failed legs`() {
    val ctx = setupJettonEscrow(2050);
    fundJettonEscrow(ctx);

    val delivered = ctx
        .escrow
        .sendAny(
            ctx.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(delivered).toHaveSuccessfulTx<JettonMarkDelivered>({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_DELIVERED);

    val released = ctx
        .escrow
        .sendAny(
            ctx.actors.buyer.address,
            JettonRelease {
                queryId: JETTON_QUERY_ID + 2,
                settlementId: 0x2050,
                buyerQueryId: 0,
                sellerQueryId: JETTON_QUERY_ID + 3,
                treasuryQueryId: JETTON_QUERY_ID + 4,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(released).toHaveSuccessfulTx<JettonRelease>({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_SETTLEMENT_PENDING);
    expect(ctx.escrow.getJettonLastQueryId()).toEqual(JETTON_QUERY_ID + 4);

    val prematureFinalization = ctx
        .escrow
        .sendAny(
            ctx.actors.reconciliation.address,
            JettonFinalizeSettlement {
                queryId: JETTON_QUERY_ID + 5,
                settlementId: 0x2050,
                attempt: 0,
                evidenceHash: 0xabc001,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(prematureFinalization).toHaveFailedTx({
        exitCode: JETTON_ERROR_INCOMPLETE_RECONCILIATION,
    });

    val mixed = ctx
        .escrow
        .sendAny(
            ctx.actors.reconciliation.address,
            JettonReconcileAttempt {
                queryId: JETTON_QUERY_ID + 5,
                settlementId: 0x2050,
                attempt: 0,
                activeMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
                confirmedMask: JETTON_LEG_SELLER,
                failedMask: JETTON_LEG_TREASURY,
                evidenceHash: 0xabc001,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(mixed).toHaveSuccessfulTx<JettonReconcileAttempt>({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_RECOVERY_REQUIRED);

    val stale = ctx
        .escrow
        .sendAny(
            ctx.actors.reconciliation.address,
            JettonReconcileAttempt {
                queryId: JETTON_QUERY_ID + 6,
                settlementId: 0x2050,
                attempt: 0,
                activeMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
                confirmedMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
                failedMask: 0,
                evidenceHash: 0xabc002,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(stale).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });

    val retry = ctx
        .escrow
        .sendAny(
            ctx.actors.reconciliation.address,
            JettonRetryFailedLegs {
                queryId: JETTON_QUERY_ID + 6,
                settlementId: 0x2050,
                previousAttempt: 0,
                buyerQueryId: 0,
                sellerQueryId: 0,
                treasuryQueryId: JETTON_QUERY_ID + 7,
            }.toCell(),
            { value: ton("0.15"), bounce: false },
        );
    expect(retry).toHaveSuccessfulTx<JettonRetryFailedLegs>({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_SETTLEMENT_PENDING);

    val confirmed = ctx
        .escrow
        .sendAny(
            ctx.actors.reconciliation.address,
            JettonReconcileAttempt {
                queryId: JETTON_QUERY_ID + 8,
                settlementId: 0x2050,
                attempt: 1,
                activeMask: JETTON_LEG_TREASURY,
                confirmedMask: JETTON_LEG_TREASURY,
                failedMask: 0,
                evidenceHash: 0xabc003,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(confirmed).toHaveSuccessfulTx<JettonReconcileAttempt>({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_SETTLEMENT_PENDING);

    val finalized = ctx
        .escrow
        .sendAny(
            ctx.actors.reconciliation.address,
            JettonFinalizeSettlement {
                queryId: JETTON_QUERY_ID + 9,
                settlementId: 0x2050,
                attempt: 1,
                evidenceHash: 0xabc003,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(finalized).toHaveSuccessfulTx<JettonFinalizeSettlement>({
        to: ctx.escrow.address,
    });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_SETTLED_FINALIZED);
}

get fun `test Jetton lifecycle rejects unauthorized and incomplete reconciliation`() {
    val ctx = setupJettonEscrow(2051);
    fundJettonEscrow(ctx);
    ctx
        .escrow
        .sendAny(
            ctx.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    ctx
        .escrow
        .sendAny(
            ctx.actors.buyer.address,
            JettonRelease {
                queryId: JETTON_QUERY_ID + 2,
                settlementId: 0x2051,
                buyerQueryId: 0,
                sellerQueryId: JETTON_QUERY_ID + 3,
                treasuryQueryId: JETTON_QUERY_ID + 4,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );

    val unauthorized = ctx
        .escrow
        .sendAny(
            ctx.actors.outsider.address,
            JettonReconcileAttempt {
                queryId: JETTON_QUERY_ID + 5,
                settlementId: 0x2051,
                attempt: 0,
                activeMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
                confirmedMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
                failedMask: 0,
                evidenceHash: 0xabc101,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(unauthorized).toHaveFailedTx({ exitCode: JETTON_ERROR_UNAUTHORIZED });

    val incomplete = ctx
        .escrow
        .sendAny(
            ctx.actors.reconciliation.address,
            JettonReconcileAttempt {
                queryId: JETTON_QUERY_ID + 5,
                settlementId: 0x2051,
                attempt: 0,
                activeMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
                confirmedMask: JETTON_LEG_SELLER,
                failedMask: 0,
                evidenceHash: 0xabc101,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(incomplete).toHaveFailedTx({
        exitCode: JETTON_ERROR_INCOMPLETE_RECONCILIATION,
    });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_SETTLEMENT_PENDING);
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

    invalid = jettonConfig(actors, 2704, jettonPayload(2704));
    invalid.fundingDeadline = invalid.deliveryDeadline;
    expectInvalidJettonConfig(actors, invalid);

    invalid = jettonConfig(actors, 2704, jettonPayload(2704));
    invalid.deliveryDeadline = invalid.confirmationDeadline;
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
            status: JETTON_STATUS_SETTLED_FINALIZED + 1,
            walletSealed: 0,
            fundedAmount: JETTON_BUYER_TOTAL,
            lastQueryId: JETTON_QUERY_ID,
            config: config.toCell(),
            sealedWallet: beginCell().endCell(),
            settlement: beginCell().endCell(),
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
            settlement: beginCell().endCell(),
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
            settlement: beginCell().endCell(),
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
            settlement: beginCell().endCell(),
        },
    );

    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: JETTON_STATUS_SETTLED_FINALIZED + 1,
            walletSealed: 1,
            fundedAmount: JETTON_BUYER_TOTAL,
            lastQueryId: JETTON_QUERY_ID,
            config: config.toCell(),
            sealedWallet: JettonSealedWallet {
                wallet: actors.wallet.address,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            settlement: beginCell().endCell(),
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
            settlement: beginCell().endCell(),
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
            settlement: beginCell().endCell(),
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
            settlement: beginCell().endCell(),
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
            settlement: beginCell().endCell(),
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
        settlement: beginCell().endCell(),
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
        settlement: beginCell().endCell(),
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

get fun `test Jetton escrow rejects every corrupted persisted settlement invariant`() {
    testing.setNow(JETTON_TEST_NOW);
    val actors = jettonActors();
    val config = jettonConfig(actors, 5151, jettonPayload(5151));

    var base = validSettlementBase(actors);
    var attempt = validPendingAttempt();
    expectInvalidJettonStorage(
        actors,
        JettonEscrowStorage {
            status: JETTON_STATUS_FUNDED,
            walletSealed: 1,
            fundedAmount: JETTON_BUYER_TOTAL,
            lastQueryId: JETTON_QUERY_ID,
            config: config.toCell(),
            sealedWallet: JettonSealedWallet {
                wallet: actors.wallet.address,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            settlement: JettonSettlement {
                base: base.toCell(),
                attempt: attempt.toCell(),
            }.toCell(),
        },
    );

    base = validSettlementBase(actors);
    base.settlementId = 0;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);

    base = validSettlementBase(actors);
    base.outcome = 0;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);
    base = validSettlementBase(actors);
    base.outcome = JETTON_OUTCOME_RESOLUTION + 1;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);

    base = validSettlementBase(actors);
    base.activeMask = 8;
    attempt = validPendingAttempt();
    attempt.activeMask = 8;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);
    base = validSettlementBase(actors);
    base.activeMask = 0;
    attempt = validPendingAttempt();
    attempt.activeMask = 0;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);

    base = validSettlementBase(actors);
    attempt = validPendingAttempt();
    attempt.activeMask = JETTON_LEG_TREASURY;
    attempt.confirmedMask = JETTON_LEG_SELLER;
    attempt.failedMask = JETTON_LEG_SELLER;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);
    attempt = validPendingAttempt();
    attempt.confirmedMask = JETTON_LEG_BUYER;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);
    attempt = validPendingAttempt();
    attempt.failedMask = JETTON_LEG_BUYER;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);
    attempt = validPendingAttempt();
    attempt.bouncedMask = JETTON_LEG_BUYER;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);

    attempt = validPendingAttempt();
    var destinations = JettonSettlementDestinations.fromCell(base.destinations);
    destinations.buyer = actors.outsider.address;
    base.destinations = destinations.toCell();
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);
    base = validSettlementBase(actors);
    destinations = JettonSettlementDestinations.fromCell(base.destinations);
    destinations.seller = actors.outsider.address;
    base.destinations = destinations.toCell();
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);
    base = validSettlementBase(actors);
    destinations = JettonSettlementDestinations.fromCell(base.destinations);
    destinations.treasury = actors.outsider.address;
    base.destinations = destinations.toCell();
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);

    base = validSettlementBase(actors);
    var amounts = JettonSettlementAmounts.fromCell(base.amounts);
    amounts.seller -= 1;
    amounts.total -= 1;
    base.amounts = amounts.toCell();
    base.conservationCommitment = base.amounts.hash();
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);
    base = validSettlementBase(actors);
    amounts = JettonSettlementAmounts.fromCell(base.amounts);
    amounts.seller -= 1;
    base.amounts = amounts.toCell();
    base.conservationCommitment = base.amounts.hash();
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);
    base = validSettlementBase(actors);
    base.conservationCommitment = 1;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);

    base = validSettlementBase(actors);
    attempt = validPendingAttempt();
    attempt.activeMask = JETTON_LEG_SELLER;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLEMENT_PENDING, base, attempt);

    attempt = validPendingAttempt();
    attempt.activeMask = JETTON_LEG_TREASURY;
    attempt.confirmedMask = JETTON_LEG_SELLER;
    attempt.failedMask = 0;
    attempt.reconciliationEvidenceHash = 1;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_RECOVERY_REQUIRED, base, attempt);
    attempt.failedMask = JETTON_LEG_TREASURY;
    attempt.reconciliationEvidenceHash = 0;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_RECOVERY_REQUIRED, base, attempt);

    attempt = validPendingAttempt();
    attempt.activeMask = JETTON_LEG_TREASURY;
    attempt.confirmedMask = JETTON_LEG_SELLER;
    attempt.reconciliationEvidenceHash = 1;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLED_FINALIZED, base, attempt);
    attempt.activeMask = 0;
    attempt.confirmedMask = JETTON_LEG_SELLER | JETTON_LEG_TREASURY;
    attempt.reconciliationEvidenceHash = 0;
    expectInvalidSettlementStorage(actors, config, JETTON_STATUS_SETTLED_FINALIZED, base, attempt);
}

get fun `test Jetton lifecycle enforces roles states deadlines and every outcome path`() {
    var ctx = setupJettonEscrow(5201);
    val disputeFundedContext = setupJettonEscrow(5202);
    val resolutionContext = setupJettonEscrow(5203);
    val voluntaryRefundContext = setupJettonEscrow(5204);
    val sellerTimeoutContext = setupJettonEscrow(5205);
    val buyerTimeoutContext = setupJettonEscrow(5206);
    fundJettonEscrow(ctx);
    fundJettonEscrow(disputeFundedContext);
    fundJettonEscrow(resolutionContext);
    fundJettonEscrow(voluntaryRefundContext);
    fundJettonEscrow(sellerTimeoutContext);
    fundJettonEscrow(buyerTimeoutContext);
    var failed = ctx
        .escrow
        .sendAny(
            ctx.actors.outsider.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_UNAUTHORIZED });
    failed = ctx
        .escrow
        .sendAny(
            ctx.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    testing.setNow(ctx.config.deliveryDeadline as uint32);
    val delivered = ctx
        .escrow
        .sendAny(
            ctx.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(delivered).toHaveSuccessfulTx<JettonMarkDelivered>({ to: ctx.escrow.address });

    failed = ctx
        .escrow
        .sendAny(
            ctx.actors.outsider.address,
            JettonRelease {
                queryId: JETTON_QUERY_ID + 2,
                settlementId: 5201,
                buyerQueryId: 0,
                sellerQueryId: JETTON_QUERY_ID + 3,
                treasuryQueryId: JETTON_QUERY_ID + 4,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_UNAUTHORIZED });
    val release = ctx
        .escrow
        .sendAny(
            ctx.actors.buyer.address,
            JettonRelease {
                queryId: JETTON_QUERY_ID + 2,
                settlementId: 5201,
                buyerQueryId: 0,
                sellerQueryId: JETTON_QUERY_ID + 3,
                treasuryQueryId: JETTON_QUERY_ID + 4,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(release).toHaveSuccessfulTx<JettonRelease>({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_SETTLEMENT_PENDING);

    ctx = disputeFundedContext;
    testing.setNow(ctx.config.deliveryDeadline as uint32);
    val fundedDispute = ctx
        .escrow
        .sendAny(
            ctx.actors.buyer.address,
            JettonOpenDispute { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(fundedDispute).toHaveSuccessfulTx<JettonOpenDispute>({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_DISPUTED);

    buyerTimeoutContext
        .escrow
        .sendAny(
            buyerTimeoutContext.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );

    ctx = resolutionContext;
    ctx
        .escrow
        .sendAny(
            ctx.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    testing.setNow(ctx.config.confirmationDeadline as uint32);
    val deliveredDispute = ctx
        .escrow
        .sendAny(
            ctx.actors.seller.address,
            JettonOpenDispute { queryId: JETTON_QUERY_ID + 2 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(deliveredDispute).toHaveSuccessfulTx<JettonOpenDispute>({ to: ctx.escrow.address });

    failed = ctx
        .escrow
        .sendAny(
            ctx.actors.outsider.address,
            JettonResolve {
                queryId: JETTON_QUERY_ID + 3,
                settlementId: 5203,
                buyerAward: JETTON_REFUND_TO_BUYER - JETTON_PLATFORM_FEE,
                sellerAward: JETTON_REFUND_FEE,
                buyerQueryId: JETTON_QUERY_ID + 4,
                sellerQueryId: JETTON_QUERY_ID + 5,
                treasuryQueryId: JETTON_QUERY_ID + 6,
            }.toCell(),
            { value: ton("0.25"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_UNAUTHORIZED });
    failed = ctx
        .escrow
        .sendAny(
            ctx.actors.arbitrator.address,
            JettonResolve {
                queryId: JETTON_QUERY_ID + 3,
                settlementId: 5203,
                buyerAward: JETTON_REFUND_TO_BUYER - JETTON_PLATFORM_FEE - 1,
                sellerAward: JETTON_REFUND_FEE,
                buyerQueryId: JETTON_QUERY_ID + 4,
                sellerQueryId: JETTON_QUERY_ID + 5,
                treasuryQueryId: JETTON_QUERY_ID + 6,
            }.toCell(),
            { value: ton("0.25"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_SETTLEMENT });
    val resolved = ctx
        .escrow
        .sendAny(
            ctx.actors.arbitrator.address,
            JettonResolve {
                queryId: JETTON_QUERY_ID + 3,
                settlementId: 5203,
                buyerAward: JETTON_REFUND_TO_BUYER - JETTON_PLATFORM_FEE,
                sellerAward: JETTON_REFUND_FEE,
                buyerQueryId: JETTON_QUERY_ID + 4,
                sellerQueryId: JETTON_QUERY_ID + 5,
                treasuryQueryId: JETTON_QUERY_ID + 6,
            }.toCell(),
            { value: ton("0.25"), bounce: false },
        );
    expect(resolved).toHaveSuccessfulTx<JettonResolve>({ to: ctx.escrow.address });

    ctx = voluntaryRefundContext;
    val refund = ctx
        .escrow
        .sendAny(
            ctx.actors.seller.address,
            JettonRefundBuyer {
                queryId: JETTON_QUERY_ID + 1,
                settlementId: 5204,
                buyerQueryId: JETTON_QUERY_ID + 2,
                sellerQueryId: 0,
                treasuryQueryId: JETTON_QUERY_ID + 3,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(refund).toHaveSuccessfulTx<JettonRefundBuyer>({ to: ctx.escrow.address });

    ctx = sellerTimeoutContext;
    val sellerTimeout = ctx
        .escrow
        .sendAny(
            ctx.actors.outsider.address,
            JettonRefundAfterSellerTimeout {
                queryId: JETTON_QUERY_ID + 1,
                settlementId: 5205,
                buyerQueryId: JETTON_QUERY_ID + 2,
                sellerQueryId: 0,
                treasuryQueryId: JETTON_QUERY_ID + 3,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(sellerTimeout).toHaveSuccessfulTx<JettonRefundAfterSellerTimeout>({
        to: ctx.escrow.address,
    });

    ctx = buyerTimeoutContext;
    testing.setNow(ctx.config.confirmationDeadline as uint32);
    failed = ctx
        .escrow
        .sendAny(
            ctx.actors.outsider.address,
            JettonReleaseAfterBuyerTimeout {
                queryId: JETTON_QUERY_ID + 2,
                settlementId: 5206,
                buyerQueryId: 0,
                sellerQueryId: JETTON_QUERY_ID + 3,
                treasuryQueryId: JETTON_QUERY_ID + 4,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_DEADLINE_NOT_REACHED });
    testing.setNow((ctx.config.confirmationDeadline + 1) as uint32);
    val buyerTimeout = ctx
        .escrow
        .sendAny(
            ctx.actors.outsider.address,
            JettonReleaseAfterBuyerTimeout {
                queryId: JETTON_QUERY_ID + 2,
                settlementId: 5206,
                buyerQueryId: 0,
                sellerQueryId: JETTON_QUERY_ID + 3,
                treasuryQueryId: JETTON_QUERY_ID + 4,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(buyerTimeout).toHaveSuccessfulTx<JettonReleaseAfterBuyerTimeout>({
        to: ctx.escrow.address,
    });
}

get fun `test Jetton payout dispatch emits exactly the immutable active legs`() {
    val releaseContext = setupJettonEscrow(5251);
    val refundContext = setupJettonEscrow(5252);
    val resolutionContext = setupJettonEscrow(5253);
    fundJettonEscrow(releaseContext);
    fundJettonEscrow(refundContext);
    fundJettonEscrow(resolutionContext);

    releaseContext
        .escrow
        .sendAny(
            releaseContext.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    val released = releaseContext
        .escrow
        .sendAny(
            releaseContext.actors.buyer.address,
            JettonRelease {
                queryId: JETTON_QUERY_ID + 2,
                settlementId: 5251,
                buyerQueryId: 0,
                sellerQueryId: JETTON_QUERY_ID + 3,
                treasuryQueryId: JETTON_QUERY_ID + 4,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    val releaseActions = released.at(0).allOutActions();
    expect(releaseActions).toHaveLength(2);
    var releaseBase = validSettlementBase(releaseContext.actors);
    releaseBase.settlementId = 5251;
    val releasePlanHash = releaseBase.toCell().hash();
    expectJettonPayoutAction(
        releaseActions,
        0,
        JETTON_QUERY_ID + 4,
        releaseContext.actors.treasury.address,
        JETTON_PLATFORM_FEE,
        releaseContext.escrow.address,
        5251,
        releasePlanHash,
        0,
        JETTON_LEG_TREASURY,
    );
    expectJettonPayoutAction(
        releaseActions,
        1,
        JETTON_QUERY_ID + 3,
        releaseContext.actors.seller.address,
        JETTON_SELLER_PAYOUT,
        releaseContext.escrow.address,
        5251,
        releasePlanHash,
        0,
        JETTON_LEG_SELLER,
    );

    refundContext
        .escrow
        .sendAny(
            refundContext.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    val refunded = refundContext
        .escrow
        .sendAny(
            refundContext.actors.seller.address,
            JettonRefundBuyer {
                queryId: JETTON_QUERY_ID + 2,
                settlementId: 5252,
                buyerQueryId: JETTON_QUERY_ID + 3,
                sellerQueryId: 0,
                treasuryQueryId: JETTON_QUERY_ID + 4,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    val refundActions = refunded.at(0).allOutActions();
    expect(refundActions).toHaveLength(2);
    val refundAmounts = JettonSettlementAmounts {
        buyer: JETTON_REFUND_TO_BUYER,
        seller: 0,
        treasury: JETTON_REFUND_FEE,
        total: JETTON_BUYER_TOTAL,
    }.toCell();
    val refundBase = JettonSettlementBase {
        settlementId: 5252,
        outcome: JETTON_OUTCOME_REFUND,
        activeMask: JETTON_LEG_BUYER | JETTON_LEG_TREASURY,
        conservationCommitment: refundAmounts.hash(),
        destinations: settlementDestinations(refundContext.actors),
        amounts: refundAmounts,
    }.toCell();
    val refundPlanHash = refundBase.hash();
    expectJettonPayoutAction(
        refundActions,
        0,
        JETTON_QUERY_ID + 4,
        refundContext.actors.treasury.address,
        JETTON_REFUND_FEE,
        refundContext.escrow.address,
        5252,
        refundPlanHash,
        0,
        JETTON_LEG_TREASURY,
    );
    expectJettonPayoutAction(
        refundActions,
        1,
        JETTON_QUERY_ID + 3,
        refundContext.actors.buyer.address,
        JETTON_REFUND_TO_BUYER,
        refundContext.escrow.address,
        5252,
        refundPlanHash,
        0,
        JETTON_LEG_BUYER,
    );

    resolutionContext
        .escrow
        .sendAny(
            resolutionContext.actors.buyer.address,
            JettonOpenDispute { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    val buyerAward = JETTON_REFUND_TO_BUYER - JETTON_PLATFORM_FEE;
    val sellerAward = JETTON_REFUND_FEE;
    val resolved = resolutionContext
        .escrow
        .sendAny(
            resolutionContext.actors.arbitrator.address,
            JettonResolve {
                queryId: JETTON_QUERY_ID + 2,
                settlementId: 5253,
                buyerAward,
                sellerAward,
                buyerQueryId: JETTON_QUERY_ID + 3,
                sellerQueryId: JETTON_QUERY_ID + 4,
                treasuryQueryId: JETTON_QUERY_ID + 5,
            }.toCell(),
            { value: ton("0.25"), bounce: false },
        );
    val resolutionActions = resolved.at(0).allOutActions();
    expect(resolutionActions).toHaveLength(3);
    val resolutionAmounts = JettonSettlementAmounts {
        buyer: buyerAward,
        seller: sellerAward,
        treasury: JETTON_PLATFORM_FEE,
        total: JETTON_BUYER_TOTAL,
    }.toCell();
    val resolutionBase = JettonSettlementBase {
        settlementId: 5253,
        outcome: JETTON_OUTCOME_RESOLUTION,
        activeMask: JETTON_ALL_LEGS,
        conservationCommitment: resolutionAmounts.hash(),
        destinations: settlementDestinations(resolutionContext.actors),
        amounts: resolutionAmounts,
    }.toCell();
    val resolutionPlanHash = resolutionBase.hash();
    expectJettonPayoutAction(
        resolutionActions,
        0,
        JETTON_QUERY_ID + 5,
        resolutionContext.actors.treasury.address,
        JETTON_PLATFORM_FEE,
        resolutionContext.escrow.address,
        5253,
        resolutionPlanHash,
        0,
        JETTON_LEG_TREASURY,
    );
    expectJettonPayoutAction(
        resolutionActions,
        1,
        JETTON_QUERY_ID + 4,
        resolutionContext.actors.seller.address,
        sellerAward,
        resolutionContext.escrow.address,
        5253,
        resolutionPlanHash,
        0,
        JETTON_LEG_SELLER,
    );
    expectJettonPayoutAction(
        resolutionActions,
        2,
        JETTON_QUERY_ID + 3,
        resolutionContext.actors.buyer.address,
        buyerAward,
        resolutionContext.escrow.address,
        5253,
        resolutionPlanHash,
        0,
        JETTON_LEG_BUYER,
    );
}

get fun `test Jetton zero-fee settlement omits treasury and accepts only zero inactive query`() {
    testing.setNow(JETTON_TEST_NOW);
    val actors = jettonActors();
    val payload = jettonPayload(5261);
    var config = jettonConfig(actors, 5261, payload);
    var commitment = JettonFundingCommitment.fromCell(config.commitment);
    var economics = commitment.loadEconomics();
    economics.sellerPayout = JETTON_BUYER_TOTAL;
    economics.platformFee = 0;
    economics.refundToBuyer = JETTON_BUYER_TOTAL;
    economics.refundFee = 0;
    commitment.economics = economics.toCell();
    config.commitment = commitment.toCell();
    val escrow = jettonEscrow(config);
    expect(
        escrow.deploy(actors.outsider.address, { value: ton("0.3"), bounce: false }),
    ).toHaveSuccessfulDeploy({ to: escrow.address });
    expect(sealJettonWallet(escrow, actors)).toHaveSuccessfulTx<SealCanonicalJettonWallet>({
        to: escrow.address,
    });
    val ctx = JettonTestContext { escrow, actors, payload, config };
    fundJettonEscrow(ctx);
    escrow.sendAny(
        actors.seller.address,
        JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
        { value: ton("0.08"), bounce: false },
    );
    testing.setNow(config.confirmationDeadline as uint32);
    var command = JettonRelease {
        queryId: JETTON_QUERY_ID + 2,
        settlementId: 5261,
        buyerQueryId: 0,
        sellerQueryId: JETTON_QUERY_ID + 3,
        treasuryQueryId: JETTON_QUERY_ID + 4,
    };
    expect(
        escrow.sendAny(
            actors.buyer.address,
            command.toCell(),
            { value: ton("0.2"), bounce: false },
        ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    command.treasuryQueryId = 0;
    val released = escrow.sendAny(
        actors.buyer.address,
        command.toCell(),
        { value: ton("0.2"), bounce: false },
    );
    expect(released).toHaveSuccessfulTx<JettonRelease>({ to: escrow.address });
    val actions = released.at(0).allOutActions();
    expect(actions).toHaveLength(1);
    val amounts = JettonSettlementAmounts {
        buyer: 0,
        seller: JETTON_BUYER_TOTAL,
        treasury: 0,
        total: JETTON_BUYER_TOTAL,
    }.toCell();
    val base = JettonSettlementBase {
        settlementId: 5261,
        outcome: JETTON_OUTCOME_RELEASE,
        activeMask: JETTON_LEG_SELLER,
        conservationCommitment: amounts.hash(),
        destinations: settlementDestinations(actors),
        amounts,
    }.toCell();
    expectJettonPayoutAction(
        actions,
        0,
        JETTON_QUERY_ID + 3,
        actors.seller.address,
        JETTON_BUYER_TOTAL,
        escrow.address,
        5261,
        base.hash(),
        0,
        JETTON_LEG_SELLER,
    );
}

get fun `test Jetton unexpected funding and empty topups cannot mutate lifecycle state`() {
    val ctx = setupJettonEscrow(5265);
    fundJettonEscrow(ctx);
    val lastQueryId = ctx.escrow.getJettonLastQueryId();
    val unexpected = ctx
        .escrow
        .sendAny(
            ctx.actors.wallet.address,
            notificationBody(
                JETTON_QUERY_ID + 1,
                JETTON_BUYER_TOTAL,
                ctx.actors.buyer.address,
                ctx.payload,
            ),
            { value: ton("0.08"), bounce: false },
        );
    expect(unexpected).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });
    val topup = ctx
        .escrow
        .sendAny(
            ctx.actors.outsider.address,
            beginCell().endCell(),
            { value: ton("0.05"), bounce: false },
        );
    expect(topup).toHaveSuccessfulTx({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_FUNDED);
    expect(ctx.escrow.getJettonLastQueryId()).toEqual(lastQueryId);
    beginJettonRelease(ctx, 5265);
    val settlementHash = ctx.escrow.getJettonSettlementHash();
    expect(
        ctx
            .escrow
            .sendAny(
                ctx.actors.outsider.address,
                beginCell().endCell(),
                { value: ton("0.05"), bounce: false },
            ),
    ).toHaveSuccessfulTx({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_SETTLEMENT_PENDING);
    expect(ctx.escrow.getJettonSettlementHash()).toEqual(settlementHash);
}

get fun `test Jetton payout action failure rolls storage back before settlement pending`() {
    testing.setNow(JETTON_TEST_NOW);
    val actors = jettonActors();
    val payload = jettonPayload(5266);
    val config = jettonConfig(actors, 5266, payload);
    val escrow = jettonEscrow(config);
    expect(
        escrow.deploy(actors.outsider.address, { value: ton("0.02"), bounce: false }),
    ).toHaveSuccessfulDeploy({ to: escrow.address });
    expect(
        escrow.sendAny(
            actors.initializer.address,
            SealCanonicalJettonWallet {
                queryId: JETTON_SEAL_QUERY_ID,
                wallet: actors.wallet.address,
                walletCodeHash: JETTON_WALLET_CODE_HASH,
                verificationEvidenceHash: JETTON_WALLET_EVIDENCE_HASH,
            }.toCell(),
            { value: ton("0.01"), bounce: false },
        ),
    ).toHaveSuccessfulTx<SealCanonicalJettonWallet>({ to: escrow.address });
    expect(
        escrow.sendAny(
            actors.wallet.address,
            notificationBody(JETTON_QUERY_ID, JETTON_BUYER_TOTAL, actors.buyer.address, payload),
            { value: ton("0.01"), bounce: false },
        ),
    ).toHaveSuccessfulTx<JettonTransferNotification>({ to: escrow.address });
    expect(
        escrow.sendAny(
            actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.01"), bounce: false },
        ),
    ).toHaveSuccessfulTx<JettonMarkDelivered>({ to: escrow.address });
    val release = escrow.sendAny(
        actors.buyer.address,
        JettonRelease {
            queryId: JETTON_QUERY_ID + 2,
            settlementId: 5266,
            buyerQueryId: 0,
            sellerQueryId: JETTON_QUERY_ID + 3,
            treasuryQueryId: JETTON_QUERY_ID + 4,
        }.toCell(),
        { value: ton("0.005"), bounce: false },
    );
    expect(release).toHaveTx({ to: escrow.address, success: false });
    expect(escrow.getJettonStatus()).toEqual(JETTON_STATUS_DELIVERED);
    expect(escrow.getJettonLastQueryId()).toEqual(JETTON_QUERY_ID + 1);
    expect(escrow.getJettonSettlementHash()).toEqual(beginCell().endCell().hash());
}

get fun `test Jetton lifecycle rejects every wrong state role stale query and deadline boundary`() {
    val markState = setupJettonEscrow(5271);
    var failed = markState
        .escrow
        .sendAny(
            markState.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });
    fundJettonEscrow(markState);
    testing.setNow((markState.config.deliveryDeadline + 1) as uint32);
    failed = markState
        .escrow
        .sendAny(
            markState.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_DEADLINE_PASSED });

    val disputeState = setupJettonEscrow(5272);
    failed = disputeState
        .escrow
        .sendAny(
            disputeState.actors.buyer.address,
            JettonOpenDispute { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });
    fundJettonEscrow(disputeState);
    failed = disputeState
        .escrow
        .sendAny(
            disputeState.actors.outsider.address,
            JettonOpenDispute { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_UNAUTHORIZED });
    failed = disputeState
        .escrow
        .sendAny(
            disputeState.actors.buyer.address,
            JettonOpenDispute { queryId: JETTON_QUERY_ID }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    testing.setNow((disputeState.config.deliveryDeadline + 1) as uint32);
    failed = disputeState
        .escrow
        .sendAny(
            disputeState.actors.buyer.address,
            JettonOpenDispute { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_DEADLINE_PASSED });

    val deliveredDispute = setupJettonEscrow(5273);
    fundJettonEscrow(deliveredDispute);
    deliveredDispute
        .escrow
        .sendAny(
            deliveredDispute.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    testing.setNow((deliveredDispute.config.confirmationDeadline + 1) as uint32);
    failed = deliveredDispute
        .escrow
        .sendAny(
            deliveredDispute.actors.seller.address,
            JettonOpenDispute { queryId: JETTON_QUERY_ID + 2 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_DEADLINE_PASSED });
    failed = deliveredDispute
        .escrow
        .sendAny(
            deliveredDispute.actors.buyer.address,
            JettonRelease {
                queryId: JETTON_QUERY_ID + 2,
                settlementId: 5273,
                buyerQueryId: 0,
                sellerQueryId: JETTON_QUERY_ID + 3,
                treasuryQueryId: JETTON_QUERY_ID + 4,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_DEADLINE_PASSED });

    val wrongStates = setupJettonEscrow(5274);
    fundJettonEscrow(wrongStates);
    val release = JettonRelease {
        queryId: JETTON_QUERY_ID + 1,
        settlementId: 5274,
        buyerQueryId: 0,
        sellerQueryId: JETTON_QUERY_ID + 2,
        treasuryQueryId: JETTON_QUERY_ID + 3,
    };
    expect(
        wrongStates
            .escrow
            .sendAny(
                wrongStates.actors.buyer.address,
                release.toCell(),
                { value: ton("0.2"), bounce: false },
            ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });
    val refund = JettonRefundBuyer {
        queryId: JETTON_QUERY_ID + 1,
        settlementId: 5274,
        buyerQueryId: JETTON_QUERY_ID + 2,
        sellerQueryId: 0,
        treasuryQueryId: JETTON_QUERY_ID + 3,
    };
    expect(
        wrongStates
            .escrow
            .sendAny(
                wrongStates.actors.outsider.address,
                refund.toCell(),
                { value: ton("0.2"), bounce: false },
            ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_UNAUTHORIZED });
    val releaseTimeout = JettonReleaseAfterBuyerTimeout {
        queryId: JETTON_QUERY_ID + 1,
        settlementId: 5274,
        buyerQueryId: 0,
        sellerQueryId: JETTON_QUERY_ID + 2,
        treasuryQueryId: JETTON_QUERY_ID + 3,
    };
    expect(
        wrongStates
            .escrow
            .sendAny(
                wrongStates.actors.outsider.address,
                releaseTimeout.toCell(),
                { value: ton("0.2"), bounce: false },
            ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });
    val resolve = JettonResolve {
        queryId: JETTON_QUERY_ID + 1,
        settlementId: 5274,
        buyerAward: JETTON_REFUND_TO_BUYER - JETTON_PLATFORM_FEE,
        sellerAward: JETTON_REFUND_FEE,
        buyerQueryId: JETTON_QUERY_ID + 2,
        sellerQueryId: JETTON_QUERY_ID + 3,
        treasuryQueryId: JETTON_QUERY_ID + 4,
    };
    expect(
        wrongStates
            .escrow
            .sendAny(
                wrongStates.actors.arbitrator.address,
                resolve.toCell(),
                { value: ton("0.25"), bounce: false },
            ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });

    wrongStates
        .escrow
        .sendAny(
            wrongStates.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    testing.setNow(wrongStates.config.deliveryDeadline as uint32);
    val refundTimeout = JettonRefundAfterSellerTimeout {
        queryId: JETTON_QUERY_ID + 2,
        settlementId: 5274,
        buyerQueryId: JETTON_QUERY_ID + 3,
        sellerQueryId: 0,
        treasuryQueryId: JETTON_QUERY_ID + 4,
    };
    expect(
        wrongStates
            .escrow
            .sendAny(
                wrongStates.actors.outsider.address,
                refundTimeout.toCell(),
                { value: ton("0.2"), bounce: false },
            ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });

    val sellerBoundary = setupJettonEscrow(5275);
    fundJettonEscrow(sellerBoundary);
    testing.setNow(sellerBoundary.config.deliveryDeadline as uint32);
    expect(
        sellerBoundary
            .escrow
            .sendAny(
                sellerBoundary.actors.outsider.address,
                JettonRefundAfterSellerTimeout {
                    queryId: JETTON_QUERY_ID + 1,
                    settlementId: 5275,
                    buyerQueryId: JETTON_QUERY_ID + 2,
                    sellerQueryId: 0,
                    treasuryQueryId: JETTON_QUERY_ID + 3,
                }.toCell(),
                { value: ton("0.2"), bounce: false },
            ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_DEADLINE_NOT_REACHED });

    val refundState = setupJettonEscrow(5276);
    expect(
        refundState
            .escrow
            .sendAny(
                refundState.actors.seller.address,
                JettonRefundBuyer {
                    queryId: JETTON_QUERY_ID + 1,
                    settlementId: 5276,
                    buyerQueryId: JETTON_QUERY_ID + 2,
                    sellerQueryId: 0,
                    treasuryQueryId: JETTON_QUERY_ID + 3,
                }.toCell(),
                { value: ton("0.2"), bounce: false },
            ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });
}

get fun `test Jetton persisted recovery and finalization boundaries are explicit`() {
    testing.setNow(JETTON_TEST_NOW);
    val actors = jettonActors();
    val config = jettonConfig(actors, 5281, jettonPayload(5281));
    var base = validSettlementBase(actors);
    base.settlementId = 5281;

    var finalizedAttempt = validPendingAttempt();
    finalizedAttempt.activeMask = 0;
    finalizedAttempt.confirmedMask = JETTON_LEG_SELLER | JETTON_LEG_TREASURY;
    finalizedAttempt.reconciliationEvidenceHash = 0x528101;
    val finalized = persistedSettlementEscrow(
        actors,
        config,
        JETTON_STATUS_SETTLED_FINALIZED,
        JETTON_QUERY_ID + 5,
        base,
        finalizedAttempt,
    );
    expect(
        finalized.deploy(actors.outsider.address, { value: ton("0.3"), bounce: false }),
    ).toHaveSuccessfulDeploy({ to: finalized.address });

    val resolutionAmounts = JettonSettlementAmounts {
        buyer: JETTON_REFUND_TO_BUYER - JETTON_PLATFORM_FEE,
        seller: JETTON_REFUND_FEE,
        treasury: JETTON_PLATFORM_FEE,
        total: JETTON_BUYER_TOTAL,
    }.toCell();
    val resolutionBase = JettonSettlementBase {
        settlementId: 5282,
        outcome: JETTON_OUTCOME_RESOLUTION,
        activeMask: JETTON_ALL_LEGS,
        conservationCommitment: resolutionAmounts.hash(),
        destinations: settlementDestinations(actors),
        amounts: resolutionAmounts,
    };
    val resolutionAttempt = JettonSettlementAttempt {
        attempt: 0,
        activeMask: JETTON_ALL_LEGS,
        confirmedMask: 0,
        failedMask: 0,
        bouncedMask: 0,
        reconciliationEvidenceHash: 0,
        queries: JettonSettlementQueries {
            buyer: JETTON_QUERY_ID + 3,
            seller: JETTON_QUERY_ID + 4,
            treasury: JETTON_QUERY_ID + 5,
        }.toCell(),
    };
    val resolution = persistedSettlementEscrow(
        actors,
        config,
        JETTON_STATUS_SETTLEMENT_PENDING,
        JETTON_QUERY_ID + 5,
        resolutionBase,
        resolutionAttempt,
    );
    expect(
        resolution.deploy(actors.outsider.address, { value: ton("0.3"), bounce: false }),
    ).toHaveSuccessfulDeploy({ to: resolution.address });

    var exhaustedAttempt = validPendingAttempt();
    exhaustedAttempt.attempt = 0xffffffff;
    exhaustedAttempt.activeMask = JETTON_LEG_TREASURY;
    exhaustedAttempt.confirmedMask = JETTON_LEG_SELLER;
    exhaustedAttempt.failedMask = JETTON_LEG_TREASURY;
    exhaustedAttempt.reconciliationEvidenceHash = 0x528102;
    val recovery = persistedSettlementEscrow(
        actors,
        config,
        JETTON_STATUS_RECOVERY_REQUIRED,
        JETTON_QUERY_ID + 5,
        base,
        exhaustedAttempt,
    );
    expect(
        recovery.deploy(actors.outsider.address, { value: ton("0.3"), bounce: false }),
    ).toHaveSuccessfulDeploy({ to: recovery.address });
    expect(
        recovery.sendAny(
            actors.reconciliation.address,
            JettonRetryFailedLegs {
                queryId: JETTON_QUERY_ID + 6,
                settlementId: 5281,
                previousAttempt: 0xffffffff,
                buyerQueryId: 0,
                sellerQueryId: 0,
                treasuryQueryId: JETTON_QUERY_ID + 7,
            }.toCell(),
            { value: ton("0.15"), bounce: false },
        ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_QUERY_EXHAUSTED });
    expect(
        recovery.sendAny(
            actors.reconciliation.address,
            JettonFinalizeSettlement {
                queryId: JETTON_QUERY_ID + 6,
                settlementId: 5281,
                attempt: 0xffffffff,
                evidenceHash: 0x528102,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });

    var zeroEvidenceAttempt = validPendingAttempt();
    zeroEvidenceAttempt.activeMask = 0;
    zeroEvidenceAttempt.confirmedMask = JETTON_LEG_SELLER | JETTON_LEG_TREASURY;
    zeroEvidenceAttempt.reconciliationEvidenceHash = 0;
    val zeroEvidence = persistedSettlementEscrow(
        actors,
        config,
        JETTON_STATUS_SETTLEMENT_PENDING,
        JETTON_QUERY_ID + 5,
        base,
        zeroEvidenceAttempt,
    );
    expect(
        zeroEvidence.deploy(actors.outsider.address, { value: ton("0.3"), bounce: false }),
    ).toHaveSuccessfulDeploy({ to: zeroEvidence.address });
    expect(
        zeroEvidence.sendAny(
            actors.reconciliation.address,
            JettonFinalizeSettlement {
                queryId: JETTON_QUERY_ID + 6,
                settlementId: 5281,
                attempt: 0,
                evidenceHash: 0,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_INCOMPLETE_RECONCILIATION });

    var incompleteAttempt = validPendingAttempt();
    incompleteAttempt.activeMask = JETTON_LEG_TREASURY;
    incompleteAttempt.confirmedMask = JETTON_LEG_SELLER;
    incompleteAttempt.reconciliationEvidenceHash = 0x528103;
    val incomplete = persistedSettlementEscrow(
        actors,
        config,
        JETTON_STATUS_SETTLEMENT_PENDING,
        JETTON_QUERY_ID + 5,
        base,
        incompleteAttempt,
    );
    expect(
        incomplete.deploy(actors.outsider.address, { value: ton("0.3"), bounce: false }),
    ).toHaveSuccessfulDeploy({ to: incomplete.address });
    expect(
        incomplete.sendAny(
            actors.reconciliation.address,
            JettonFinalizeSettlement {
                queryId: JETTON_QUERY_ID + 6,
                settlementId: 5281,
                attempt: 0,
                evidenceHash: 0x528103,
            }.toCell(),
            { value: ton("0.08"), bounce: false },
        ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_INCOMPLETE_RECONCILIATION });

    val pending = setupJettonEscrow(5284);
    fundJettonEscrow(pending);
    beginJettonRelease(pending, 5284);
    expect(
        pending
            .escrow
            .sendAny(
                pending.actors.reconciliation.address,
                JettonRetryFailedLegs {
                    queryId: JETTON_QUERY_ID + 5,
                    settlementId: 5284,
                    previousAttempt: 0,
                    buyerQueryId: 0,
                    sellerQueryId: 0,
                    treasuryQueryId: JETTON_QUERY_ID + 6,
                }.toCell(),
                { value: ton("0.15"), bounce: false },
            ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_STATE });
}

get fun `test Jetton settlement queries are fresh distinct complete and exhaustion safe`() {
    val releaseContext = setupJettonEscrow(5301);
    val refundContext = setupJettonEscrow(5302);
    val resolutionContext = setupJettonEscrow(5303);
    fundJettonEscrow(releaseContext);
    fundJettonEscrow(refundContext);
    fundJettonEscrow(resolutionContext);
    releaseContext
        .escrow
        .sendAny(
            releaseContext.actors.seller.address,
            JettonMarkDelivered { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );

    var command = JettonRelease {
        queryId: JETTON_QUERY_ID + 2,
        settlementId: 0,
        buyerQueryId: 0,
        sellerQueryId: JETTON_QUERY_ID + 3,
        treasuryQueryId: JETTON_QUERY_ID + 4,
    };
    var failed = releaseContext
        .escrow
        .sendAny(
            releaseContext.actors.buyer.address,
            command.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_SETTLEMENT });

    command.settlementId = 5301;
    command.queryId = JETTON_QUERY_ID + 1;
    failed = releaseContext
        .escrow
        .sendAny(
            releaseContext.actors.buyer.address,
            command.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });

    command.queryId = JETTON_QUERY_ID + 2;
    command.buyerQueryId = JETTON_QUERY_ID + 5;
    failed = releaseContext
        .escrow
        .sendAny(
            releaseContext.actors.buyer.address,
            command.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    command.buyerQueryId = 0;
    command.sellerQueryId = command.queryId;
    failed = releaseContext
        .escrow
        .sendAny(
            releaseContext.actors.buyer.address,
            command.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    command.sellerQueryId = JETTON_QUERY_ID + 3;
    command.treasuryQueryId = command.queryId;
    failed = releaseContext
        .escrow
        .sendAny(
            releaseContext.actors.buyer.address,
            command.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    command.treasuryQueryId = command.sellerQueryId;
    failed = releaseContext
        .escrow
        .sendAny(
            releaseContext.actors.buyer.address,
            command.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    command.sellerQueryId = JETTON_QUERY_ID + 3;
    command.treasuryQueryId = 0xffffffffffffffff;
    failed = releaseContext
        .escrow
        .sendAny(
            releaseContext.actors.buyer.address,
            command.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_QUERY_EXHAUSTED });

    var refund = JettonRefundBuyer {
        queryId: JETTON_QUERY_ID + 1,
        settlementId: 5302,
        buyerQueryId: JETTON_QUERY_ID + 2,
        sellerQueryId: JETTON_QUERY_ID + 4,
        treasuryQueryId: JETTON_QUERY_ID + 3,
    };
    failed = refundContext
        .escrow
        .sendAny(
            refundContext.actors.seller.address,
            refund.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    refund.sellerQueryId = 0;
    refund.buyerQueryId = refund.queryId;
    failed = refundContext
        .escrow
        .sendAny(
            refundContext.actors.seller.address,
            refund.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    refund.buyerQueryId = JETTON_QUERY_ID + 2;
    refund.treasuryQueryId = refund.queryId;
    failed = refundContext
        .escrow
        .sendAny(
            refundContext.actors.seller.address,
            refund.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    refund.treasuryQueryId = refund.buyerQueryId;
    failed = refundContext
        .escrow
        .sendAny(
            refundContext.actors.seller.address,
            refund.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });

    resolutionContext
        .escrow
        .sendAny(
            resolutionContext.actors.buyer.address,
            JettonOpenDispute { queryId: JETTON_QUERY_ID + 1 }.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    var resolution = JettonResolve {
        queryId: JETTON_QUERY_ID + 2,
        settlementId: 5303,
        buyerAward: JETTON_REFUND_TO_BUYER - JETTON_PLATFORM_FEE,
        sellerAward: JETTON_REFUND_FEE,
        buyerQueryId: JETTON_QUERY_ID + 5,
        sellerQueryId: JETTON_QUERY_ID + 5,
        treasuryQueryId: JETTON_QUERY_ID + 3,
    };
    failed = resolutionContext
        .escrow
        .sendAny(
            resolutionContext.actors.arbitrator.address,
            resolution.toCell(),
            { value: ton("0.25"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    resolution.buyerQueryId = JETTON_QUERY_ID + 3;
    resolution.sellerQueryId = JETTON_QUERY_ID + 4;
    resolution.treasuryQueryId = JETTON_QUERY_ID + 5;
    val resolved = resolutionContext
        .escrow
        .sendAny(
            resolutionContext.actors.arbitrator.address,
            resolution.toCell(),
            { value: ton("0.25"), bounce: false },
        );
    expect(resolved).toHaveSuccessfulTx<JettonResolve>({ to: resolutionContext.escrow.address });
    expect(resolutionContext.escrow.getJettonLastQueryId()).toEqual(JETTON_QUERY_ID + 5);
}

get fun `test Jetton reconciliation retry and finalization reject every stale authority and mask`() {
    val pending = setupJettonEscrow(5401);
    val recovery = setupJettonEscrow(5402);
    fundJettonEscrow(pending);
    fundJettonEscrow(recovery);
    beginJettonRelease(pending, 5401);
    beginJettonRelease(recovery, 5402);

    var report = JettonReconcileAttempt {
        queryId: JETTON_QUERY_ID + 5,
        settlementId: 5401,
        attempt: 0,
        activeMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
        confirmedMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
        failedMask: 0,
        evidenceHash: 0x540101,
    };
    var failed = pending
        .escrow
        .sendAny(
            pending.actors.outsider.address,
            report.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_UNAUTHORIZED });
    report.queryId = JETTON_QUERY_ID + 4;
    failed = pending
        .escrow
        .sendAny(
            pending.actors.reconciliation.address,
            report.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    report.queryId = JETTON_QUERY_ID + 5;
    report.evidenceHash = 0;
    failed = pending
        .escrow
        .sendAny(
            pending.actors.reconciliation.address,
            report.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_INCOMPLETE_RECONCILIATION });
    report.evidenceHash = 0x540101;
    report.settlementId = 1;
    failed = pending
        .escrow
        .sendAny(
            pending.actors.reconciliation.address,
            report.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_SETTLEMENT });
    report.settlementId = 5401;
    report.attempt = 1;
    failed = pending
        .escrow
        .sendAny(
            pending.actors.reconciliation.address,
            report.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_STALE_ATTEMPT });
    report.attempt = 0;
    report.activeMask = JETTON_LEG_SELLER;
    report.confirmedMask = JETTON_LEG_SELLER;
    failed = pending
        .escrow
        .sendAny(
            pending.actors.reconciliation.address,
            report.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_MASK });
    report.activeMask = JETTON_LEG_SELLER | JETTON_LEG_TREASURY;
    report.confirmedMask = JETTON_LEG_SELLER | JETTON_LEG_TREASURY;
    report.failedMask = JETTON_LEG_SELLER;
    failed = pending
        .escrow
        .sendAny(
            pending.actors.reconciliation.address,
            report.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_MASK });
    report.failedMask = 0;
    val accepted = pending
        .escrow
        .sendAny(
            pending.actors.reconciliation.address,
            report.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(accepted).toHaveSuccessfulTx<JettonReconcileAttempt>({ to: pending.escrow.address });

    var finalization = JettonFinalizeSettlement {
        queryId: JETTON_QUERY_ID + 6,
        settlementId: 5401,
        attempt: 0,
        evidenceHash: 0x540101,
    };
    failed = pending
        .escrow
        .sendAny(
            pending.actors.outsider.address,
            finalization.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_UNAUTHORIZED });
    finalization.queryId = JETTON_QUERY_ID + 5;
    failed = pending
        .escrow
        .sendAny(
            pending.actors.reconciliation.address,
            finalization.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
    finalization.queryId = JETTON_QUERY_ID + 6;
    finalization.settlementId = 1;
    failed = pending
        .escrow
        .sendAny(
            pending.actors.reconciliation.address,
            finalization.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_SETTLEMENT });
    finalization.settlementId = 5401;
    finalization.attempt = 1;
    failed = pending
        .escrow
        .sendAny(
            pending.actors.reconciliation.address,
            finalization.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_STALE_ATTEMPT });
    finalization.attempt = 0;
    finalization.evidenceHash = 0x540102;
    failed = pending
        .escrow
        .sendAny(
            pending.actors.reconciliation.address,
            finalization.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_INCOMPLETE_RECONCILIATION });

    report = JettonReconcileAttempt {
        queryId: JETTON_QUERY_ID + 5,
        settlementId: 5402,
        attempt: 0,
        activeMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
        confirmedMask: JETTON_LEG_SELLER,
        failedMask: JETTON_LEG_TREASURY,
        evidenceHash: 0x540201,
    };
    recovery
        .escrow
        .sendAny(
            recovery.actors.reconciliation.address,
            report.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    var retry = JettonRetryFailedLegs {
        queryId: JETTON_QUERY_ID + 6,
        settlementId: 5402,
        previousAttempt: 0,
        buyerQueryId: 0,
        sellerQueryId: 0,
        treasuryQueryId: JETTON_QUERY_ID + 7,
    };
    failed = recovery
        .escrow
        .sendAny(
            recovery.actors.outsider.address,
            retry.toCell(),
            { value: ton("0.15"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_UNAUTHORIZED });
    retry.settlementId = 1;
    failed = recovery
        .escrow
        .sendAny(
            recovery.actors.reconciliation.address,
            retry.toCell(),
            { value: ton("0.15"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_SETTLEMENT });
    retry.settlementId = 5402;
    retry.previousAttempt = 1;
    failed = recovery
        .escrow
        .sendAny(
            recovery.actors.reconciliation.address,
            retry.toCell(),
            { value: ton("0.15"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_STALE_ATTEMPT });
    retry.previousAttempt = 0;
    retry.queryId = JETTON_QUERY_ID + 5;
    failed = recovery
        .escrow
        .sendAny(
            recovery.actors.reconciliation.address,
            retry.toCell(),
            { value: ton("0.15"), bounce: false },
        );
    expect(failed).toHaveFailedTx({ exitCode: JETTON_ERROR_WRONG_QUERY_ID });
}

get fun `test Jetton rich bounce authenticates every transfer commitment field`() {
    val ctx = setupJettonEscrow(5501);
    fundJettonEscrow(ctx);
    beginJettonRelease(ctx, 5501);
    val sellerBody = releasePayoutBody(
        ctx,
        5501,
        JETTON_LEG_SELLER,
        JETTON_QUERY_ID + 3,
        ctx.actors.seller.address,
        JETTON_SELLER_PAYOUT,
    );

    var result = net.send(
        ctx.actors.outsider.address,
        richBouncedPayout(ctx.escrow.address, sellerBody),
    );
    expect(result).toHaveFailedTx({
        to: ctx.escrow.address,
        exitCode: JETTON_ERROR_UNAUTHORIZED_WALLET,
    });

    var transfer = JettonTransfer.fromCell(sellerBody);
    transfer.queryId = 1;
    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, transfer.toCell()),
    );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_STALE_ATTEMPT });
    transfer = JettonTransfer.fromCell(sellerBody);
    transfer.destination = ctx.actors.outsider.address;
    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, transfer.toCell()),
    );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_BOUNCE });
    transfer = JettonTransfer.fromCell(sellerBody);
    transfer.amount -= 1;
    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, transfer.toCell()),
    );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_BOUNCE });
    transfer = JettonTransfer.fromCell(sellerBody);
    transfer.responseDestination = ctx.actors.outsider.address;
    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, transfer.toCell()),
    );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_BOUNCE });
    transfer = JettonTransfer.fromCell(sellerBody);
    transfer.forwardTonAmount = 1;
    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, transfer.toCell()),
    );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_BOUNCE });
    transfer = JettonTransfer.fromCell(sellerBody);
    transfer.customPayload = null;
    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, transfer.toCell()),
    );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_BOUNCE });
    transfer = JettonTransfer.fromCell(sellerBody);
    transfer.customPayload = beginCell().storeUint(1, 1).endCell();
    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, transfer.toCell()),
    );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_BOUNCE });
    transfer = JettonTransfer.fromCell(sellerBody);
    transfer.forwardPayload = beginCell().storeUint(1, 1).endCell().beginParse();
    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, transfer.toCell()),
    );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_BOUNCE });
    transfer = JettonTransfer.fromCell(sellerBody);
    transfer.forwardPayload = beginCell().storeUint(0, 2).endCell().beginParse();
    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, transfer.toCell()),
    );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_BOUNCE });
    transfer = JettonTransfer.fromCell(sellerBody);
    transfer.forwardPayload = beginCell()
        .storeUint(0, 1)
        .storeRef(beginCell().endCell())
        .endCell()
        .beginParse();
    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, transfer.toCell()),
    );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_BOUNCE });

    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, sellerBody),
    );
    expect(result).toHaveBouncedTx({
        from: ctx.actors.wallet.address,
        to: ctx.escrow.address,
    });
    result = net.send(
        ctx.actors.wallet.address,
        richBouncedPayout(ctx.escrow.address, sellerBody),
    );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_STALE_ATTEMPT });

    var report = JettonReconcileAttempt {
        queryId: JETTON_QUERY_ID + 5,
        settlementId: 5501,
        attempt: 0,
        activeMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
        confirmedMask: JETTON_LEG_SELLER | JETTON_LEG_TREASURY,
        failedMask: 0,
        evidenceHash: 0x550101,
    };
    result = ctx
        .escrow
        .sendAny(
            ctx.actors.reconciliation.address,
            report.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(result).toHaveFailedTx({ exitCode: JETTON_ERROR_INVALID_BOUNCE });
    report.confirmedMask = JETTON_LEG_TREASURY;
    report.failedMask = JETTON_LEG_SELLER;
    result = ctx
        .escrow
        .sendAny(
            ctx.actors.reconciliation.address,
            report.toCell(),
            { value: ton("0.08"), bounce: false },
        );
    expect(result).toHaveSuccessfulTx<JettonReconcileAttempt>({ to: ctx.escrow.address });
    expect(ctx.escrow.getJettonStatus()).toEqual(JETTON_STATUS_RECOVERY_REQUIRED);
}

get fun `test Jetton rich bounce selects buyer treasury and rejects an inactive zero query`() {
    val treasuryContext = setupJettonEscrow(5511);
    fundJettonEscrow(treasuryContext);
    beginJettonRelease(treasuryContext, 5511);
    val treasuryBody = releasePayoutBody(
        treasuryContext,
        5511,
        JETTON_LEG_TREASURY,
        JETTON_QUERY_ID + 4,
        treasuryContext.actors.treasury.address,
        JETTON_PLATFORM_FEE,
    );
    val treasuryBounce = net.send(
        treasuryContext.actors.wallet.address,
        richBouncedPayout(treasuryContext.escrow.address, treasuryBody),
    );
    expect(treasuryBounce).toHaveSuccessfulTx({
        to: treasuryContext.escrow.address,
        bounced: true,
    });

    var inactiveBase = validSettlementBase(treasuryContext.actors);
    inactiveBase.settlementId = 5511;
    val inactiveBody = JettonTransfer {
        queryId: 0,
        amount: 0,
        destination: treasuryContext.actors.buyer.address,
        responseDestination: treasuryContext.escrow.address,
        customPayload: JettonPayoutCommitment {
            settlementId: 5511,
            planHash: inactiveBase.toCell().hash(),
            attempt: 0,
            leg: JETTON_LEG_BUYER,
        }.toCell(),
        forwardTonAmount: 0,
        forwardPayload: beginCell().storeUint(0, 1).endCell().beginParse(),
    }.toCell();
    expect(
        net.send(
            treasuryContext.actors.wallet.address,
            richBouncedPayout(treasuryContext.escrow.address, inactiveBody),
        ),
    ).toHaveFailedTx({ exitCode: JETTON_ERROR_STALE_ATTEMPT });

    val buyerContext = setupJettonEscrow(5512);
    fundJettonEscrow(buyerContext);
    val refunded = buyerContext
        .escrow
        .sendAny(
            buyerContext.actors.seller.address,
            JettonRefundBuyer {
                queryId: JETTON_QUERY_ID + 1,
                settlementId: 5512,
                buyerQueryId: JETTON_QUERY_ID + 2,
                sellerQueryId: 0,
                treasuryQueryId: JETTON_QUERY_ID + 3,
            }.toCell(),
            { value: ton("0.2"), bounce: false },
        );
    expect(refunded).toHaveSuccessfulTx<JettonRefundBuyer>({ to: buyerContext.escrow.address });
    val refundAmounts = JettonSettlementAmounts {
        buyer: JETTON_REFUND_TO_BUYER,
        seller: 0,
        treasury: JETTON_REFUND_FEE,
        total: JETTON_BUYER_TOTAL,
    }.toCell();
    val refundBase = JettonSettlementBase {
        settlementId: 5512,
        outcome: JETTON_OUTCOME_REFUND,
        activeMask: JETTON_LEG_BUYER | JETTON_LEG_TREASURY,
        conservationCommitment: refundAmounts.hash(),
        destinations: settlementDestinations(buyerContext.actors),
        amounts: refundAmounts,
    }.toCell();
    val buyerBody = JettonTransfer {
        queryId: JETTON_QUERY_ID + 2,
        amount: JETTON_REFUND_TO_BUYER,
        destination: buyerContext.actors.buyer.address,
        responseDestination: buyerContext.escrow.address,
        customPayload: JettonPayoutCommitment {
            settlementId: 5512,
            planHash: refundBase.hash(),
            attempt: 0,
            leg: JETTON_LEG_BUYER,
        }.toCell(),
        forwardTonAmount: 0,
        forwardPayload: beginCell().storeUint(0, 1).endCell().beginParse(),
    }.toCell();
    val buyerBounce = net.send(
        buyerContext.actors.wallet.address,
        richBouncedPayout(buyerContext.escrow.address, buyerBody),
    );
    expect(buyerBounce).toHaveSuccessfulTx({ to: buyerContext.escrow.address, bounced: true });
}
