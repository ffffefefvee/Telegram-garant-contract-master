import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StoreStatus, StoreCategory } from '../entities/store.entity';

export class PaymentMethodDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  type: string;

  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  config?: Record<string, any>;
}

export class CategoryDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsOptional()
  description?: string;

  @IsOptional()
  icon?: string;

  @IsOptional()
  parentId?: string;

  @IsOptional()
  order?: number;
}

export class AppearanceDto {
  @IsOptional()
  @IsString()
  primaryColor?: string;

  @IsOptional()
  @IsString()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  accentColor?: string;

  @IsOptional()
  @IsString()
  fontFamily?: string;

  @IsOptional()
  @IsBoolean()
  darkMode?: boolean;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  backgroundImage?: string;
}

export class WelcomeMessageDto {
  @IsString()
  title: string;

  @IsString()
  text: string;

  @IsOptional()
  buttonText?: string;

  @IsOptional()
  buttonUrl?: string;
}

export class AutoResponseDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  keywords?: string[];

  @IsOptional()
  @IsString()
  response?: string;

  @IsOptional()
  @IsString()
  responseType?: string;
}

export class CommissionDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  buyerFee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  sellerFee?: number;

  @IsOptional()
  @IsBoolean()
  customRates?: boolean;
}

export class StoreSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => WelcomeMessageDto)
  welcomeMessage?: WelcomeMessageDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryDto)
  categories?: CategoryDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentMethodDto)
  paymentMethods?: PaymentMethodDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CommissionDto)
  commission?: CommissionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AppearanceDto)
  appearance?: AppearanceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AutoResponseDto)
  autoResponse?: AutoResponseDto;

  @IsOptional()
  @IsBoolean()
  requireVerification?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minDealAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDealAmount?: number;
}

export class CreateStoreDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsEnum(StoreCategory)
  category?: StoreCategory;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  banner?: string;

  @IsOptional()
  @IsNumber()
  templateId?: number;
}

export class UpdateStoreDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsEnum(StoreStatus)
  status?: StoreStatus;

  @IsOptional()
  @IsEnum(StoreCategory)
  category?: StoreCategory;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  banner?: string;

  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsString()
  customDomain?: string;
}

export class CreateBotDto {
  @IsString()
  storeId: string;

  @IsOptional()
  @IsString()
  telegramBotToken?: string;
}

export class UpdateBotDto {
  @IsOptional()
  @IsBoolean()
  isConfigured?: boolean;

  @IsOptional()
  @IsString()
  webhookUrl?: string;
}

export class BotSetupDto {
  @IsString()
  telegramBotToken: string;

  @IsOptional()
  @IsString()
  storeName?: string;

  @IsOptional()
  @IsString()
  welcomeMessage?: string;
}

export class ImportTemplateDto {
  @IsString()
  templateId: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class ExportStoreDto {
  @IsString()
  storeId: string;

  @IsOptional()
  @IsString()
  includeAnalytics?: string;
}

export class DuplicateStoreDto {
  @IsString()
  sourceStoreId: string;

  @IsOptional()
  @IsString()
  newName?: string;

  @IsOptional()
  @IsString()
  newSlug?: string;
}

export class StoreAnalyticsDto {
  @IsOptional()
  @IsString()
  period?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  previewImage?: string;

  @IsOptional()
  @IsArray()
  config?: any[];
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  previewImage?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  config?: any[];
}