import { IsEnum, IsString, IsOptional, IsNumber, Min, Max, IsBoolean, IsArray, ValidateNested, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { DisputeType, DisputeSide, EvidenceType, ArbitrationDecisionType, DisputeStatus } from '../entities';

/**
 * DTO для открытия спора
 */
export class OpenDisputeDto {
  @IsEnum(DisputeType)
  type: DisputeType;

  @IsEnum(DisputeSide)
  openedBy: DisputeSide;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  claimedAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  penaltyPercent?: number;
}

/**
 * DTO для ответа на спор
 */
export class RespondToDisputeDto {
  @IsString()
  response: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceIds?: string[];
}

/**
 * DTO для загрузки доказательства
 */
export class SubmitEvidenceDto {
  @IsEnum(EvidenceType)
  type: EvidenceType;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  content?: string; // Для текста или ссылок

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsString()
  fileType?: string;

  @IsOptional()
  @IsNumber()
  fileSize?: number;

  @IsOptional()
  @IsString()
  fileHash?: string;
}

/**
 * DTO для назначения арбитра
 */
export class AssignArbitratorDto {
  @IsString()
  arbitratorId: string;

  @IsOptional()
  @IsBoolean()
  isAutoAssigned?: boolean;
}

/**
 * DTO для вынесения решения
 */
export class MakeDecisionDto {
  @IsEnum(ArbitrationDecisionType)
  decisionType: ArbitrationDecisionType;

  @IsString()
  reasoning: string;

  @IsOptional()
  @IsString()
  comments?: string;

  @IsOptional()
  @IsBoolean()
  isAppealable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168) // 1 неделя
  appealPeriodHours?: number;
}

/**
 * DTO для подачи апелляции
 */
export class FileAppealDto {
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  newEvidence?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  depositAmount?: number;
}

/**
 * DTO для рассмотрения апелляции
 */
export class ReviewAppealDto {
  @IsEnum('approved' as any)
  decision: 'approved' | 'rejected';

  @IsString()
  reviewDecision: string;

  @IsOptional()
  @IsBoolean()
  refundDeposit?: boolean;
}

/**
 * DTO для изменения статуса спора
 */
export class UpdateDisputeStatusDto {
  @IsEnum(DisputeStatus)
  status: DisputeStatus;

  @IsOptional()
  @IsString()
  resolution?: string;
}

/**
 * DTO для условий сделки
 */
export class DealTermsDto {
  @IsOptional()
  @IsString()
  acceptanceCriteria?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredEvidence?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  studyPeriodHours?: number;

  @IsOptional()
  @IsString()
  customConditions?: string;

  @IsOptional()
  @IsString()
  deliveryMethod?: string;

  @IsOptional()
  @IsString()
  deliveryTimeframe?: string;

  @IsOptional()
  @IsString()
  warrantyTerms?: string;

  @IsOptional()
  @IsBoolean()
  hasWarranty?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  warrantyDays?: number;

  @IsOptional()
  @IsString()
  refundPolicy?: string;

  @IsOptional()
  @IsBoolean()
  isRefundable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  refundDays?: number;

  @IsOptional()
  @IsString()
  additionalNotes?: string;
}

/**
 * DTO для сообщения в чате арбитража
 */
export class ArbitrationChatMessageDto {
  @IsString()
  content: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}

/**
 * DTO для исполнения решения
 */
export class EnforceDecisionDto {
  @IsOptional()
  @IsString()
  comments?: string;
}

/**
 * DTO для закрытия спора
 */
export class CloseDisputeDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
