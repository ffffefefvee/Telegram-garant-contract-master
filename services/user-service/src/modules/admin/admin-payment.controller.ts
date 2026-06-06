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

@Controller('admin/payments')
@UseGuards(RolesGuard)
export class AdminPaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly adminService: AdminService,
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
