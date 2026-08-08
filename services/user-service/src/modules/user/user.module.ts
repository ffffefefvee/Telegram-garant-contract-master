import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserSession } from './entities/user-session.entity';
import { LanguagePreference } from './entities/language-preference.entity';
import { Deal } from '../deal/entities/deal.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { KycLimitsService } from './kyc-limits.service';
import { RolesGuard } from '../admin/guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserSession, LanguagePreference, Deal]),
  ],
  controllers: [UserController],
  providers: [UserService, KycLimitsService, RolesGuard],
  exports: [UserService, KycLimitsService, TypeOrmModule],
})
export class UserModule {}
