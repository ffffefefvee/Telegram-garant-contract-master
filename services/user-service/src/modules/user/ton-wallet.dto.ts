import { Type } from "class-transformer";
import {
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { TonNetwork } from "./entities/ton-wallet-binding.entity";

export class TonConnectAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  address: string;

  @IsIn([TonNetwork.MAINNET, TonNetwork.TESTNET])
  chain: TonNetwork;

  @IsString()
  @Matches(/^[0-9a-fA-F]{64}$/)
  publicKey: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(16_384)
  walletStateInit: string;
}

export class TonProofDomainDto {
  @IsInt()
  @Min(1)
  @Max(128)
  lengthBytes: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  value: string;
}

export class TonProofDto {
  // TON Connect's wire format permits a decimal string; the SDK commonly
  // exposes a number. Exact normalization and range checks happen in verifier.
  @IsDefined()
  timestamp: number | string;

  @IsDefined()
  @ValidateNested()
  @Type(() => TonProofDomainDto)
  domain: TonProofDomainDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  payload: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  signature: string;
}

export class VerifyTonWalletDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => TonConnectAccountDto)
  account: TonConnectAccountDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => TonProofDto)
  proof: TonProofDto;
}

export interface TonProofChallengeResponse {
  payload: string;
  expiresAt: string;
}

export interface TonWalletBindingResponse {
  address: string;
  network: TonNetwork;
  publicKey: string;
  verifiedAt: string;
}
