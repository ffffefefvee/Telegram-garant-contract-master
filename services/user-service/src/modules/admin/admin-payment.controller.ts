import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Roles } from './decorators/roles.decorator';
import { Role } from './enums/role.enum';
import { RolesGuard } from './guards/roles.guard';
import { PaymentService } from '../payment/payment.service';
import { TonRecoveryService } from '../payment/rails/ton-recovery.service';
import type { UnmatchedDepositStatus } from '../payment/entities/ton-unmatched-deposit.entity';
import type { VerifiedPrivilegedIdentity } from '../auth/privileged-identity.service';

@Controller('admin/payments')
@UseGuards(RolesGuard)
export class AdminPaymentController {
  constructor(
    private readonly paymentService: PaymentService,
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

  @Post('ton/unmatched/:id/match-requests')
  @Roles(Role.SUPER_ADMIN)
  async requestTonMatch(
    @Param('id') id: string,
    @Body('paymentId') paymentId: string,
    @Body('note') note: string | undefined,
    @Body('expiresInSeconds') expiresInSeconds: number | undefined,
    @Req() req: any,
  ) {
    return this.tonRecovery.requestMatch(id, paymentId, this.recoveryActor(req), note, expiresInSeconds ?? 300);
  }

  @Post('ton/unmatched/:id/ignore-requests')
  @Roles(Role.SUPER_ADMIN)
  async requestTonIgnore(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Body('expiresInSeconds') expiresInSeconds: number | undefined,
    @Req() req: any,
  ) {
    return this.tonRecovery.requestIgnore(id, this.recoveryActor(req), reason, expiresInSeconds ?? 300);
  }

  @Post('ton/unmatched/:id/recovery-requests/:requestId/approve')
  @Roles(Role.SUPER_ADMIN)
  async approveTonRecovery(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Req() req: any,
  ) {
    return this.tonRecovery.approve(id, requestId, this.recoveryActor(req));
  }

  @Post('ton/unmatched/:id/recovery-requests/:requestId/cancel')
  @Roles(Role.SUPER_ADMIN)
  async cancelTonRecovery(
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body('reason') reason: string,
    @Req() req: any,
  ) {
    return this.tonRecovery.cancel(id, requestId, this.recoveryActor(req), reason);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async getPayment(@Param('id') id: string) {
    return this.paymentService.findById(id);
  }

  @Get(':id/check-cryptomus')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async checkCryptomusStatus(@Param('id') id: string) {
    return this.paymentService.checkCryptomusStatus(id);
  }

  private recoveryActor(req: any) {
    const identity = req.privilegedIdentity as VerifiedPrivilegedIdentity | undefined;
    return { id: req.user?.id, jti: identity?.jti ?? '', sid: identity?.sid ?? '', scopes: identity?.scope ?? [] };
  }

}
