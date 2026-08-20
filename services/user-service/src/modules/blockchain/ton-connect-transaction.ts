import { Address, Cell, loadStateInit } from "@ton/ton";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";

export interface TonConnectMessageInput {
  address: string;
  amount: bigint;
  /** Base64 BoC containing the internal message body. */
  payload?: string;
  /** Base64 BoC containing StateInit for deploy-and-fund flows. */
  stateInit?: string;
}

export interface BuildTonConnectTransactionInput {
  network: TonNetwork;
  from: string;
  nowSeconds: number;
  ttlSeconds?: number;
  messages: readonly TonConnectMessageInput[];
}

export interface TonConnectTransactionMessage {
  address: string;
  /** Decimal nanotons, matching the TON Connect wire format. */
  amount: string;
  payload?: string;
  stateInit?: string;
}

/**
 * Network- and sender-bound wire contract returned to either client surface.
 * The Mini App and website can render different UX while signing identical
 * backend-composed messages.
 */
export interface TonConnectTransactionRequest {
  validUntil: number;
  network: TonNetwork;
  from: string;
  messages: TonConnectTransactionMessage[];
}

export function buildTonConnectTransactionRequest(
  input: BuildTonConnectTransactionInput,
): TonConnectTransactionRequest {
  if (!Object.values(TonNetwork).includes(input.network)) {
    throw new Error("Unsupported TON Connect network");
  }
  if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 0) {
    throw new Error("nowSeconds must be a non-negative safe integer");
  }
  const ttlSeconds = input.ttlSeconds ?? 300;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 600) {
    throw new Error(
      "TON Connect transaction TTL must be between 30 and 600 seconds",
    );
  }
  if (input.messages.length < 1 || input.messages.length > 4) {
    throw new Error("TON Connect transaction must contain 1 to 4 messages");
  }

  const from = parseBasechainAddress(input.from, "from");
  const messages = input.messages.map((message, index) => {
    if (message.amount <= 0n) {
      throw new Error(`TON Connect message ${index} amount must be positive`);
    }
    if (message.payload !== undefined) {
      parseBoc(message.payload, `message ${index} payload`);
    }
    if (message.stateInit !== undefined) {
      const stateInitCell = parseBoc(
        message.stateInit,
        `message ${index} StateInit`,
      );
      try {
        loadStateInit(stateInitCell.beginParse());
      } catch {
        throw new Error(`TON Connect message ${index} StateInit is invalid`);
      }
    }

    return {
      address: parseBasechainAddress(
        message.address,
        `message ${index} address`,
      ),
      amount: message.amount.toString(10),
      ...(message.payload === undefined ? {} : { payload: message.payload }),
      ...(message.stateInit === undefined
        ? {}
        : { stateInit: message.stateInit }),
    };
  });

  return {
    validUntil: input.nowSeconds + ttlSeconds,
    network: input.network,
    from,
    messages,
  };
}

function parseBasechainAddress(value: string, label: string): string {
  try {
    const address = Address.parse(value);
    if (address.workChain !== 0) throw new Error("not basechain");
    return address.toRawString().toLowerCase();
  } catch {
    throw new Error(`TON Connect ${label} is invalid`);
  }
}

function parseBoc(value: string, label: string): Cell {
  if (
    value.length === 0 ||
    value.length > 65_536 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error(`TON Connect ${label} is invalid base64`);
  }
  try {
    return Cell.fromBase64(value);
  } catch {
    throw new Error(`TON Connect ${label} is invalid BoC`);
  }
}
