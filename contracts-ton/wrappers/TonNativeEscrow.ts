import {
  Address,
  beginCell,
  Cell,
  Contract,
  ContractABI,
  contractAddress,
  ContractProvider,
  Sender,
  SendMode,
} from '@ton/core';

export const TON_NATIVE_ESCROW_STATUS = {
  AWAITING_FUNDING: 0,
  FUNDED: 1,
  DELIVERED: 2,
  DISPUTED: 3,
  RELEASED: 4,
  REFUNDED: 5,
  RESOLVED: 6,
} as const;

export const TON_NATIVE_ESCROW_OP = {
  FUND: 0x66756e64,
  MARK_DELIVERED: 0x64656c76,
  RELEASE: 0x72656c73,
  OPEN_DISPUTE: 0x64737074,
  REFUND_BUYER: 0x72656664,
  REFUND_AFTER_SELLER_TIMEOUT: 0x73746d6f,
  RELEASE_AFTER_BUYER_TIMEOUT: 0x62746d6f,
  RESOLVE: 0x72736c76,
  PAYOUT_NOTIFICATION: 0x7061796f,
} as const;

export type TonNativeEscrowConfig = {
  dealId: bigint;
  buyer: Address;
  seller: Address;
  arbitrator: Address;
  treasury: Address;
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
};

export function tonNativeEscrowConfigCell(config: TonNativeEscrowConfig): Cell {
  const rolesTail = beginCell()
    .storeAddress(config.arbitrator)
    .storeAddress(config.treasury)
    .endCell();
  const roles = beginCell()
    .storeAddress(config.buyer)
    .storeAddress(config.seller)
    .storeRef(rolesTail)
    .endCell();
  const economics = beginCell()
    .storeCoins(config.buyerTotal)
    .storeCoins(config.sellerPayout)
    .storeCoins(config.platformFee)
    .storeCoins(config.refundToBuyer)
    .storeCoins(config.refundFee)
    .endCell();

  return beginCell()
    .storeUint(config.dealId, 256)
    .storeUint(config.termsHash, 256)
    .storeUint(config.quoteHash, 256)
    .storeUint(config.fundingDeadline, 64)
    .storeUint(config.deliveryDeadline, 64)
    .storeUint(config.confirmationDeadline, 64)
    .storeRef(roles)
    .storeRef(economics)
    .endCell();
}

export function tonNativeEscrowDataCell(config: TonNativeEscrowConfig): Cell {
  return beginCell()
    .storeUint(TON_NATIVE_ESCROW_STATUS.AWAITING_FUNDING, 8)
    .storeCoins(0)
    .storeUint(0, 64)
    .storeRef(tonNativeEscrowConfigCell(config))
    .endCell();
}

type BasicSend = { value: bigint; queryId: bigint };

export class TonNativeEscrow implements Contract {
  abi: ContractABI = { name: 'TonNativeEscrow' };

  constructor(
    readonly address: Address,
    readonly init?: { code: Cell; data: Cell },
  ) {}

  static createFromAddress(address: Address) {
    return new TonNativeEscrow(address);
  }

  static createFromConfig(config: TonNativeEscrowConfig, code: Cell, workchain = 0) {
    const init = { code, data: tonNativeEscrowDataCell(config) };
    return new TonNativeEscrow(contractAddress(workchain, init), init);
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().endCell(),
    });
  }

  private async sendBasic(
    provider: ContractProvider,
    via: Sender,
    opcode: number,
    opts: BasicSend,
  ) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().storeUint(opcode, 32).storeUint(opts.queryId, 64).endCell(),
    });
  }

  sendFund(provider: ContractProvider, via: Sender, opts: BasicSend) {
    return this.sendBasic(provider, via, TON_NATIVE_ESCROW_OP.FUND, opts);
  }

  sendMarkDelivered(provider: ContractProvider, via: Sender, opts: BasicSend) {
    return this.sendBasic(provider, via, TON_NATIVE_ESCROW_OP.MARK_DELIVERED, opts);
  }

  sendRelease(provider: ContractProvider, via: Sender, opts: BasicSend) {
    return this.sendBasic(provider, via, TON_NATIVE_ESCROW_OP.RELEASE, opts);
  }

  sendOpenDispute(provider: ContractProvider, via: Sender, opts: BasicSend) {
    return this.sendBasic(provider, via, TON_NATIVE_ESCROW_OP.OPEN_DISPUTE, opts);
  }

  sendRefundBuyer(provider: ContractProvider, via: Sender, opts: BasicSend) {
    return this.sendBasic(provider, via, TON_NATIVE_ESCROW_OP.REFUND_BUYER, opts);
  }

  sendRefundAfterSellerTimeout(provider: ContractProvider, via: Sender, opts: BasicSend) {
    return this.sendBasic(provider, via, TON_NATIVE_ESCROW_OP.REFUND_AFTER_SELLER_TIMEOUT, opts);
  }

  sendReleaseAfterBuyerTimeout(provider: ContractProvider, via: Sender, opts: BasicSend) {
    return this.sendBasic(provider, via, TON_NATIVE_ESCROW_OP.RELEASE_AFTER_BUYER_TIMEOUT, opts);
  }

  async sendResolve(
    provider: ContractProvider,
    via: Sender,
    opts: BasicSend & { buyerAward: bigint; sellerAward: bigint },
  ) {
    await provider.internal(via, {
      value: opts.value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell()
        .storeUint(TON_NATIVE_ESCROW_OP.RESOLVE, 32)
        .storeUint(opts.queryId, 64)
        .storeCoins(opts.buyerAward)
        .storeCoins(opts.sellerAward)
        .endCell(),
    });
  }

  async sendRaw(provider: ContractProvider, via: Sender, value: bigint, body: Cell) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body,
    });
  }

  async getStatus(provider: ContractProvider) {
    return (await provider.get('getStatus', [])).stack.readNumber();
  }

  async getFundedAmount(provider: ContractProvider) {
    return (await provider.get('getFundedAmount', [])).stack.readBigNumber();
  }

  async getLastQueryId(provider: ContractProvider) {
    return (await provider.get('getLastQueryId', [])).stack.readBigNumber();
  }

  async getConfigHash(provider: ContractProvider) {
    return (await provider.get('getConfigHash', [])).stack.readBigNumber();
  }
}
