import { IsString, IsNumber, IsOptional, Min, IsEnum, IsIn } from 'class-validator';
import { PaymentMethod } from '../enums/payment.enum';

export enum PaymentNetwork {
  POLYGON = 'polygon',
  TRC20 = 'trc20',
  ERC20 = 'erc20',
  BSC = 'bsc',
  TON = 'ton',
}

export enum PaymentCurrency {
  USDT = 'USDT',
  USDC = 'USDC',
  BTC = 'BTC',
  ETH = 'ETH',
  TON = 'TON',
}

/** D6: minimum payment amount in RUB. Payments in crypto must correspond to ≥ 300 RUB. */
export const PAYMENT_MIN_AMOUNT_RUB = 300;

export class CreatePaymentDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsEnum(PaymentCurrency)
  currency: PaymentCurrency;

  @IsString()
  dealId: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PaymentNetwork)
  network?: PaymentNetwork;

  @IsOptional()
  @IsString()
  escrowAddress?: string;

  /**
   * Payment rail. Supported: 'cryptomus' (hosted checkout, default) and
   * 'crypto' (direct USDT transfer to the deal's escrow address on Polygon).
   */
  @IsOptional()
  @IsIn([PaymentMethod.CRYPTOMUS, PaymentMethod.CRYPTO, PaymentMethod.CRYPTO_TON])
  method?: PaymentMethod;
}

export class CreatePayoutDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsString()
  currency: string;

  @IsString()
  address: string;

  @IsEnum(PaymentNetwork)
  network: PaymentNetwork;

  @IsOptional()
  @IsString()
  description?: string;
}