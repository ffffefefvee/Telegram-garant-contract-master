import {
  applyTonJettonPayoutObservation,
  createTonJettonPayoutPlan,
  prepareTonJettonPayoutAttempt,
  TonJettonPayoutKind,
  TonJettonPayoutObservation,
  TonJettonPayoutPlan,
  TonJettonPayoutStateError,
} from "./ton-jetton-payout-state";

const address = (digit: string) => `0:${digit.repeat(64)}`;

function plan(): TonJettonPayoutPlan {
  return createTonJettonPayoutPlan({
    settlementId: "event-1",
    expectedTotalAtomic: "1000000",
    legs: [
      { kind: "treasury", destination: address("3"), amountAtomic: "30000" },
      { kind: "seller", destination: address("2"), amountAtomic: "970000" },
      { kind: "buyer", destination: address("1"), amountAtomic: "0" },
    ],
  });
}

function observation(
  current: TonJettonPayoutPlan,
  kind: TonJettonPayoutKind,
  type: TonJettonPayoutObservation["type"],
  transactionId: string,
): TonJettonPayoutObservation {
  const leg = current.legs.find((candidate) => candidate.kind === kind)!;
  const attempt = leg.attempts.at(-1)!;
  return {
    kind,
    attempt: attempt.attempt,
    queryId: attempt.queryId,
    destination: leg.destination,
    amountAtomic: leg.amountAtomic,
    type,
    transactionId,
  };
}

function expectCode(work: () => unknown, code: string): void {
  try {
    work();
    throw new Error("Expected operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(TonJettonPayoutStateError);
    expect((error as TonJettonPayoutStateError).code).toBe(code);
  }
}

describe("TON Jetton payout plan", () => {
  it("builds deterministic positive legs and enforces exact conservation", () => {
    const result = plan();
    expect(result.status).toBe("pending");
    expect(result.legs.map((leg) => leg.kind)).toEqual(["seller", "treasury"]);
    expect(result.legs.map((leg) => leg.amountAtomic)).toEqual([
      "970000",
      "30000",
    ]);
  });

  it.each([
    ["PAYOUT_CONSERVATION_MISMATCH", "999999"],
    ["INVALID_EXPECTED_TOTAL", "0"],
  ])("rejects %s", (code, expectedTotalAtomic) => {
    expectCode(
      () =>
        createTonJettonPayoutPlan({
          settlementId: "event-1",
          expectedTotalAtomic,
          legs: [
            {
              kind: "seller",
              destination: address("2"),
              amountAtomic: "1000000",
            },
          ],
        }),
      code,
    );
  });

  it("rejects duplicate legs and malformed destinations", () => {
    expectCode(
      () =>
        createTonJettonPayoutPlan({
          settlementId: "event-1",
          expectedTotalAtomic: "2",
          legs: [
            { kind: "seller", destination: address("2"), amountAtomic: "1" },
            { kind: "seller", destination: address("3"), amountAtomic: "1" },
          ],
        }),
      "INVALID_OR_DUPLICATE_LEG",
    );
    expectCode(
      () =>
        createTonJettonPayoutPlan({
          settlementId: "event-1",
          expectedTotalAtomic: "1",
          legs: [{ kind: "seller", destination: "bad", amountAtomic: "1" }],
        }),
      "INVALID_DESTINATION",
    );
  });

  it("prepares deterministic attempts without reusing a query ID", () => {
    const first = prepareTonJettonPayoutAttempt(plan(), "seller", "10");
    const replay = prepareTonJettonPayoutAttempt(first, "seller", "10");
    expect(replay).toEqual(first);
    expect(first.legs[0].attempts[0]).toMatchObject({
      attempt: 1,
      idempotencyKey: "event-1:seller:1",
      queryId: "10",
      status: "prepared",
    });
    expectCode(
      () => prepareTonJettonPayoutAttempt(first, "treasury", "10"),
      "QUERY_ID_REUSED",
    );
    expectCode(
      () => prepareTonJettonPayoutAttempt(first, "seller", "11"),
      "LEG_NOT_RETRYABLE",
    );
  });

  it("requires uint64 query IDs", () => {
    expectCode(
      () =>
        prepareTonJettonPayoutAttempt(plan(), "seller", (1n << 64n).toString()),
      "INVALID_QUERY_ID",
    );
  });
});

describe("TON Jetton payout observations", () => {
  it("completes multiple legs only after every exact confirmation", () => {
    let current = prepareTonJettonPayoutAttempt(plan(), "seller", "10");
    current = applyTonJettonPayoutObservation(
      current,
      observation(current, "seller", "submitted", "seller-submit"),
    );
    expect(current.status).toBe("in_progress");
    current = applyTonJettonPayoutObservation(
      current,
      observation(current, "seller", "confirmed", "seller-confirm"),
    );
    expect(current.status).toBe("in_progress");

    current = prepareTonJettonPayoutAttempt(current, "treasury", "11");
    current = applyTonJettonPayoutObservation(
      current,
      observation(current, "treasury", "submitted", "treasury-submit"),
    );
    current = applyTonJettonPayoutObservation(
      current,
      observation(current, "treasury", "confirmed", "treasury-confirm"),
    );
    expect(current.status).toBe("completed");
  });

  it("is idempotent only for the exact repeated observation", () => {
    let current = prepareTonJettonPayoutAttempt(plan(), "seller", "10");
    const submitted = observation(current, "seller", "submitted", "tx-1");
    current = applyTonJettonPayoutObservation(current, submitted);
    expect(applyTonJettonPayoutObservation(current, submitted)).toEqual(
      current,
    );
    expectCode(
      () =>
        applyTonJettonPayoutObservation(current, {
          ...submitted,
          transactionId: "different-tx",
        }),
      "INVALID_PAYOUT_TRANSITION",
    );
  });

  it("requires exact destination, amount, attempt and query identity", () => {
    const current = prepareTonJettonPayoutAttempt(plan(), "seller", "10");
    const submitted = observation(current, "seller", "submitted", "tx-1");
    expectCode(
      () =>
        applyTonJettonPayoutObservation(current, {
          ...submitted,
          destination: address("9"),
        }),
      "PAYOUT_LEG_MISMATCH",
    );
    expectCode(
      () =>
        applyTonJettonPayoutObservation(current, {
          ...submitted,
          attempt: 2,
        }),
      "STALE_OR_UNKNOWN_ATTEMPT",
    );
    expectCode(
      () =>
        applyTonJettonPayoutObservation(current, {
          ...submitted,
          queryId: "11",
        }),
      "STALE_OR_UNKNOWN_ATTEMPT",
    );
  });

  it("marks a bounce for recovery and requires a fresh retry query ID", () => {
    let current = prepareTonJettonPayoutAttempt(plan(), "seller", "10");
    current = applyTonJettonPayoutObservation(
      current,
      observation(current, "seller", "submitted", "submit-1"),
    );
    current = applyTonJettonPayoutObservation(
      current,
      observation(current, "seller", "bounced", "bounce-1"),
    );
    expect(current.status).toBe("recovery_required");
    expectCode(
      () => prepareTonJettonPayoutAttempt(current, "seller", "10"),
      "QUERY_ID_REUSED",
    );

    current = prepareTonJettonPayoutAttempt(current, "seller", "12");
    expect(current.status).toBe("in_progress");
    expect(current.legs[0].attempts[1]).toMatchObject({
      attempt: 2,
      idempotencyKey: "event-1:seller:2",
      queryId: "12",
      status: "prepared",
    });
  });

  it("rejects confirm or bounce before submission", () => {
    const current = prepareTonJettonPayoutAttempt(plan(), "seller", "10");
    expectCode(
      () =>
        applyTonJettonPayoutObservation(
          current,
          observation(current, "seller", "confirmed", "confirm-early"),
        ),
      "INVALID_PAYOUT_TRANSITION",
    );
    expectCode(
      () =>
        applyTonJettonPayoutObservation(
          current,
          observation(current, "seller", "bounced", "bounce-early"),
        ),
      "INVALID_PAYOUT_TRANSITION",
    );
  });

  it("rejects a forged plan whose aggregate status or value was modified", () => {
    expectCode(
      () =>
        prepareTonJettonPayoutAttempt(
          { ...plan(), status: "completed" },
          "seller",
          "10",
        ),
      "INVALID_PLAN",
    );
    expectCode(
      () =>
        prepareTonJettonPayoutAttempt(
          {
            ...plan(),
            legs: plan().legs.map((leg, index) =>
              index === 0 ? { ...leg, amountAtomic: "1" } : leg,
            ),
          },
          "seller",
          "10",
        ),
      "INVALID_PLAN",
    );
  });

  it("rejects forged attempt evidence and impossible histories", () => {
    const prepared = prepareTonJettonPayoutAttempt(plan(), "seller", "10");
    const forgedEvidence = {
      ...prepared,
      legs: prepared.legs.map((leg) =>
        leg.kind === "seller"
          ? {
              ...leg,
              attempts: leg.attempts.map((attempt) => ({
                ...attempt,
                status: "confirmed" as const,
              })),
            }
          : leg,
      ),
      status: "in_progress" as const,
    };
    expectCode(
      () => prepareTonJettonPayoutAttempt(forgedEvidence, "seller", "11"),
      "INVALID_PLAN",
    );

    let bounced = applyTonJettonPayoutObservation(
      prepared,
      observation(prepared, "seller", "submitted", "submit-1"),
    );
    bounced = applyTonJettonPayoutObservation(
      bounced,
      observation(bounced, "seller", "bounced", "bounce-1"),
    );
    const retried = prepareTonJettonPayoutAttempt(bounced, "seller", "11");
    const impossibleHistory = {
      ...retried,
      legs: retried.legs.map((leg) =>
        leg.kind === "seller"
          ? {
              ...leg,
              attempts: leg.attempts.map((attempt, index) =>
                index === 0
                  ? { ...attempt, status: "confirmed" as const }
                  : attempt,
              ),
            }
          : leg,
      ),
    };
    expectCode(
      () => prepareTonJettonPayoutAttempt(impossibleHistory, "seller", "12"),
      "INVALID_PLAN",
    );
  });
});
