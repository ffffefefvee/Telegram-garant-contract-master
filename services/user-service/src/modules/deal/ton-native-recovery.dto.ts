import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";
import { TonNetwork } from "../user/entities/ton-wallet-binding.entity";
import { TonNativeEscrowWatchStatus } from "./entities/ton-native-escrow-watch.entity";

export class TonNativeManualReviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;

  @IsOptional()
  @IsUUID()
  dealId?: string;

  @IsOptional()
  @IsEnum(TonNetwork)
  network?: TonNetwork;
}

export class TonNativeManualReviewNoteDto {
  @IsString()
  @Length(20, 1000)
  reason: string;
}

export class TonNativeRequeueEventDto extends TonNativeManualReviewNoteDto {
  /** Optimistic-concurrency token copied from the inspection response. */
  @IsString()
  @Length(1, 4000)
  expectedLastError: string;
}

export class TonNativeRejectedEventQueryDto extends TonNativeManualReviewQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  reasonCode?: string;
}

export class TonNativeWatchQueryDto extends TonNativeManualReviewQueryDto {
  @IsOptional()
  @IsEnum(TonNativeEscrowWatchStatus)
  status?: TonNativeEscrowWatchStatus;
}

export class TonNativeBackfillDto extends TonNativeManualReviewNoteDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxPages: number;
}
