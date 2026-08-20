import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  ClientChannel,
  DealStatus,
  SettlementAsset,
  SettlementNetwork,
} from "./enums/deal.enum";

export interface SettlementSelection {
  network: SettlementNetwork;
  chainId: string;
  asset: SettlementAsset;
}

const ASSETS_BY_NETWORK: Record<
  SettlementNetwork,
  ReadonlySet<SettlementAsset>
> = {
  [SettlementNetwork.TON]: new Set([
    SettlementAsset.TON_USDT,
    SettlementAsset.TON_NATIVE,
  ]),
  [SettlementNetwork.POLYGON]: new Set([SettlementAsset.POLYGON_USDT]),
};

/**
 * Validate only stable product invariants here. Token address allowlists and
 * adapter readiness are environment-specific and belong to chain adapters.
 */
export function validateSettlementSelection(
  selection: SettlementSelection,
  channel: ClientChannel,
): SettlementSelection {
  if (
    !selection ||
    !selection.network ||
    !selection.chainId ||
    !selection.asset
  ) {
    throw new BadRequestException(
      "settlement.network, settlement.chainId and settlement.asset are required",
    );
  }

  if (
    channel === ClientChannel.TELEGRAM_MINI_APP &&
    selection.network !== SettlementNetwork.TON
  ) {
    throw new BadRequestException(
      "Polygon settlement is available on the website, not in Telegram Mini App",
    );
  }

  if (!ASSETS_BY_NETWORK[selection.network]?.has(selection.asset)) {
    throw new BadRequestException(
      `Asset ${selection.asset} is not supported on ${selection.network}`,
    );
  }

  const chainId = selection.chainId.trim();
  if (!chainId || chainId.length > 64) {
    throw new BadRequestException("Invalid settlement chainId");
  }

  return { ...selection, chainId };
}

export function settlementSelectionChanged(
  current: Pick<SettlementSelection, "network" | "chainId" | "asset">,
  next: SettlementSelection,
): boolean {
  return (
    current.network !== next.network ||
    current.chainId !== next.chainId ||
    current.asset !== next.asset
  );
}

export function assertSettlementCanChange(input: {
  status: DealStatus;
  paidAt?: Date | null;
  fundedAt?: Date | null;
}): void {
  if (
    input.paidAt ||
    input.fundedAt ||
    ![DealStatus.DRAFT, DealStatus.PENDING_ACCEPTANCE].includes(input.status)
  ) {
    throw new ConflictException(
      "Settlement network cannot change after funding",
    );
  }
}
