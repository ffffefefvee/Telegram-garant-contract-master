import { IsEnum, IsInt, IsString, Matches, Min, ValidateIf } from "class-validator";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";

export class TonJettonCursorRewindDto {
  @IsEnum(TonNetwork) network: TonNetwork;
  @Matches(/^-?\d+:[0-9a-f]{64}$/) accountAddress: string;
  @ValidateIf((value) => value.toLt !== null)
  @Matches(/^[1-9]\d{0,19}$/) toLt: string | null;
  @ValidateIf((value) => value.toTransactionHash !== null)
  @Matches(/^[0-9a-f]{64}$/) toTransactionHash: string | null;
  @ValidateIf((value) => value.toMasterchainSeqno !== null)
  @IsInt() @Min(1) toMasterchainSeqno: number | null;
  @Matches(/^[A-Z0-9_]{3,64}$/) reasonCode: string;
}

export class TonJettonRequeueDto {
  @IsString() @Matches(/^[A-Z0-9_]{3,64}$/) reasonCode: string;
}
