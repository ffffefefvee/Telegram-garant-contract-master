import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Canonical Tether USDT jetton master on TON mainnet.
 * https://tonviewer.com/EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs
 */
export const TON_USDT_JETTON_MAINNET =
  'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

/** USDT-TON jetton uses 6 decimals (same as Polygon USDT). */
export const TON_USDT_DECIMALS = 6;

/** Native Toncoin uses 9 decimals (nanotons). */
export const TON_DECIMALS = 9;

/** How long a fetched TON/USD rate is served from cache. */
const RATE_CACHE_TTL_MS = 60_000;

export interface TonUsdtIncoming {
  /** Sum of all matching finalized transfers, in raw jetton units (6 dp). */
  receivedUnits: bigint;
  /** Hash of the latest matching event (proof-of-payment). */
  lastTxHash?: string;
}

/** Asset of an incoming transfer to the platform wallet. */
export type TonIncomingAsset = 'USDT' | 'TON';

/** One finalized incoming transfer (USDT jetton or native TON). */
export interface TonIncomingTransfer {
  /** What arrived: USDT jetton (6 dp units) or native TON (nanotons). */
  asset: TonIncomingAsset;
  /** tonapi event id (proof-of-payment reference). */
  eventId: string;
  /** Index of the JettonTransfer action inside the event. */
  actionIndex: number;
  /** On-chain timestamp (unix seconds). */
  timestamp: number;
  /** Sender address in raw `0:hex` form as reported by tonapi. */
  sender: string;
  /** Amount in raw units: jetton units (6 dp) for USDT, nanotons for TON. */
  amountUnits: bigint;
  /** Transfer comment as sent (trimmed; empty string when absent). */
  comment: string;
}

interface TonapiJettonTransferAction {
  type: string;
  status: string;
  JettonTransfer?: {
    sender?: { address?: string };
    recipient?: { address?: string };
    amount?: string;
    comment?: string;
    jetton?: { address?: string; decimals?: number; symbol?: string };
  };
  TonTransfer?: {
    sender?: { address?: string };
    recipient?: { address?: string };
    /** Nanotons; tonapi serializes int64 as a JSON number. */
    amount?: number | string;
    comment?: string;
  };
}

interface TonapiEvent {
  event_id: string;
  timestamp: number;
  in_progress?: boolean;
  actions?: TonapiJettonTransferAction[];
}

/**
 * Thin tonapi.io v2 client for watching incoming USDT-TON jetton transfers
 * to the platform's TON wallet. Uses native fetch — no extra dependencies.
 *
 * Config:
 *  - TON_WALLET_ADDRESS   platform TON wallet (friendly EQ…/UQ… form)
 *  - TON_USDT_JETTON      jetton master (default: mainnet Tether USDT)
 *  - TONAPI_BASE_URL      default https://tonapi.io
 *  - TONAPI_KEY           optional bearer token (higher rate limits)
 */
@Injectable()
export class TonApiService {
  private readonly logger = new Logger(TonApiService.name);

  private readonly walletAddress: string;
  private readonly walletRaw: string | null;
  private readonly jettonMaster: string;
  private readonly jettonRaw: string | null;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  private cachedRate: number | null = null;
  private cachedRateAt = 0;

  constructor(private readonly config: ConfigService) {
    this.walletAddress = this.config.get<string>('TON_WALLET_ADDRESS', '');
    this.jettonMaster = this.config.get<string>(
      'TON_USDT_JETTON',
      TON_USDT_JETTON_MAINNET,
    );
    this.baseUrl = (
      this.config.get<string>('TONAPI_BASE_URL', 'https://tonapi.io') || ''
    ).replace(/\/+$/, '');
    this.apiKey = this.config.get<string>('TONAPI_KEY', '');
    this.walletRaw = TonApiService.friendlyToRaw(this.walletAddress);
    this.jettonRaw = TonApiService.friendlyToRaw(this.jettonMaster);
  }

  /** Configured and usable? (wallet address present and parseable) */
  isEnabled(): boolean {
    return !!this.walletAddress && !!this.walletRaw;
  }

  /** Platform TON wallet in user-facing friendly form. */
  getWalletAddress(): string {
    return this.walletAddress;
  }

  /** Jetton master in friendly form (for wallet deep links / docs). */
  getJettonMaster(): string {
    return this.jettonMaster;
  }

  /**
   * Sum all finalized incoming USDT jetton transfers to the platform wallet
   * whose text comment equals `memo`, no older than `sinceUnix`.
   *
   * tonapi returns addresses in raw `0:hex` form — we normalize both sides.
   */
  async findIncomingUsdtByMemo(
    memo: string,
    sinceUnix: number,
  ): Promise<TonUsdtIncoming> {
    if (!this.isEnabled()) {
      return { receivedUnits: 0n };
    }
    const events = await this.fetchEvents(sinceUnix);
    return this.sumMatchingTransfers(events, memo);
  }

  /**
   * Sum all finalized incoming NATIVE TON transfers to the platform wallet
   * whose text comment equals `memo`, no older than `sinceUnix`.
   * Returns nanotons.
   */
  async findIncomingTonByMemo(
    memo: string,
    sinceUnix: number,
  ): Promise<TonUsdtIncoming> {
    if (!this.isEnabled()) {
      return { receivedUnits: 0n };
    }
    const events = await this.fetchEvents(sinceUnix);
    let receivedUnits = 0n;
    let lastTxHash: string | undefined;
    for (const transfer of this.extractIncomingTransfers(events)) {
      if (transfer.asset !== 'TON' || transfer.comment !== memo) continue;
      receivedUnits += transfer.amountUnits;
      lastTxHash = transfer.eventId;
    }
    return { receivedUnits, lastTxHash };
  }

  /**
   * Current TON price in USD from tonapi `/v2/rates` (cached 60s).
   * Throws when the rate cannot be fetched/parsed — callers must treat a
   * missing rate as "rail unavailable", never guess a price.
   */
  async getTonUsdRate(): Promise<number> {
    const now = Date.now();
    if (this.cachedRate !== null && now - this.cachedRateAt < RATE_CACHE_TTL_MS) {
      return this.cachedRate;
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    const response = await fetch(
      `${this.baseUrl}/v2/rates?tokens=ton&currencies=usd`,
      { headers },
    );
    if (!response.ok) {
      throw new Error(
        `tonapi rates request failed: ${response.status} ${response.statusText}`,
      );
    }
    const body = (await response.json()) as {
      rates?: Record<string, { prices?: Record<string, number> }>;
    };
    const rate = body.rates?.['TON']?.prices?.['USD'];
    if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) {
      throw new Error('tonapi rates response missing TON/USD price');
    }
    this.cachedRate = rate;
    this.cachedRateAt = now;
    return rate;
  }

  /**
   * All finalized incoming transfers (USDT jetton AND native TON) to the
   * platform wallet since `sinceUnix`, regardless of comment. Used by the
   * unmatched-deposit scanner — every transfer must be attributable, not
   * only the ones whose memo we expect.
   */
  async listIncomingTransfers(
    sinceUnix: number,
  ): Promise<TonIncomingTransfer[]> {
    if (!this.isEnabled()) {
      return [];
    }
    const events = await this.fetchEvents(sinceUnix);
    return this.extractIncomingTransfers(events);
  }

  /**
   * Current balances of the platform TON wallet: native TON (nanotons) and
   * the accepted USDT jetton (6 dp units). Used by ops monitoring to warn
   * when accumulated funds await a TON→Polygon rebalance.
   */
  async getWalletBalances(): Promise<{
    tonNano: bigint;
    usdtUnits: bigint;
  } | null> {
    if (!this.isEnabled()) return null;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    const account = encodeURIComponent(this.walletAddress);

    const accountResponse = await fetch(
      `${this.baseUrl}/v2/accounts/${account}`,
      { headers },
    );
    if (!accountResponse.ok) {
      throw new Error(
        `tonapi account request failed: ${accountResponse.status} ${accountResponse.statusText}`,
      );
    }
    const accountBody = (await accountResponse.json()) as { balance?: number | string };
    const tonNano = BigInt(accountBody.balance ?? 0);

    // Jetton wallet may simply not exist yet — that's a zero balance.
    let usdtUnits = 0n;
    const jettonResponse = await fetch(
      `${this.baseUrl}/v2/accounts/${account}/jettons/${encodeURIComponent(this.jettonMaster)}`,
      { headers },
    );
    if (jettonResponse.ok) {
      const jettonBody = (await jettonResponse.json()) as { balance?: string };
      usdtUnits = BigInt(jettonBody.balance ?? '0');
    } else if (jettonResponse.status !== 404) {
      throw new Error(
        `tonapi jetton balance request failed: ${jettonResponse.status} ${jettonResponse.statusText}`,
      );
    }

    return { tonNano, usdtUnits };
  }

  private async fetchEvents(sinceUnix: number): Promise<TonapiEvent[]> {
    const url =
      `${this.baseUrl}/v2/accounts/${encodeURIComponent(this.walletAddress)}` +
      `/events?limit=100&start_date=${Math.max(0, Math.floor(sinceUnix))}`;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(
        `tonapi events request failed: ${response.status} ${response.statusText}`,
      );
    }
    const body = (await response.json()) as { events?: TonapiEvent[] };
    return body.events ?? [];
  }

  /** Exposed for unit tests — pure parsing, no I/O. */
  sumMatchingTransfers(events: TonapiEvent[], memo: string): TonUsdtIncoming {
    let receivedUnits = 0n;
    let lastTxHash: string | undefined;

    for (const transfer of this.extractIncomingTransfers(events)) {
      if (transfer.asset !== 'USDT' || transfer.comment !== memo) continue;
      receivedUnits += transfer.amountUnits;
      lastTxHash = transfer.eventId;
    }
    return { receivedUnits, lastTxHash };
  }

  /** Exposed for unit tests — pure parsing, no I/O. */
  extractIncomingTransfers(events: TonapiEvent[]): TonIncomingTransfer[] {
    const transfers: TonIncomingTransfer[] = [];

    for (const event of events) {
      if (event.in_progress) continue; // not finalized yet
      (event.actions ?? []).forEach((action, actionIndex) => {
        if (action.status !== 'ok') return;

        if (action.type === 'JettonTransfer') {
          const t = action.JettonTransfer;
          if (!t?.amount || !t.recipient?.address || !t.jetton?.address) return;
          if (!this.sameAddress(t.recipient.address, this.walletRaw)) return;
          if (!this.sameAddress(t.jetton.address, this.jettonRaw)) return;
          try {
            transfers.push({
              asset: 'USDT',
              eventId: event.event_id,
              actionIndex,
              timestamp: event.timestamp,
              sender: t.sender?.address ?? 'unknown',
              amountUnits: BigInt(t.amount),
              comment: (t.comment ?? '').trim(),
            });
          } catch {
            this.logger.warn(
              `Unparseable jetton amount in event ${event.event_id}`,
            );
          }
          return;
        }

        if (action.type === 'TonTransfer') {
          const t = action.TonTransfer;
          if (t?.amount == null || !t.recipient?.address) return;
          if (!this.sameAddress(t.recipient.address, this.walletRaw)) return;
          try {
            transfers.push({
              asset: 'TON',
              eventId: event.event_id,
              actionIndex,
              timestamp: event.timestamp,
              sender: t.sender?.address ?? 'unknown',
              amountUnits: BigInt(String(t.amount)),
              comment: (t.comment ?? '').trim(),
            });
          } catch {
            this.logger.warn(
              `Unparseable TON amount in event ${event.event_id}`,
            );
          }
        }
      });
    }
    return transfers;
  }

  private sameAddress(rawFromApi: string, ourRaw: string | null): boolean {
    if (!ourRaw) return false;
    return rawFromApi.toLowerCase() === ourRaw.toLowerCase();
  }

  /**
   * Convert a friendly base64url TON address (EQ…/UQ…/kQ…/0Q…) to raw
   * `workchain:hex` form. Returns null when unparseable. Raw input
   * (`0:abc…`) is passed through normalized.
   */
  static friendlyToRaw(address: string): string | null {
    if (!address) return null;
    const trimmed = address.trim();
    if (/^-?\d+:[0-9a-fA-F]{64}$/.test(trimmed)) {
      const [wc, hash] = trimmed.split(':');
      return `${parseInt(wc, 10)}:${hash.toLowerCase()}`;
    }
    try {
      const base64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length !== 36) return null;
      // bytes: [tag][workchain][32-byte hash][2-byte crc16]
      const workchain = bytes.readInt8(1);
      const hash = bytes.subarray(2, 34).toString('hex');
      return `${workchain}:${hash}`;
    } catch {
      return null;
    }
  }
}
