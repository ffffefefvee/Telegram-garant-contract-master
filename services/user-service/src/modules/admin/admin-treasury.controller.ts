import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Roles } from './decorators/roles.decorator';
import { Role } from './enums/role.enum';
import { RolesGuard } from './guards/roles.guard';
import { TreasuryClient } from '../blockchain/treasury.client';
import { Erc20Client } from '../blockchain/erc20.client';
import { BlockchainConfig } from '../blockchain/blockchain.config';
import { BlockchainProvider } from '../blockchain/blockchain.provider';

/**
 * Read-only treasury summary for the admin panel. All amounts are
 * returned as decimal strings of token base units (USDT has 6 decimals)
 * — JSON cannot represent bigint safely.
 *
 * When the on-chain layer is in stub mode (no RPC configured),
 * `ready=false` and all amounts are "0". The UI should show this.
 */
@Controller('admin/treasury')
@UseGuards(RolesGuard)
export class AdminTreasuryController {
  constructor(
    private readonly treasury: TreasuryClient,
    private readonly erc20: Erc20Client,
    private readonly cfg: BlockchainConfig,
    private readonly provider: BlockchainProvider,
    private readonly config: ConfigService,
  ) {}

  @Get('summary')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getSummary(): Promise<{
    ready: boolean;
    treasuryAddress: string;
    tokenAddress: string;
    decimals: number;
    main: string;
    reserve: string;
    rawTokenBalance: string;
    untracked: string;
    reserveBps: number;
    lowReserveAlert: boolean;
    lowReserveThreshold: string;
  }> {
    const ready = this.provider.isReady;
    const decimals = ready ? await this.erc20.decimals() : 6;
    const [{ main, reserve }, rawTokenBalance, reserveBps] = await Promise.all([
      this.treasury.balances(),
      ready ? this.erc20.balanceOf(this.cfg.treasuryAddress) : Promise.resolve(0n),
      this.treasury.reserveBps(),
    ]);

    // Untracked = funds physically in the treasury contract that haven't
    // been booked into main/reserve yet (i.e. waiting on reconcile()).
    const tracked = main + reserve;
    const untracked = rawTokenBalance > tracked ? rawTokenBalance - tracked : 0n;

    const lowReserveThreshold = BigInt(
      this.config.get<string>('TREASURY_LOW_RESERVE_RAW', '1000000000'),
    );
    const lowReserveAlert = ready && reserve < lowReserveThreshold;

    return {
      ready,
      treasuryAddress: this.cfg.treasuryAddress,
      tokenAddress: this.cfg.tokenAddress,
      decimals,
      main: main.toString(),
      reserve: reserve.toString(),
      rawTokenBalance: rawTokenBalance.toString(),
      untracked: untracked.toString(),
      reserveBps,
      lowReserveAlert,
      lowReserveThreshold: lowReserveThreshold.toString(),
    };
  }
}
