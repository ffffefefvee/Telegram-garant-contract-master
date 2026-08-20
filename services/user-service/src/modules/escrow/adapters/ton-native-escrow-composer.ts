import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  Address,
  beginCell,
  Cell,
  contractAddress,
  storeStateInit,
} from "@ton/ton";
import { TonEscrowAdapter } from "./ton-escrow.adapter";
import { TON_NATIVE_MIN_OPERATIONAL_RESERVE } from "./ton-escrow-artifact";

export const TON_NATIVE_ESCROW_FUND_OPCODE = 0x66756e64;

export interface TonNativeEscrowCompositionInput {
  dealId: bigint;
  buyer: string;
  seller: string;
  arbitrator: string;
  treasury: string;
  termsHash: bigint;
  quoteHash: bigint;
  buyerTotal: bigint;
  sellerPayout: bigint;
  platformFee: bigint;
  refundToBuyer: bigint;
  refundFee: bigint;
  fundingDeadline: bigint;
  deliveryDeadline: bigint;
  confirmationDeadline: bigint;
  queryId: bigint;
}

export interface ComposedTonNativeEscrow {
  escrowAddress: string;
  codeHash: string;
  configHash: string;
  stateInit: string;
  payload: string;
  fundingAmount: bigint;
  operationalReserve: bigint;
}

/**
 * Encodes the exact StateInit and Fund body understood by TonNativeEscrow.
 * It accepts only already-locked atomic values and only code from the exact
 * operator-approved artifact verified by TonEscrowAdapter.
 */
@Injectable()
export class TonNativeEscrowComposer {
  constructor(private readonly adapter: TonEscrowAdapter) {}

  compose(input: TonNativeEscrowCompositionInput): ComposedTonNativeEscrow {
    const artifact = this.adapter.nativeArtifact;
    if (!artifact.verified || !artifact.bocHex || !artifact.codeHash) {
      throw new ServiceUnavailableException(
        `TON escrow artifact is not verified (${artifact.reason})`,
      );
    }

    const code = parseSingleRootCell(artifact.bocHex);
    if (code.hash().toString("hex") !== artifact.codeHash) {
      throw new ServiceUnavailableException(
        "TON escrow artifact code changed after verification",
      );
    }

    const buyer = parseBasechainAddress(input.buyer, "buyer");
    const seller = parseBasechainAddress(input.seller, "seller");
    const arbitrator = parseBasechainAddress(input.arbitrator, "arbitrator");
    const treasury = parseBasechainAddress(input.treasury, "treasury");
    assertCompositionInvariants(input, { buyer, seller, arbitrator, treasury });

    const rolesTail = beginCell()
      .storeAddress(arbitrator)
      .storeAddress(treasury)
      .endCell();
    const roles = beginCell()
      .storeAddress(buyer)
      .storeAddress(seller)
      .storeRef(rolesTail)
      .endCell();
    const economics = beginCell()
      .storeCoins(input.buyerTotal)
      .storeCoins(input.sellerPayout)
      .storeCoins(input.platformFee)
      .storeCoins(input.refundToBuyer)
      .storeCoins(input.refundFee)
      .endCell();
    const config = beginCell()
      .storeUint(input.dealId, 256)
      .storeUint(input.termsHash, 256)
      .storeUint(input.quoteHash, 256)
      .storeUint(input.fundingDeadline, 64)
      .storeUint(input.deliveryDeadline, 64)
      .storeUint(input.confirmationDeadline, 64)
      .storeRef(roles)
      .storeRef(economics)
      .endCell();
    const data = beginCell()
      .storeUint(0, 8)
      .storeCoins(0)
      .storeUint(0, 64)
      .storeRef(config)
      .endCell();
    const init = { code, data };
    const stateInit = beginCell()
      .store(storeStateInit(init))
      .endCell()
      .toBoc()
      .toString("base64");
    const payload = beginCell()
      .storeUint(TON_NATIVE_ESCROW_FUND_OPCODE, 32)
      .storeUint(input.queryId, 64)
      .endCell()
      .toBoc()
      .toString("base64");

    return {
      escrowAddress: contractAddress(0, init).toRawString().toLowerCase(),
      codeHash: artifact.codeHash,
      configHash: config.hash().toString("hex"),
      stateInit,
      payload,
      fundingAmount: input.buyerTotal + TON_NATIVE_MIN_OPERATIONAL_RESERVE,
      operationalReserve: TON_NATIVE_MIN_OPERATIONAL_RESERVE,
    };
  }
}

function assertCompositionInvariants(
  input: TonNativeEscrowCompositionInput,
  roles: Record<"buyer" | "seller" | "arbitrator" | "treasury", Address>,
): void {
  assertUint(input.dealId, 256, "dealId", false);
  assertUint(input.termsHash, 256, "termsHash", false);
  assertUint(input.quoteHash, 256, "quoteHash", false);
  assertUint(input.queryId, 64, "queryId", false);
  assertUint(input.fundingDeadline, 64, "fundingDeadline", true);
  assertUint(input.deliveryDeadline, 64, "deliveryDeadline", true);
  assertUint(input.confirmationDeadline, 64, "confirmationDeadline", true);

  if (
    input.fundingDeadline >= input.deliveryDeadline ||
    input.deliveryDeadline >= input.confirmationDeadline
  ) {
    throw new BadRequestException(
      "TON escrow deadlines are not strictly ordered",
    );
  }
  if (input.buyerTotal <= 0n) {
    throw new BadRequestException("TON escrow buyer total must be positive");
  }
  if (input.sellerPayout < 0n || input.platformFee < 0n) {
    throw new BadRequestException(
      "TON escrow release amounts cannot be negative",
    );
  }
  if (input.refundToBuyer < 0n || input.refundFee < 0n) {
    throw new BadRequestException(
      "TON escrow refund amounts cannot be negative",
    );
  }
  if (input.sellerPayout + input.platformFee !== input.buyerTotal) {
    throw new BadRequestException(
      "TON escrow release amounts do not conserve value",
    );
  }
  if (input.refundToBuyer + input.refundFee !== input.buyerTotal) {
    throw new BadRequestException(
      "TON escrow refund amounts do not conserve value",
    );
  }
  if (
    roles.buyer.equals(roles.seller) ||
    roles.buyer.equals(roles.arbitrator) ||
    roles.seller.equals(roles.arbitrator) ||
    roles.treasury.equals(roles.buyer) ||
    roles.treasury.equals(roles.seller)
  ) {
    throw new BadRequestException(
      "TON escrow role addresses are not independent",
    );
  }
}

function assertUint(
  value: bigint,
  bits: number,
  label: string,
  allowZero: boolean,
): void {
  const minimum = allowZero ? 0n : 1n;
  if (value < minimum || value >= 1n << BigInt(bits)) {
    throw new BadRequestException(`TON escrow ${label} is outside uint${bits}`);
  }
}

function parseBasechainAddress(value: string, label: string): Address {
  try {
    const address = Address.parse(value);
    if (address.workChain !== 0) throw new Error("not basechain");
    return address;
  } catch {
    throw new BadRequestException(`Invalid TON escrow ${label} address`);
  }
}

function parseSingleRootCell(bocHex: string): Cell {
  try {
    const roots = Cell.fromBoc(Buffer.from(bocHex, "hex"));
    if (roots.length !== 1) throw new Error("unexpected root count");
    return roots[0];
  } catch {
    throw new ServiceUnavailableException("Verified TON escrow BOC is invalid");
  }
}
