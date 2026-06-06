import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { Payment } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPayload } from '../auth/auth.middleware';

@Controller('payments')
export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPayment(
    @Body() data: CreatePaymentDto,
    @CurrentUser() user: UserPayload,
  ): Promise<{
    payment: Payment;
    paymentUrl?: string;
    expiresAt?: Date;
  }> {
    return this.paymentService.createPayment(data.dealId, data.amount, user.id, {
      currency: data.currency,
      description: data.description,
    });
  }

  @Get()
  async getMyPayments(
    @Query('limit', ParseIntPipe) limit: number = 20,
    @Query('offset', ParseIntPipe) offset: number = 0,
    @CurrentUser() user: UserPayload,
  ): Promise<{ payments: Payment[]; total: number }> {
    return this.paymentService.getUserPayments(user.id, limit, offset);
  }

  @Get(':id')
  async getPayment(@Param('id', ParseUUIDPipe) id: string): Promise<Payment> {
    return this.paymentService.findById(id);
  }

  @Post(':id/check')
  async checkStatus(@Param('id', ParseUUIDPipe) id: string): Promise<Payment> {
    return this.paymentService.checkPaymentStatus(id);
  }

  @Post(':id/refund')
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: UserPayload,
  ): Promise<Payment> {
    return this.paymentService.refundPayment(id, body.reason, user.id);
  }

  @Get('deal/:dealId')
  async getDealPayments(
    @Param('dealId') dealId: string,
    @CurrentUser() user: UserPayload,
  ): Promise<Payment[]> {
    const { payments } = await this.paymentService.getUserPayments(user.id, 100, 0);
    return payments.filter((p) => p.dealId === dealId);
  }
}
