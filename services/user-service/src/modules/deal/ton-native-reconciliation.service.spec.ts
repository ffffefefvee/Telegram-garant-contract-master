import { Address, beginCell, Dictionary, storeTransaction } from "@ton/ton";
import { ConfigService } from "@nestjs/config";
import { TonNativeChainEvent } from "./entities/ton-native-chain-event.entity";
import {
  TonNativeReconciliationError,
  TonNativeReconciliationService,
} from "./ton-native-reconciliation.service";

describe("TonNativeReconciliationService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function fixture() {
    const source = Address.parseRaw(`0:${"11".repeat(32)}`);
    const account = Address.parseRaw(`0:${"22".repeat(32)}`);
    const body = beginCell()
      .storeUint(0x66756e64, 32)
      .storeUint(42, 64)
      .endCell();
    const code = beginCell().storeUint(1, 1).endCell();
    const data = beginCell().storeUint(2, 2).endCell();
    const postStateHash = Buffer.alloc(32, 0x77);
    const transactionLike = {
      address: BigInt(`0x${"22".repeat(32)}`),
      lt: 123n,
      prevTransactionHash: 0n,
      prevTransactionLt: 0n,
      now: 1_900_000_000,
      outMessagesCount: 0,
      oldStatus: "active",
      endStatus: "active",
      inMessage: {
        info: {
          type: "internal",
          ihrDisabled: true,
          bounce: false,
          bounced: false,
          src: source,
          dest: account,
          value: { coins: 1_700_000_000n },
          ihrFee: 0n,
          forwardFee: 0n,
          createdLt: 122n,
          createdAt: 1_900_000_000,
        },
        body,
      },
      outMessages: Dictionary.empty(),
      totalFees: { coins: 0n },
      stateUpdate: {
        oldHash: Buffer.alloc(32, 0x66),
        newHash: postStateHash,
      },
      description: {
        type: "generic",
        creditFirst: false,
        computePhase: { type: "skipped", reason: "no-state" },
        aborted: false,
        destroyed: false,
      },
    };
    const transaction = beginCell()
      .store(storeTransaction(transactionLike as any))
      .endCell();
    const transactionHash = transaction.hash().toString("hex");
    const event = Object.assign(new TonNativeChainEvent(), {
      id: "event-1",
      accountAddress: account.toRawString(),
      transactionLt: "123",
      transactionHash,
      transactionTime: 1_900_000_000,
      sourceAddress: source.toRawString(),
      valueAtomic: "1700000000",
      payloadHash: body.hash().toString("hex"),
      postStateHash: postStateHash.toString("hex"),
      postCodeHash: code.hash().toString("hex"),
      postDataHash: data.hash().toString("hex"),
      reconciledAt: null,
      reconciliationEvidence: null,
    });
    return { event, transaction, code, data };
  }

  function service(required = "true") {
    const values: Record<string, string> = {
      TON_NATIVE_RECONCILIATION_REQUIRED: required,
      TON_LITESERVER_V2_BASE_URL: "http://127.0.0.1:8081/api/v2",
      TON_LITESERVER_V2_SOURCE: "selfhosted-liteserver-a",
      TON_LITESERVER_V2_API_KEY: "",
    };
    return new TonNativeReconciliationService({
      get: jest.fn((key: string, fallback: string) => values[key] ?? fallback),
    } as unknown as ConfigService);
  }

  it("skips the secondary source only when reconciliation is not required", async () => {
    const { event } = fixture();
    global.fetch = jest.fn() as any;
    await expect(service("false").assertReconciled(event)).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("confirms the exact raw transaction and latest code/data commitments", async () => {
    const { event, transaction, code, data } = fixture();
    const hashBase64 = Buffer.from(event.transactionHash, "hex").toString(
      "base64",
    );
    global.fetch = jest.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const result = url.pathname.endsWith("getTransactions")
        ? [
            {
              data: transaction.toBoc().toString("base64"),
              transaction_id: { lt: "123", hash: hashBase64 },
            },
          ]
        : {
            code: code.toBoc().toString("base64"),
            data: data.toBoc().toString("base64"),
            last_transaction_id: { lt: "123", hash: hashBase64 },
          };
      return { ok: true, json: async () => ({ ok: true, result }) } as Response;
    }) as any;

    await expect(service().assertReconciled(event)).resolves.toMatchObject({
      source: "selfhosted-liteserver-a",
      transactionHash: event.transactionHash,
      postStateHash: event.postStateHash,
    });
  });

  it("fails terminally when the independent account state disagrees", async () => {
    const { event, transaction, code } = fixture();
    const hashBase64 = Buffer.from(event.transactionHash, "hex").toString(
      "base64",
    );
    const wrongData = beginCell().storeUint(3, 2).endCell();
    global.fetch = jest.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const result = url.pathname.endsWith("getTransactions")
        ? [
            {
              data: transaction.toBoc().toString("base64"),
              transaction_id: { lt: "123", hash: hashBase64 },
            },
          ]
        : {
            code: code.toBoc().toString("base64"),
            data: wrongData.toBoc().toString("base64"),
            last_transaction_id: { lt: "123", hash: hashBase64 },
          };
      return { ok: true, json: async () => ({ ok: true, result }) } as Response;
    }) as any;

    await expect(service().assertReconciled(event)).rejects.toBeInstanceOf(
      TonNativeReconciliationError,
    );
  });

  it("rejects TON Center itself as the allegedly independent source", async () => {
    const { event } = fixture();
    const config = {
      get: jest.fn((key: string, fallback: string) =>
        key === "TON_NATIVE_RECONCILIATION_REQUIRED"
          ? "true"
          : key === "TON_LITESERVER_V2_BASE_URL"
            ? "https://toncenter.com/api/v2"
            : key === "TON_LITESERVER_V2_SOURCE"
              ? "not-independent"
              : fallback,
      ),
    } as unknown as ConfigService;
    await expect(
      new TonNativeReconciliationService(config).assertReconciled(event),
    ).rejects.toThrow("SECONDARY_NOT_INDEPENDENT");
  });
});
