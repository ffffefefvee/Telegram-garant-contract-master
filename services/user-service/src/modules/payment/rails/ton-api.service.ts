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

export interface TonUsdtIncoming {
  /** Sum of all matching finalized transfers, in raw jetton units (6 dp). */
  receivedUnits: bigint;
  /** Hash of the latest matching event (proof-of-payment). */
  lastTxHash?: string;
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
    return this.sumMatchingTransfers(body.events ?? [], memo);
  }

  /** Exposed for unit tests — pure parsing, no I/O. */
  sumMatchingTransfers(events: TonapiEvent[], memo: string): TonUsdtIncoming {
    let receivedUnits = 0n;
    let lastTxHash: string | undefined;

    for (const event of events) {
      if (event.in_progress) continue; // not finalized yet
      for (const action of event.actions ?? []) {
        if (action.type !== 'JettonTransfer' || action.status !== 'ok') continue;
        const t = action.JettonTransfer;
        if (!t?.amount || !t.recipient?.address || !t.jetton?.address) continue;
        if (!this.sameAddress(t.recipient.address, this.walletRaw)) continue;
        if (!this.sameAddress(t.jetton.address, this.jettonRaw)) continue;
        if ((t.comment ?? '').trim() !== memo) continue;
        try {
          receivedUnits += BigInt(t.amount);
          lastTxHash = event.event_id;
        } catch {
          this.logger.warn(`Unparseable jetton amount in event ${event.event_id}`);
        }
      }
    }
    return { receivedUnits, lastTxHash };
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
