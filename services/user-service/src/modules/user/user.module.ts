import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./entities/user.entity";
import { UserSession } from "./entities/user-session.entity";
import { LanguagePreference } from "./entities/language-preference.entity";
import { TonProofChallenge } from "./entities/ton-proof-challenge.entity";
import { TonWalletBinding } from "./entities/ton-wallet-binding.entity";
import { Deal } from "../deal/entities/deal.entity";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";
import { TonWalletController } from "./ton-wallet.controller";
import { TonProofVerifier } from "./ton-proof-verifier";
import { TonWalletService } from "./ton-wallet.service";
import { KycLimitsService } from "./kyc-limits.service";
import { RolesGuard } from "../admin/guards/roles.guard";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserSession,
      LanguagePreference,
      TonProofChallenge,
      TonWalletBinding,
      Deal,
    ]),
  ],
  controllers: [UserController, TonWalletController],
  providers: [
    UserService,
    TonWalletService,
    TonProofVerifier,
    KycLimitsService,
    RolesGuard,
  ],
  exports: [UserService, TonWalletService, KycLimitsService, TypeOrmModule],
})
export class UserModule {}
