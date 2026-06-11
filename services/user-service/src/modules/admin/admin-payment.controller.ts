import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Roles } from './decorators/roles.decorator';
import { Role } from './enums/role.enum';
import { RolesGuard } from './guards/roles.guard';
import { AdminService } from './admin.service';
import { PaymentService } from '../payment/payment.service';
import { TonRecoveryService } from '../payment/rails/ton-recovery.service';
import type { UnmatchedDepositStatus } from '../payment/entities/ton-unmatched-deposit.entity';

@Controller('admin/payments')
@UseGuards(RolesGuard)
export class AdminPaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly adminService: AdminService,
    private readonly tonRecovery: TonRecoveryService,
  ) {}

  @Get('stats/summary')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getPaymentStats() {
    return this.paymentService.getStats();
  }

  @Get('stuck/funding')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getStuckFunding(@Query('limit') limit: number = 50) {
    return this.paymentService.findStuckFunding(limit);
  }

  @Get()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getAllPayments(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('status') status?: string,
  ) {
    return this.paymentService.findAllForAdmin(page, limit, status);
  }

  /** Incoming TON deposits no payment claims (missing/typo'd memo). */
  @Get('ton/unmatched')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async listTonUnmatched(
    @Query('status') status?: UnmatchedDepositStatus,
    @Query('limit') limit: number = 50,
  ) {
    return this.tonRecovery.list(status, limit);
  }

  /** Credit an unmatched TON deposit to a payment → standard settlement. */
  @Post('ton/unmatched/:id/match')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async matchTonUnmatched(
    @Param('id') id: string,
    @Body('paymentId') paymentId: string,
    @Body('note') note: string | undefined,
    @Req() req: any,
  ) {
    const result = await this.tonRecovery.match(id, paymentId, req.user?.id, note);
    await this.adminService.logAction({
      adminId: req.user?.id,
      action: 'TON_DEPOSIT_MATCH',
      targetId: paymentId,
      description: `Ручной матчинг TON-депозита ${id} (${result.deposit.amountUnits} units) к платежу ${paymentId}`,
    });
    return result;
  }

  /** Mark an unmatched TON deposit as handled outside the system. */
  @Post('ton/unmatched/:id/ignore')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async ignoreTonUnmatched(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req: any,
  ) {
    const deposit = await this.tonRecovery.ignore(id, req.user?.id, reason);
    await this.adminService.logAction({
      adminId: req.user?.id,
      action: 'TON_DEPOSIT_IGNORE',
      targetId: id,
      description: `TON-депозит ${id} помечен ignored. Причина: ${reason}`,
    });
    return deposit;
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getPayment(@Param('id') id: string) {
    return this.paymentService.findById(id);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async refundPayment(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Req() req: any,
  ) {
    await this.paymentService.refundPayment(id, reason, req.user?.id);
    await this.adminService.logAction({
      adminId: req.user?.id,
      action: 'PAYMENT_REFUND',
      targetId: id,
      description: `Возврат. Причина: ${reason}`,
    });
  }

  @Get(':id/check-cryptomus')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async checkCryptomusStatus(@Param('id') id: string) {
    return this.paymentService.checkCryptomusStatus(id);
  }

}
