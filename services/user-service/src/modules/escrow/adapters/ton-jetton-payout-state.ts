import { normalizeTonAddress } from "./ton-address";

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_ATTEMPTS_PER_LEG = 16;
const SETTLEMENT_ID = /^[a-zA-Z0-9._:-]{1,128}$/;
const TRANSACTION_ID = /^[a-zA-Z0-9._:+/-]{1,256}$/;

export type TonJettonPayoutKind = "buyer" | "seller" | "treasury";
export type TonJettonPayoutAttemptStatus =
  | "prepared"
  | "submitted"
  | "confirmed"
  | "bounced";
export type TonJettonPayoutPlanStatus =
  | "pending"
  | "in_progress"
  | "recovery_required"
  | "completed";

export interface TonJettonPayoutAttempt {
  attempt: number;
  idempotencyKey: string;
  queryId: string;
  status: TonJettonPayoutAttemptStatus;
  submissionTransactionId: string | null;
  finalTransactionId: string | null;
}

export interface TonJettonPayoutLeg {
  kind: TonJettonPayoutKind;
  destination: string;
  amountAtomic: string;
  attempts: TonJettonPayoutAttempt[];
}

export interface TonJettonPayoutPlan {
  schemaVersion: 1;
  settlementId: string;
  expectedTotalAtomic: string;
  status: TonJettonPayoutPlanStatus;
  legs: TonJettonPayoutLeg[];
}

export interface TonJettonPayoutObservation {
  kind: TonJettonPayoutKind;
  attempt: number;
  queryId: string;
  destination: string;
  amountAtomic: string;
  type: "submitted" | "confirmed" | "bounced";
  transactionId: string;
}

export class TonJettonPayoutStateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TonJettonPayoutStateError";
  }
}

/** Build an immutable, deterministic set of positive Jetton payout legs. */
export function createTonJettonPayoutPlan(input: {
  settlementId: string;
  expectedTotalAtomic: string;
  legs: Array<{
    kind: TonJettonPayoutKind;
    destination: string;
    amountAtomic: string;
  }>;
}): TonJettonPayoutPlan {
  if (!SETTLEMENT_ID.test(input.settlementId)) {
    fail("INVALID_SETTLEMENT_ID", "Settlement ID is invalid");
  }
  const expectedTotal = positiveAtomic(
    input.expectedTotalAtomic,
    "INVALID_EXPECTED_TOTAL",
  );
  if (
    !Array.isArray(input.legs) ||
    input.legs.length < 1 ||
    input.legs.length > 3
  ) {
    fail("INVALID_LEG_COUNT", "A payout plan requires one to three legs");
  }

  const seenKinds = new Set<TonJettonPayoutKind>();
  let total = 0n;
  const legs: TonJettonPayoutLeg[] = [];
  for (const rawLeg of input.legs) {
    if (!isPayoutKind(rawLeg.kind) || seenKinds.has(rawLeg.kind)) {
      fail(
        "INVALID_OR_DUPLICATE_LEG",
        "Payout leg kind is invalid or duplicated",
      );
    }
    seenKinds.add(rawLeg.kind);
    const destination = normalizeTonAddress(rawLeg.destination);
    if (!destination) {
      fail("INVALID_DESTINATION", `Invalid ${rawLeg.kind} destination`);
    }
    const amount = nonNegativeAtomic(rawLeg.amountAtomic, "INVALID_LEG_AMOUNT");
    total += amount;
    if (amount > 0n) {
      legs.push({
        kind: rawLeg.kind,
        destination,
        amountAtomic: amount.toString(),
        attempts: [],
      });
    }
  }
  if (total !== expectedTotal) {
    fail(
      "PAYOUT_CONSERVATION_MISMATCH",
      "Payout legs do not conserve the expected total",
    );
  }
  if (legs.length === 0) {
    fail("EMPTY_PAYOUT", "At least one payout leg must be positive");
  }

  legs.sort((left, right) => payoutOrder(left.kind) - payoutOrder(right.kind));
  return {
    schemaVersion: 1,
    settlementId: input.settlementId,
    expectedTotalAtomic: expectedTotal.toString(),
    status: "pending",
    legs,
  };
}

/**
 * Allocate a fresh uint64 query ID for an initial payout or a bounced-leg
 * retry. Query IDs are never reused anywhere in the same settlement plan.
 */
export function prepareTonJettonPayoutAttempt(
  inputPlan: TonJettonPayoutPlan,
  kind: TonJettonPayoutKind,
  queryId: string,
): TonJettonPayoutPlan {
  const plan = validatedClone(inputPlan);
  const query = uint64(queryId, "INVALID_QUERY_ID");
  const leg = requireLeg(plan, kind);
  const latest = leg.attempts.at(-1);

  if (latest?.status === "prepared" && latest.queryId === query.toString()) {
    return plan;
  }
  if (latest && latest.status !== "bounced") {
    fail(
      "LEG_NOT_RETRYABLE",
      `${kind} payout is not eligible for a new attempt`,
    );
  }
  if (leg.attempts.length >= MAX_ATTEMPTS_PER_LEG) {
    fail("ATTEMPT_LIMIT_REACHED", `${kind} payout exceeded its retry limit`);
  }
  if (
    plan.legs.some((candidate) =>
      candidate.attempts.some(
        (attempt) => attempt.queryId === query.toString(),
      ),
    )
  ) {
    fail("QUERY_ID_REUSED", "Jetton payout query ID was already allocated");
  }

  const attemptNumber = leg.attempts.length + 1;
  leg.attempts.push({
    attempt: attemptNumber,
    idempotencyKey: `${plan.settlementId}:${kind}:${attemptNumber}`,
    queryId: query.toString(),
    status: "prepared",
    submissionTransactionId: null,
    finalTransactionId: null,
  });
  plan.status = deriveStatus(plan);
  return plan;
}

/** Apply an exact submitted/confirmed/bounced observation without ambiguity. */
export function applyTonJettonPayoutObservation(
  inputPlan: TonJettonPayoutPlan,
  observation: TonJettonPayoutObservation,
): TonJettonPayoutPlan {
  const plan = validatedClone(inputPlan);
  if (!TRANSACTION_ID.test(observation.transactionId)) {
    fail("INVALID_TRANSACTION_ID", "Payout transaction identity is invalid");
  }
  const leg = requireLeg(plan, observation.kind);
  const expectedDestination = normalizeTonAddress(observation.destination);
  if (
    !expectedDestination ||
    expectedDestination !== leg.destination ||
    observation.amountAtomic !== leg.amountAtomic
  ) {
    fail(
      "PAYOUT_LEG_MISMATCH",
      "Observed destination or amount does not match the plan",
    );
  }
  uint64(observation.queryId, "INVALID_QUERY_ID");
  const latest = leg.attempts.at(-1);
  if (
    !latest ||
    latest.attempt !== observation.attempt ||
    latest.queryId !== observation.queryId
  ) {
    fail(
      "STALE_OR_UNKNOWN_ATTEMPT",
      "Observation does not identify the latest payout attempt",
    );
  }

  if (observation.type === "submitted") {
    if (
      latest.status === "submitted" &&
      latest.submissionTransactionId === observation.transactionId
    ) {
      return plan;
    }
    if (latest.status !== "prepared") {
      fail(
        "INVALID_PAYOUT_TRANSITION",
        "Only a prepared payout may be submitted",
      );
    }
    latest.status = "submitted";
    latest.submissionTransactionId = observation.transactionId;
  } else if (observation.type === "confirmed") {
    if (
      latest.status === "confirmed" &&
      latest.finalTransactionId === observation.transactionId
    ) {
      return plan;
    }
    if (latest.status !== "submitted") {
      fail(
        "INVALID_PAYOUT_TRANSITION",
        "Only a submitted payout may be confirmed",
      );
    }
    latest.status = "confirmed";
    latest.finalTransactionId = observation.transactionId;
  } else if (observation.type === "bounced") {
    if (
      latest.status === "bounced" &&
      latest.finalTransactionId === observation.transactionId
    ) {
      return plan;
    }
    if (latest.status !== "submitted") {
      fail("INVALID_PAYOUT_TRANSITION", "Only a submitted payout may bounce");
    }
    latest.status = "bounced";
    latest.finalTransactionId = observation.transactionId;
  } else {
    fail("INVALID_OBSERVATION", "Unknown payout observation type");
  }

  plan.status = deriveStatus(plan);
  return plan;
}

function validatedClone(input: TonJettonPayoutPlan): TonJettonPayoutPlan {
  if (
    input.schemaVersion !== 1 ||
    !SETTLEMENT_ID.test(input.settlementId) ||
    !Array.isArray(input.legs) ||
    input.legs.length < 1 ||
    input.legs.length > 3
  ) {
    fail("INVALID_PLAN", "Jetton payout plan is malformed");
  }
  const plan: TonJettonPayoutPlan = {
    ...input,
    legs: input.legs.map((leg) => ({
      ...leg,
      attempts: leg.attempts.map((attempt) => ({ ...attempt })),
    })),
  };
  const total = plan.legs.reduce(
    (sum, leg) => sum + positiveAtomic(leg.amountAtomic, "INVALID_PLAN"),
    0n,
  );
  if (total !== positiveAtomic(plan.expectedTotalAtomic, "INVALID_PLAN")) {
    fail("INVALID_PLAN", "Jetton payout plan no longer conserves value");
  }
  const kinds = new Set<TonJettonPayoutKind>();
  const queryIds = new Set<string>();
  for (const leg of plan.legs) {
    const normalizedDestination = normalizeTonAddress(leg.destination);
    if (
      !isPayoutKind(leg.kind) ||
      kinds.has(leg.kind) ||
      !normalizedDestination
    ) {
      fail("INVALID_PLAN", "Jetton payout plan contains an invalid leg");
    }
    leg.destination = normalizedDestination;
    kinds.add(leg.kind);
    if (
      !Array.isArray(leg.attempts) ||
      leg.attempts.length > MAX_ATTEMPTS_PER_LEG
    ) {
      fail("INVALID_PLAN", "Jetton payout plan contains invalid attempts");
    }
    for (let index = 0; index < leg.attempts.length; index += 1) {
      const attempt = leg.attempts[index];
      uint64(attempt.queryId, "INVALID_PLAN");
      if (
        attempt.attempt !== index + 1 ||
        attempt.idempotencyKey !==
          `${plan.settlementId}:${leg.kind}:${index + 1}` ||
        queryIds.has(attempt.queryId) ||
        !["prepared", "submitted", "confirmed", "bounced"].includes(
          attempt.status,
        )
      ) {
        fail("INVALID_PLAN", "Jetton payout attempt history is inconsistent");
      }
      const isFinalAttempt = index === leg.attempts.length - 1;
      const hasSubmission =
        typeof attempt.submissionTransactionId === "string" &&
        TRANSACTION_ID.test(attempt.submissionTransactionId);
      const hasFinal =
        typeof attempt.finalTransactionId === "string" &&
        TRANSACTION_ID.test(attempt.finalTransactionId);
      if (
        (!isFinalAttempt && attempt.status !== "bounced") ||
        (attempt.status === "prepared" &&
          (attempt.submissionTransactionId !== null ||
            attempt.finalTransactionId !== null)) ||
        (attempt.status === "submitted" &&
          (!hasSubmission || attempt.finalTransactionId !== null)) ||
        ((attempt.status === "confirmed" || attempt.status === "bounced") &&
          (!hasSubmission || !hasFinal))
      ) {
        fail("INVALID_PLAN", "Jetton payout attempt evidence is inconsistent");
      }
      queryIds.add(attempt.queryId);
    }
  }
  if (input.status !== deriveStatus(plan)) {
    fail("INVALID_PLAN", "Jetton payout aggregate status is inconsistent");
  }
  return plan;
}

function deriveStatus(plan: TonJettonPayoutPlan): TonJettonPayoutPlanStatus {
  const latest = plan.legs.map((leg) => leg.attempts.at(-1)?.status ?? null);
  if (latest.every((status) => status === "confirmed")) return "completed";
  if (latest.some((status) => status === "bounced")) return "recovery_required";
  if (latest.some((status) => status !== null)) return "in_progress";
  return "pending";
}

function requireLeg(
  plan: TonJettonPayoutPlan,
  kind: TonJettonPayoutKind,
): TonJettonPayoutLeg {
  const leg = plan.legs.find((candidate) => candidate.kind === kind);
  if (!leg) fail("UNKNOWN_PAYOUT_LEG", `No positive ${kind} payout is planned`);
  return leg;
}

function positiveAtomic(value: string, code: string): bigint {
  const parsed = nonNegativeAtomic(value, code);
  if (parsed === 0n) fail(code, "Atomic amount must be positive");
  return parsed;
}

function nonNegativeAtomic(value: string, code: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    fail(code, "Atomic amount must be a canonical unsigned integer");
  return BigInt(value);
}

function uint64(value: string, code: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    fail(code, "Query ID must be a canonical unsigned integer");
  const parsed = BigInt(value);
  if (parsed > MAX_UINT64) fail(code, "Query ID exceeds uint64");
  return parsed;
}

function payoutOrder(kind: TonJettonPayoutKind): number {
  return kind === "buyer" ? 0 : kind === "seller" ? 1 : 2;
}

function isPayoutKind(value: unknown): value is TonJettonPayoutKind {
  return value === "buyer" || value === "seller" || value === "treasury";
}

function fail(code: string, message: string): never {
  throw new TonJettonPayoutStateError(code, message);
}
