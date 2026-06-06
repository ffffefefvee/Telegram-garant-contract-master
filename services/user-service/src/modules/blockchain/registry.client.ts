import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { BlockchainConfig } from './blockchain.config';
import { BlockchainProvider } from './blockchain.provider';
import registryAbi from './abi/ArbitratorRegistry.json';

export enum ArbitratorLevel {
  TRAINEE = 0,
  JUNIOR = 1,
  SENIOR = 2,
  HEAD = 3,
}

export enum ArbitratorStatus {
  NONE = 0,
  ACTIVE = 1,
  PROBATION = 2,
  SUSPENDED = 3,
  TERMINATED = 4,
}

export interface ArbitratorOnChain {
  status: ArbitratorStatus;
  level: ArbitratorLevel;
  stake: bigint;
  totalResolved: bigint;
  totalSlashed: bigint;
  hiredAt: number;
  withdrawRequestAt: number;
  withdrawRequestAmount: bigint;
}

@Injectable()
export class RegistryClient {
  private readonly logger = new Logger(RegistryClient.name);
  private _readonly: ethers.Contract | null = null;

  constructor(
    private readonly cfg: BlockchainConfig,
    private readonly provider: BlockchainProvider,
  ) {}

  private read(): ethers.Contract {
    if (!this._readonly) {
      this._readonly = new ethers.Contract(this.cfg.registryAddress, registryAbi, this.provider.provider);
    }
    return this._readonly;
  }

  async getArbitrator(wallet: string): Promise<ArbitratorOnChain | null> {
    if (!this.provider.isReady || wallet === ethers.ZeroAddress) {
      return null;
    }
    const a = await this.read().getArbitrator(wallet);
    return {
      status: Number(a.status) as ArbitratorStatus,
      level: Number(a.level) as ArbitratorLevel,
      stake: a.stake as bigint,
      totalResolved: a.totalResolved as bigint,
      totalSlashed: a.totalSlashed as bigint,
      hiredAt: Number(a.hiredAt),
      withdrawRequestAt: Number(a.withdrawRequestAt),
      withdrawRequestAmount: a.withdrawRequestAmount as bigint,
    };
  }

  async isEligible(wallet: string): Promise<boolean> {
    if (!this.provider.isReady) return false;
    return (await this.read().isEligible(wallet)) as boolean;
  }

  async listArbitrators(): Promise<string[]> {
    if (!this.provider.isReady) return [];
    const list = (await this.read().getArbitratorList()) as string[];
    return list;
  }
}
