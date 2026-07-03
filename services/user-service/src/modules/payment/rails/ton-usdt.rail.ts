import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Deal } from '../../deal/entities/deal.entity';
import { EscrowService } from '../../escrow/escrow.service';
import { RelayService } from '../../blockchain/relay.service';
import { Payment } from '../entities/payment.entity';
import { PaymentMethod } from '../enums/payment.enum';
import { RailInvoice } from './payment-rail.types';
import { TonApiService, TON_USDT_DECIMALS } from './ton-api.service';
import {
  BaseTonRail,
  TonInvoiceBuildArgs,
  TonRailProgress,
} from './ton-rail.base';
import { TonFundingLockService } from './ton-funding-lock.service';

const USDT_DECIMALS = 6;

/**
 * USDT-TON rail (Stage 2).
 *
 * The buyer sends USDT in the TON network (from @wallet inside Telegram or
 * any TON wallet — works in RU/BY) to the platform's TON wallet with the
 * payment memo in the transfer comment. A tonapi watcher detects the
 * transfer; the relay then funds the deal's Polygon escrow clone from its
 * USDT float (`forwardAndFund`). See `BaseTonRail` for the shared flow and
 * float policy.
 *
 * 1 USDT-TON = 1 USDT-Polygon, so no conversion is involved — the required
 * amount equals the deal amount + buyer fee.
 */
@Injectable()
export class TonUsdtRail extends BaseTonRail {
  readonly method = PaymentMethod.CRYPTO_TON;
  readonly label = 'USDT (TON) — через @wallet';

  protected readonly logger = new Logger(TonUsdtRail.name);

  constructor(
    @InjectRepository(Deal)
    dealRepository: Repository<Deal>,
    escrow: EscrowService,
    relay: RelayService,
    tonApi: TonApiService,
    config: ConfigService,
    fundingLock: TonFundingLockService,
  ) {
    super(dealRepository, escrow, relay, tonApi, config, fundingLock);
  }

  protected async buildInvoice(args: TonInvoiceBuildArgs): Promise<RailInvoice> {
    const requiredAmount = ethers.formatUnits(args.requiredWei, USDT_DECIMALS);
    return {
      depositAddress: this.tonApi.getWalletAddress(),
      escrowAddress: args.escrowAddress,
      network: 'ton',
      asset: 'USDT',
      requiredAmount,
      memo: args.memo,
      expiresAt: new Date(args.fundingDeadline * 1000),
      metadata: {
        rail: 'ton_usdt',
        memo: args.memo,
        requiredWei: args.requiredWei.toString(),
        fundingDeadline: args.fundingDeadline,
        jettonMaster: this.tonApi.getJettonMaster(),
      },
    };
  }

  protected async measureProgress(
    _payment: Payment,
    memo: string,
    sinceUnix: number,
    requiredWei: bigint,
  ): Promise<TonRailProgress> {
    const incoming = await this.tonApi.findIncomingUsdtByMemo(memo, sinceUnix);

    // Polygon USDT and TON USDT both use 6 decimals; the formal conversion
    // keeps this correct even if one of the constants ever changes.
    const requiredUnits = ethers.parseUnits(
      ethers.formatUnits(requiredWei, USDT_DECIMALS),
      TON_USDT_DECIMALS,
    );

    return {
      requiredUnits,
      receivedUnits: incoming.receivedUnits,
      lastTxHash: incoming.lastTxHash,
    };
  }

  protected unitsToUsdt(_payment: Payment, units: bigint): number {
    return Number(ethers.formatUnits(units, TON_USDT_DECIMALS));
  }
}
