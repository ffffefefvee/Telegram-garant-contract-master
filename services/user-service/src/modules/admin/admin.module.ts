import { Module, forwardRef } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminProfile } from "./entities/admin-profile.entity";
import { AdminLog } from "./entities/admin-log.entity";
import { User } from "../user/entities/user.entity";
import { Deal } from "../deal/entities/deal.entity";
import { Payment } from "../payment/entities/payment.entity";
import { Dispute } from "../arbitration/entities/dispute.entity";
import { AdminService } from "./admin.service";
import { AdminDashboardService } from "./admin-dashboard.service";
import { AdminController } from "./admin.controller";
import { AdminDealController } from "./admin-deal.controller";
import { AdminDisputeController } from "./admin-dispute.controller";
import { AdminPaymentController } from "./admin-payment.controller";
import { AdminSettingsController } from "./admin-settings.controller";
import { AdminTreasuryController } from "./admin-treasury.controller";
import { AdminAuditController } from "./admin-audit.controller";
import { AdminOpsController } from "./admin-ops.controller";
import { AdminTonNativeRecoveryController } from "./admin-ton-native-recovery.controller";
import { MonitoringModule } from "../monitoring/monitoring.module";
import { UserModule } from "../user/user.module";
import { DealModule } from "../deal/deal.module";
import { PaymentModule } from "../payment/payment.module";
import { ArbitrationModule } from "../arbitration/arbitration.module";
import { OpsModule } from "../ops/ops.module";
import { BlockchainModule } from "../blockchain/blockchain.module";
import { RolesGuard } from "./guards/roles.guard";
import { PrivilegedAccessGuard } from "./guards/privileged-access.guard";
import { PrivilegedIdentityService } from "../auth/privileged-identity.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminProfile,
      AdminLog,
      User,
      Deal,
      Payment,
      Dispute,
    ]),
    forwardRef(() => UserModule),
    forwardRef(() => DealModule),
    forwardRef(() => PaymentModule),
    forwardRef(() => ArbitrationModule),
    OpsModule,
    BlockchainModule,
    MonitoringModule,
    JwtModule.register({}),
  ],
  controllers: [
    AdminController,
    AdminOpsController,
    AdminTonNativeRecoveryController,
    AdminDealController,
    AdminDisputeController,
    AdminPaymentController,
    AdminSettingsController,
    AdminTreasuryController,
    AdminAuditController,
  ],
  providers: [
    AdminService,
    AdminDashboardService,
    RolesGuard,
    PrivilegedAccessGuard,
    PrivilegedIdentityService,
    { provide: APP_GUARD, useClass: PrivilegedAccessGuard },
  ],
  exports: [AdminService, AdminDashboardService, RolesGuard],
})
export class AdminModule {}
