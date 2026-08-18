import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"
import "@acton/testing/fuzz"

import "@contracts/types"
import "@wrappers/TonNativeEscrow.gen"

const TEST_NOW = 2000000000
const BUYER_TOTAL: coins = 10000000000
const SELLER_PAYOUT: coins = 9800000000
const PLATFORM_FEE: coins = 200000000
const REFUND_TO_BUYER: coins = 9900000000
const REFUND_FEE: coins = 100000000

struct TestContext {
    escrow: TonNativeEscrow
    buyer: Treasury
    seller: Treasury
    arbitrator: Treasury
    treasury: Treasury
    outsider: Treasury
}

fun setupEscrow(dealId: uint256 = 101): TestContext {
    testing.setNow(TEST_NOW);

    val buyer = testing.treasury("buyer");
    val seller = testing.treasury("seller");
    val arbitrator = testing.treasury("arbitrator");
    val treasury = testing.treasury("treasury");
    val outsider = testing.treasury("outsider");

    val rolesTail = RolesTail {
        arbitrator: arbitrator.address,
        treasury: treasury.address,
    };
    val roles = Roles {
        buyer: buyer.address,
        seller: seller.address,
        tail: rolesTail.toCell(),
    };
    val economics = Economics {
        buyerTotal: BUYER_TOTAL,
        sellerPayout: SELLER_PAYOUT,
        platformFee: PLATFORM_FEE,
        refundToBuyer: REFUND_TO_BUYER,
        refundFee: REFUND_FEE,
    };
    val config = EscrowConfig {
        dealId,
        termsHash: 0x1111,
        quoteHash: 0x2222,
        fundingDeadline: TEST_NOW + 100,
        deliveryDeadline: TEST_NOW + 200,
        confirmationDeadline: TEST_NOW + 300,
        roles: roles.toCell(),
        economics: economics.toCell(),
    };
    val escrow = TonNativeEscrow.fromStorage(Storage {
        status: STATUS_AWAITING_FUNDING,
        fundedAmount: 0,
        lastQueryId: 0,
        config: config.toCell(),
    });

    val deploy = escrow.deploy(outsider.address, { value: ton("0.3"), bounce: false });
    expect(deploy).toHaveSuccessfulDeploy({ to: escrow.address });

    return TestContext { escrow, buyer, seller, arbitrator, treasury, outsider };
}

fun baseConfig(ctx: TestContext, dealId: uint256): EscrowConfig {
    val rolesTail = RolesTail {
        arbitrator: ctx.arbitrator.address,
        treasury: ctx.treasury.address,
    };
    val roles = Roles {
        buyer: ctx.buyer.address,
        seller: ctx.seller.address,
        tail: rolesTail.toCell(),
    };
    val economics = Economics {
        buyerTotal: BUYER_TOTAL,
        sellerPayout: SELLER_PAYOUT,
        platformFee: PLATFORM_FEE,
        refundToBuyer: REFUND_TO_BUYER,
        refundFee: REFUND_FEE,
    };
    return EscrowConfig {
        dealId,
        termsHash: 0x1111,
        quoteHash: 0x2222,
        fundingDeadline: TEST_NOW + 100,
        deliveryDeadline: TEST_NOW + 200,
        confirmationDeadline: TEST_NOW + 300,
        roles: roles.toCell(),
        economics: economics.toCell(),
    };
}

fun escrowFromConfig(
    config: EscrowConfig,
    status: uint8 = STATUS_AWAITING_FUNDING,
    fundedAmount: coins = 0,
): TonNativeEscrow {
    return TonNativeEscrow.fromStorage(Storage {
        status,
        fundedAmount,
        lastQueryId: 0,
        config: config.toCell(),
    });
}

fun expectInvalidConfig(ctx: TestContext, config: EscrowConfig) {
    val candidate = escrowFromConfig(config);
    val result = candidate.deploy(ctx.outsider.address, { value: ton("0.3"), bounce: false });
    expect(result).toHaveFailedTx({
        from: ctx.outsider.address,
        to: candidate.address,
        exitCode: ERROR_INVALID_CONFIG,
    });
}

get fun `test native TON happy path conserves seller payout and platform fee`() {
    val ctx = setupEscrow();

    val funded = ctx
        .escrow
        .sendFund(ctx.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    expect(funded).toHaveSuccessfulTx<Fund>({ from: ctx.buyer.address, to: ctx.escrow.address });
    expect(ctx.escrow.getStatus()).toEqual(STATUS_FUNDED);

    val delivered = ctx
        .escrow
        .sendMarkDelivered(ctx.seller.address, 2, { value: ton("0.08"), bounce: false });
    expect(delivered).toHaveSuccessfulTx<MarkDelivered>({
        from: ctx.seller.address,
        to: ctx.escrow.address,
    });
    expect(ctx.escrow.getStatus()).toEqual(STATUS_DELIVERED);

    val released = ctx
        .escrow
        .sendRelease(ctx.buyer.address, 3, { value: ton("0.08"), bounce: false });
    expect(released).toHaveSuccessfulTx<PayoutNotification>({
        from: ctx.escrow.address,
        to: ctx.seller.address,
        value: SELLER_PAYOUT,
        bounce: false,
    });
    expect(released).toHaveSuccessfulTx<PayoutNotification>({
        from: ctx.escrow.address,
        to: ctx.treasury.address,
        value: PLATFORM_FEE,
        bounce: false,
    });
    expect(ctx.escrow.getStatus()).toEqual(STATUS_RELEASED);
}

get fun `test native TON rejects unauthorized funding without state mutation`() {
    val ctx = setupEscrow();

    val result = ctx
        .escrow
        .sendFund(ctx.outsider.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    expect(result).toHaveFailedTx<Fund>({
        from: ctx.outsider.address,
        to: ctx.escrow.address,
        exitCode: ERROR_UNAUTHORIZED,
    });
    expect(ctx.escrow.getStatus()).toEqual(STATUS_AWAITING_FUNDING);
}

get fun `test native TON seller timeout refunds immutable buyer`() {
    val ctx = setupEscrow();

    ctx.escrow.sendFund(ctx.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    testing.setNow(TEST_NOW + 201);

    val refunded = ctx
        .escrow
        .sendRefundAfterSellerTimeout(
            ctx.outsider.address,
            2,
            { value: ton("0.08"), bounce: false },
        );
    expect(refunded).toHaveSuccessfulTx<PayoutNotification>({
        from: ctx.escrow.address,
        to: ctx.buyer.address,
        value: REFUND_TO_BUYER,
    });
    expect(refunded).toHaveSuccessfulTx<PayoutNotification>({
        from: ctx.escrow.address,
        to: ctx.treasury.address,
        value: REFUND_FEE,
    });
    expect(ctx.escrow.getStatus()).toEqual(STATUS_REFUNDED);
}

get fun `test native TON enforces every immutable configuration boundary`() {
    val ctx = setupEscrow(1000);

    var invalid = baseConfig(ctx, 0);
    expectInvalidConfig(ctx, invalid);

    invalid = baseConfig(ctx, 1002);
    invalid.termsHash = 0;
    expectInvalidConfig(ctx, invalid);

    invalid = baseConfig(ctx, 1003);
    invalid.quoteHash = 0;
    expectInvalidConfig(ctx, invalid);

    invalid = baseConfig(ctx, 1004);
    invalid.deliveryDeadline = invalid.fundingDeadline;
    expectInvalidConfig(ctx, invalid);

    invalid = baseConfig(ctx, 1005);
    invalid.confirmationDeadline = invalid.deliveryDeadline;
    expectInvalidConfig(ctx, invalid);

    invalid = baseConfig(ctx, 1006);
    invalid.economics = Economics {
        buyerTotal: 0,
        sellerPayout: 0,
        platformFee: 0,
        refundToBuyer: 0,
        refundFee: 0,
    }.toCell();
    expectInvalidConfig(ctx, invalid);

    invalid = baseConfig(ctx, 1007);
    invalid.economics = Economics {
        buyerTotal: BUYER_TOTAL,
        sellerPayout: SELLER_PAYOUT - 1,
        platformFee: PLATFORM_FEE,
        refundToBuyer: REFUND_TO_BUYER,
        refundFee: REFUND_FEE,
    }.toCell();
    expectInvalidConfig(ctx, invalid);

    invalid = baseConfig(ctx, 1008);
    invalid.economics = Economics {
        buyerTotal: BUYER_TOTAL,
        sellerPayout: SELLER_PAYOUT,
        platformFee: PLATFORM_FEE,
        refundToBuyer: REFUND_TO_BUYER - 1,
        refundFee: REFUND_FEE,
    }.toCell();
    expectInvalidConfig(ctx, invalid);

    var roles = Roles {
        buyer: ctx.buyer.address,
        seller: ctx.buyer.address,
        tail: RolesTail {
            arbitrator: ctx.arbitrator.address,
            treasury: ctx.treasury.address,
        }.toCell(),
    };
    invalid = baseConfig(ctx, 1009);
    invalid.roles = roles.toCell();
    expectInvalidConfig(ctx, invalid);

    roles = Roles {
        buyer: ctx.buyer.address,
        seller: ctx.seller.address,
        tail: RolesTail {
            arbitrator: ctx.buyer.address,
            treasury: ctx.treasury.address,
        }.toCell(),
    };
    invalid = baseConfig(ctx, 1010);
    invalid.roles = roles.toCell();
    expectInvalidConfig(ctx, invalid);

    roles = Roles {
        buyer: ctx.buyer.address,
        seller: ctx.seller.address,
        tail: RolesTail {
            arbitrator: ctx.seller.address,
            treasury: ctx.treasury.address,
        }.toCell(),
    };
    invalid = baseConfig(ctx, 1011);
    invalid.roles = roles.toCell();
    expectInvalidConfig(ctx, invalid);

    roles = Roles {
        buyer: ctx.buyer.address,
        seller: ctx.seller.address,
        tail: RolesTail {
            arbitrator: ctx.arbitrator.address,
            treasury: ctx.buyer.address,
        }.toCell(),
    };
    invalid = baseConfig(ctx, 1012);
    invalid.roles = roles.toCell();
    expectInvalidConfig(ctx, invalid);

    roles = Roles {
        buyer: ctx.buyer.address,
        seller: ctx.seller.address,
        tail: RolesTail {
            arbitrator: ctx.arbitrator.address,
            treasury: ctx.seller.address,
        }.toCell(),
    };
    invalid = baseConfig(ctx, 1013);
    invalid.roles = roles.toCell();
    expectInvalidConfig(ctx, invalid);

    val invalidStatusConfig = baseConfig(ctx, 1014);
    val invalidStatus = escrowFromConfig(invalidStatusConfig, 7, BUYER_TOTAL);
    val invalidStatusResult = invalidStatus.deploy(
        ctx.outsider.address,
        { value: ton("0.3"), bounce: false },
    );
    expect(invalidStatusResult).toHaveFailedTx({
        from: ctx.outsider.address,
        to: invalidStatus.address,
        exitCode: ERROR_INVALID_CONFIG,
    });

    val awaitingWithFundsConfig = baseConfig(ctx, 1015);
    val awaitingWithFunds = escrowFromConfig(awaitingWithFundsConfig, STATUS_AWAITING_FUNDING, 1);
    val awaitingResult = awaitingWithFunds.deploy(
        ctx.outsider.address,
        { value: ton("0.3"), bounce: false },
    );
    expect(awaitingResult).toHaveFailedTx({
        from: ctx.outsider.address,
        to: awaitingWithFunds.address,
        exitCode: ERROR_INVALID_CONFIG,
    });

    val fundedMismatchConfig = baseConfig(ctx, 1016);
    val fundedMismatch = escrowFromConfig(fundedMismatchConfig, STATUS_FUNDED, BUYER_TOTAL - 1);
    val fundedMismatchResult = fundedMismatch.deploy(
        ctx.outsider.address,
        { value: ton("0.3"), bounce: false },
    );
    expect(fundedMismatchResult).toHaveFailedTx({
        from: ctx.outsider.address,
        to: fundedMismatch.address,
        exitCode: ERROR_INVALID_CONFIG,
    });

    val resolvedConfig = baseConfig(ctx, 1017);
    val resolved = escrowFromConfig(resolvedConfig, STATUS_RESOLVED, BUYER_TOTAL);
    val resolvedDeploy = resolved.deploy(
        ctx.outsider.address,
        { value: ton("0.3"), bounce: false },
    );
    expect(resolvedDeploy).toHaveSuccessfulDeploy({ to: resolved.address });
}

get fun `test native TON keeps funding deadline and reserve boundaries strict`() {
    val atDeadline = setupEscrow(1101);
    testing.setNow(TEST_NOW + 100);
    val exact = atDeadline
        .escrow
        .sendFund(
            atDeadline.buyer.address,
            1,
            { value: BUYER_TOTAL + MIN_OPERATIONAL_RESERVE, bounce: false },
        );
    expect(exact).toHaveSuccessfulTx<Fund>({
        from: atDeadline.buyer.address,
        to: atDeadline.escrow.address,
    });

    val tooLate = setupEscrow(1102);
    testing.setNow(TEST_NOW + 101);
    val late = tooLate
        .escrow
        .sendFund(
            tooLate.buyer.address,
            1,
            { value: BUYER_TOTAL + MIN_OPERATIONAL_RESERVE, bounce: false },
        );
    expect(late).toHaveFailedTx<Fund>({
        from: tooLate.buyer.address,
        to: tooLate.escrow.address,
        exitCode: ERROR_DEADLINE_PASSED,
    });

    testing.setNow(TEST_NOW);
    val insufficient = setupEscrow(1103);
    val underfunded = insufficient
        .escrow
        .sendFund(
            insufficient.buyer.address,
            1,
            { value: BUYER_TOTAL + MIN_OPERATIONAL_RESERVE - 1, bounce: false },
        );
    expect(underfunded).toHaveFailedTx<Fund>({
        from: insufficient.buyer.address,
        to: insufficient.escrow.address,
        exitCode: ERROR_INSUFFICIENT_VALUE,
    });
}

get fun `test native TON enforces participant roles states and deadlines`() {
    val delivery = setupEscrow(1201);
    delivery
        .escrow
        .sendFund(delivery.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    val wrongSeller = delivery
        .escrow
        .sendMarkDelivered(delivery.outsider.address, 2, { value: ton("0.08"), bounce: false });
    expect(wrongSeller).toHaveFailedTx<MarkDelivered>({ exitCode: ERROR_UNAUTHORIZED });
    testing.setNow(TEST_NOW + 201);
    val lateDelivery = delivery
        .escrow
        .sendMarkDelivered(delivery.seller.address, 2, { value: ton("0.08"), bounce: false });
    expect(lateDelivery).toHaveFailedTx<MarkDelivered>({ exitCode: ERROR_DEADLINE_PASSED });

    testing.setNow(TEST_NOW);
    val release = setupEscrow(1202);
    release
        .escrow
        .sendFund(release.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    val wrongStateRelease = release
        .escrow
        .sendRelease(release.buyer.address, 2, { value: ton("0.08"), bounce: false });
    expect(wrongStateRelease).toHaveFailedTx<Release>({ exitCode: ERROR_WRONG_STATE });
    release
        .escrow
        .sendMarkDelivered(release.seller.address, 2, { value: ton("0.08"), bounce: false });
    val wrongBuyer = release
        .escrow
        .sendRelease(release.outsider.address, 3, { value: ton("0.08"), bounce: false });
    expect(wrongBuyer).toHaveFailedTx<Release>({ exitCode: ERROR_UNAUTHORIZED });
    testing.setNow(TEST_NOW + 301);
    val lateRelease = release
        .escrow
        .sendRelease(release.buyer.address, 3, { value: ton("0.08"), bounce: false });
    expect(lateRelease).toHaveFailedTx<Release>({ exitCode: ERROR_DEADLINE_PASSED });
}

get fun `test native TON enforces dispute refund timeout and resolution guards`() {
    val dispute = setupEscrow(1301);
    dispute
        .escrow
        .sendFund(dispute.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    val outsiderDispute = dispute
        .escrow
        .sendOpenDispute(dispute.outsider.address, 2, { value: ton("0.08"), bounce: false });
    expect(outsiderDispute).toHaveFailedTx<OpenDispute>({ exitCode: ERROR_UNAUTHORIZED });
    dispute
        .escrow
        .sendOpenDispute(dispute.seller.address, 2, { value: ton("0.08"), bounce: false });
    val outsiderResolve = dispute
        .escrow
        .sendResolve(
            dispute.outsider.address,
            3,
            0,
            SELLER_PAYOUT,
            { value: ton("0.08"), bounce: false },
        );
    expect(outsiderResolve).toHaveFailedTx<Resolve>({ exitCode: ERROR_UNAUTHORIZED });
    val invalidAward = dispute
        .escrow
        .sendResolve(
            dispute.arbitrator.address,
            3,
            0,
            SELLER_PAYOUT - 1,
            { value: ton("0.08"), bounce: false },
        );
    expect(invalidAward).toHaveFailedTx<Resolve>({ exitCode: ERROR_INVALID_AWARD });

    val refund = setupEscrow(1302);
    refund
        .escrow
        .sendFund(refund.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    val outsiderRefund = refund
        .escrow
        .sendRefundBuyer(refund.outsider.address, 2, { value: ton("0.08"), bounce: false });
    expect(outsiderRefund).toHaveFailedTx<RefundBuyer>({ exitCode: ERROR_UNAUTHORIZED });
    val earlyTimeout = refund
        .escrow
        .sendRefundAfterSellerTimeout(
            refund.outsider.address,
            2,
            { value: ton("0.08"), bounce: false },
        );
    expect(earlyTimeout).toHaveFailedTx<RefundAfterSellerTimeout>({
        exitCode: ERROR_DEADLINE_NOT_REACHED,
    });
    testing.setNow(TEST_NOW + 200);
    val atTimeoutBoundary = refund
        .escrow
        .sendRefundAfterSellerTimeout(
            refund.outsider.address,
            2,
            { value: ton("0.08"), bounce: false },
        );
    expect(atTimeoutBoundary).toHaveFailedTx<RefundAfterSellerTimeout>({
        exitCode: ERROR_DEADLINE_NOT_REACHED,
    });
}

get fun `test native TON rejects replay wrong states and unknown messages`() {
    val ctx = setupEscrow(1401);
    ctx.escrow.sendFund(ctx.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    val fundReplay = ctx
        .escrow
        .sendFund(ctx.buyer.address, 2, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    expect(fundReplay).toHaveFailedTx<Fund>({ exitCode: ERROR_WRONG_STATE });

    val awaiting = setupEscrow(1402);
    val earlyDelivery = awaiting
        .escrow
        .sendMarkDelivered(awaiting.seller.address, 1, { value: ton("0.08"), bounce: false });
    expect(earlyDelivery).toHaveFailedTx<MarkDelivered>({ exitCode: ERROR_WRONG_STATE });
    val earlyDispute = awaiting
        .escrow
        .sendOpenDispute(awaiting.buyer.address, 1, { value: ton("0.08"), bounce: false });
    expect(earlyDispute).toHaveFailedTx<OpenDispute>({ exitCode: ERROR_WRONG_STATE });
    val earlyResolve = awaiting
        .escrow
        .sendResolve(
            awaiting.arbitrator.address,
            1,
            0,
            SELLER_PAYOUT,
            { value: ton("0.08"), bounce: false },
        );
    expect(earlyResolve).toHaveFailedTx<Resolve>({ exitCode: ERROR_WRONG_STATE });

    val unknownBody = beginCell().storeUint(0x11223344, 32).storeUint(0, 64).endCell();
    val unknown = awaiting
        .escrow
        .sendAny(awaiting.outsider.address, unknownBody, { value: ton("0.08"), bounce: false });
    expect(unknown).toHaveFailedTx({ exitCode: ERROR_UNKNOWN_MESSAGE });
}

get fun `test native TON persists voluntary refund and strict buyer-timeout release`() {
    val refund = setupEscrow(1501);
    refund
        .escrow
        .sendFund(refund.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    val refunded = refund
        .escrow
        .sendRefundBuyer(refund.seller.address, 2, { value: ton("0.08"), bounce: false });
    expect(refunded).toHaveSuccessfulTx<RefundBuyer>({
        from: refund.seller.address,
        to: refund.escrow.address,
    });
    expect(refund.escrow.getStatus()).toEqual(STATUS_REFUNDED);

    val timeout = setupEscrow(1502);
    timeout
        .escrow
        .sendFund(timeout.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    timeout
        .escrow
        .sendMarkDelivered(timeout.seller.address, 2, { value: ton("0.08"), bounce: false });
    testing.setNow(TEST_NOW + 300);
    val atBoundary = timeout
        .escrow
        .sendReleaseAfterBuyerTimeout(
            timeout.outsider.address,
            3,
            { value: ton("0.08"), bounce: false },
        );
    expect(atBoundary).toHaveFailedTx<ReleaseAfterBuyerTimeout>({
        exitCode: ERROR_DEADLINE_NOT_REACHED,
    });
    testing.setNow(TEST_NOW + 301);
    val released = timeout
        .escrow
        .sendReleaseAfterBuyerTimeout(
            timeout.outsider.address,
            3,
            { value: ton("0.08"), bounce: false },
        );
    expect(released).toHaveSuccessfulTx<ReleaseAfterBuyerTimeout>({
        from: timeout.outsider.address,
        to: timeout.escrow.address,
    });
    expect(timeout.escrow.getStatus()).toEqual(STATUS_RELEASED);
}

get fun `test native TON accepts delivery and buyer release at exact deadlines`() {
    val ctx = setupEscrow(1601);
    ctx.escrow.sendFund(ctx.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });

    testing.setNow(TEST_NOW + 200);
    val delivered = ctx
        .escrow
        .sendMarkDelivered(ctx.seller.address, 2, { value: ton("0.08"), bounce: false });
    expect(delivered).toHaveSuccessfulTx<MarkDelivered>({
        from: ctx.seller.address,
        to: ctx.escrow.address,
    });
    expect(ctx.escrow.getStatus()).toEqual(STATUS_DELIVERED);

    testing.setNow(TEST_NOW + 300);
    val released = ctx
        .escrow
        .sendRelease(ctx.buyer.address, 3, { value: ton("0.08"), bounce: false });
    expect(released).toHaveSuccessfulTx<Release>({
        from: ctx.buyer.address,
        to: ctx.escrow.address,
    });
    expect(ctx.escrow.getStatus()).toEqual(STATUS_RELEASED);
}

get fun `test native TON selects the strict dispute deadline for each eligible state`() {
    val fundedAtBoundary = setupEscrow(1701);
    fundedAtBoundary
        .escrow
        .sendFund(
            fundedAtBoundary.buyer.address,
            1,
            { value: BUYER_TOTAL + ton("0.3"), bounce: false },
        );
    testing.setNow(TEST_NOW + 200);
    val fundedBoundaryDispute = fundedAtBoundary
        .escrow
        .sendOpenDispute(
            fundedAtBoundary.buyer.address,
            2,
            { value: ton("0.08"), bounce: false },
        );
    expect(fundedBoundaryDispute).toHaveSuccessfulTx<OpenDispute>({
        from: fundedAtBoundary.buyer.address,
        to: fundedAtBoundary.escrow.address,
    });

    val fundedLate = setupEscrow(1702);
    fundedLate
        .escrow
        .sendFund(
            fundedLate.buyer.address,
            1,
            { value: BUYER_TOTAL + ton("0.3"), bounce: false },
        );
    testing.setNow(TEST_NOW + 201);
    val lateFundedDispute = fundedLate
        .escrow
        .sendOpenDispute(
            fundedLate.seller.address,
            2,
            { value: ton("0.08"), bounce: false },
        );
    expect(lateFundedDispute).toHaveFailedTx<OpenDispute>({
        exitCode: ERROR_DEADLINE_PASSED,
    });

    val deliveredAtBoundary = setupEscrow(1703);
    deliveredAtBoundary
        .escrow
        .sendFund(
            deliveredAtBoundary.buyer.address,
            1,
            { value: BUYER_TOTAL + ton("0.3"), bounce: false },
        );
    deliveredAtBoundary
        .escrow
        .sendMarkDelivered(
            deliveredAtBoundary.seller.address,
            2,
            { value: ton("0.08"), bounce: false },
        );
    testing.setNow(TEST_NOW + 300);
    val deliveredBoundaryDispute = deliveredAtBoundary
        .escrow
        .sendOpenDispute(
            deliveredAtBoundary.seller.address,
            3,
            { value: ton("0.08"), bounce: false },
        );
    expect(deliveredBoundaryDispute).toHaveSuccessfulTx<OpenDispute>({
        from: deliveredAtBoundary.seller.address,
        to: deliveredAtBoundary.escrow.address,
    });

    val deliveredLate = setupEscrow(1704);
    deliveredLate
        .escrow
        .sendFund(
            deliveredLate.buyer.address,
            1,
            { value: BUYER_TOTAL + ton("0.3"), bounce: false },
        );
    deliveredLate
        .escrow
        .sendMarkDelivered(
            deliveredLate.seller.address,
            2,
            { value: ton("0.08"), bounce: false },
        );
    testing.setNow(TEST_NOW + 301);
    val lateDeliveredDispute = deliveredLate
        .escrow
        .sendOpenDispute(
            deliveredLate.buyer.address,
            3,
            { value: ton("0.08"), bounce: false },
        );
    expect(lateDeliveredDispute).toHaveFailedTx<OpenDispute>({
        exitCode: ERROR_DEADLINE_PASSED,
    });
}

get fun `test native TON allows seller refund after delivery`() {
    val ctx = setupEscrow(1801);
    ctx.escrow.sendFund(ctx.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    ctx
        .escrow
        .sendMarkDelivered(
            ctx.seller.address,
            2,
            { value: ton("0.08"), bounce: false },
        );

    val refunded = ctx
        .escrow
        .sendRefundBuyer(ctx.seller.address, 3, { value: ton("0.08"), bounce: false });
    expect(refunded).toHaveSuccessfulTx<PayoutNotification>({
        from: ctx.escrow.address,
        to: ctx.buyer.address,
        value: REFUND_TO_BUYER,
    });
    expect(refunded).toHaveSuccessfulTx<PayoutNotification>({
        from: ctx.escrow.address,
        to: ctx.treasury.address,
        value: REFUND_FEE,
    });
    expect(ctx.escrow.getStatus()).toEqual(STATUS_REFUNDED);
}

get fun `test native TON rejects refunds and timeout releases from ineligible states`() {
    val disputed = setupEscrow(1901);
    disputed
        .escrow
        .sendFund(
            disputed.buyer.address,
            1,
            { value: BUYER_TOTAL + ton("0.3"), bounce: false },
        );
    disputed
        .escrow
        .sendOpenDispute(
            disputed.buyer.address,
            2,
            { value: ton("0.08"), bounce: false },
        );
    val disputedRefund = disputed
        .escrow
        .sendRefundBuyer(disputed.seller.address, 3, { value: ton("0.08"), bounce: false });
    expect(disputedRefund).toHaveFailedTx<RefundBuyer>({ exitCode: ERROR_WRONG_STATE });
    expect(disputed.escrow.getStatus()).toEqual(STATUS_DISPUTED);

    val delivered = setupEscrow(1902);
    delivered
        .escrow
        .sendFund(
            delivered.buyer.address,
            1,
            { value: BUYER_TOTAL + ton("0.3"), bounce: false },
        );
    delivered
        .escrow
        .sendMarkDelivered(
            delivered.seller.address,
            2,
            { value: ton("0.08"), bounce: false },
        );
    testing.setNow(TEST_NOW + 201);
    val deliveredSellerTimeout = delivered
        .escrow
        .sendRefundAfterSellerTimeout(
            delivered.outsider.address,
            3,
            { value: ton("0.08"), bounce: false },
        );
    expect(deliveredSellerTimeout).toHaveFailedTx<RefundAfterSellerTimeout>({
        exitCode: ERROR_WRONG_STATE,
    });
    expect(delivered.escrow.getStatus()).toEqual(STATUS_DELIVERED);

    val funded = setupEscrow(1903);
    funded
        .escrow
        .sendFund(
            funded.buyer.address,
            1,
            { value: BUYER_TOTAL + ton("0.3"), bounce: false },
        );
    testing.setNow(TEST_NOW + 301);
    val fundedBuyerTimeout = funded
        .escrow
        .sendReleaseAfterBuyerTimeout(
            funded.outsider.address,
            2,
            { value: ton("0.08"), bounce: false },
        );
    expect(fundedBuyerTimeout).toHaveFailedTx<ReleaseAfterBuyerTimeout>({
        exitCode: ERROR_WRONG_STATE,
    });
    expect(funded.escrow.getStatus()).toEqual(STATUS_FUNDED);
}

@test.fuzz({ runs: 64, seed: 424242 })
get fun `test native TON fuzzes valid award partitions`(rawBuyerAward: int) {
    val ctx = setupEscrow();
    ctx.escrow.sendFund(ctx.buyer.address, 1, { value: BUYER_TOTAL + ton("0.3"), bounce: false });
    ctx.escrow.sendOpenDispute(ctx.buyer.address, 2, { value: ton("0.08"), bounce: false });

    val distributable = BUYER_TOTAL - PLATFORM_FEE;
    val buyerAward = fuzz.bound(rawBuyerAward, 0, distributable);
    val sellerAward = distributable - buyerAward;
    val resolved = ctx
        .escrow
        .sendResolve(
            ctx.arbitrator.address,
            3,
            buyerAward,
            sellerAward,
            { value: ton("0.08"), bounce: false },
        );

    expect(resolved).toHaveSuccessfulTx<Resolve>({
        from: ctx.arbitrator.address,
        to: ctx.escrow.address,
    });
    expect(buyerAward + sellerAward + PLATFORM_FEE).toEqual(BUYER_TOTAL);
    expect(ctx.escrow.getStatus()).toEqual(STATUS_RESOLVED);
}
