import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminProfile } from './entities/admin-profile.entity';
import { AdminLog } from './entities/admin-log.entity';
import { User } from '../user/entities/user.entity';
import { Role } from './enums/role.enum';
import { AuditLogService } from '../ops/audit-log.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(AdminProfile)
    private adminProfileRepo: Repository<AdminProfile>,
    @InjectRepository(AdminLog)
    private adminLogRepo: Repository<AdminLog>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Назначить пользователя администратором
   */
  async grantAdminRole(userId: string, grantorId: string, role: Role = Role.ADMIN): Promise<AdminProfile> {
    // Проверка прав грантора (нужен SuperAdmin или Admin)
    const grantor = await this.adminProfileRepo.findOne({ where: { userId: grantorId } });
    if (!grantor || grantor.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Только Super Admin может назначать администраторов');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');

    let profile = await this.adminProfileRepo.findOne({ where: { userId } });
    if (!profile) {
      profile = this.adminProfileRepo.create({ userId, role });
    } else {
      profile.role = role;
      profile.isActive = true;
    }

    await this.logAction({
      adminId: grantorId,
      action: 'ROLE_GRANTED',
      targetId: userId,
      description: `Выдана роль ${role}`,
    });

    return this.adminProfileRepo.save(profile);
  }

  /**
   * Получить статистику для дашборда
   */
  async getDashboardStats(): Promise<any> {
    const totalUsers = await this.userRepo.count();
    const totalDeals = 0; // Запрос к DealRepository
    const totalVolume = 0; // Запрос к PaymentRepository
    
    return {
      users: { total: totalUsers },
      deals: { total: totalDeals },
      finance: { volume: totalVolume },
    };
  }

  /**
   * Логирование действия
   */
  async logAction(data: {
    adminId: string;
    action: string;
    targetId?: string;
    description?: string;
    details?: any;
    ipAddress?: string;
  }): Promise<AdminLog> {
    const log = this.adminLogRepo.create({
      adminId: data.adminId,
      action: data.action,
      targetId: data.targetId,
      description: data.description,
      details: data.details || {},
      ipAddress: data.ipAddress,
    });

    const saved = await this.adminLogRepo.save(log);

    // Bridge into the unified audit_log table so the admin viewer sees
    // every admin action in one place. Failures are swallowed inside
    // AuditLogService — they never propagate.
    await this.auditLog.write({
      actorId: data.adminId ?? null,
      actorRole: 'admin',
      aggregateType: 'admin_action',
      aggregateId: data.targetId ?? data.adminId ?? 'unknown',
      action: data.action,
      details: {
        description: data.description,
        ipAddress: data.ipAddress,
        ...(data.details ?? {}),
      },
    });

    return saved;
  }
}
