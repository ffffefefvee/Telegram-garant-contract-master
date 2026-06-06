import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, ILike } from 'typeorm';
import { ethers } from 'ethers';
import { User, UserStatus, UserType } from './entities/user.entity';
import { UserSession, SessionType } from './entities/user-session.entity';
import { LanguagePreference, LanguageCode } from './entities/language-preference.entity';
import { v4 as uuidv4 } from 'uuid';

export interface CreateUserDto {
  telegramId?: number;
  telegramUsername?: string;
  telegramFirstName?: string;
  telegramLastName?: string;
  telegramLanguageCode?: string;
  email?: string;
  passwordHash?: string;
  roles?: UserType[];
}

export interface UpdateUserDto {
  telegramUsername?: string;
  telegramFirstName?: string;
  telegramLastName?: string;
  email?: string;
  settings?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface CreateSessionDto {
  userId: string;
  type: SessionType;
  token?: string;
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: string;
  expiresIn?: number;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserSession)
    private sessionRepository: Repository<UserSession>,
    @InjectRepository(LanguagePreference)
    private languageRepository: Repository<LanguagePreference>,
  ) {}

  async create(data: CreateUserDto): Promise<User> {
    const existingUser = data.telegramId
      ? await this.userRepository.findOne({ where: { telegramId: data.telegramId } })
      : null;

    if (existingUser) {
      throw new ConflictException('User with this Telegram ID already exists');
    }

    if (data.email) {
      const existingByEmail = await this.userRepository.findOne({
        where: {
          email: data.email.toLowerCase(),
        } as any,
      });

      if (existingByEmail) {
        throw new ConflictException('User with this email already exists');
      }
    }

    const user = this.userRepository.create({
      ...data,
      status: UserStatus.ACTIVE,
      roles: data.roles || [UserType.BUYER],
      balance: 0,
      reputationScore: 0,
      completedDeals: 0,
      cancelledDeals: 0,
      disputedDeals: 0,
      settings: {},
      metadata: {},
    });

    const savedUser = await this.userRepository.save(user);
    this.logger.log(`User created: ${savedUser.id}`);

    if (savedUser.telegramId) {
      await this.setDefaultLanguage(savedUser, savedUser.telegramLanguageCode || undefined);
    }

    return savedUser;
  }

  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['languagePreferences'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByTelegramId(telegramId: number): Promise<User | null> {
    return this.userRepository.findOne({
      where: { telegramId, deletedAt: IsNull() } as any,
      relations: ['languagePreferences'],
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email } as any,
      relations: ['languagePreferences'],
    });
  }

  async searchByQuery(q: string, limit = 10): Promise<{ users: Partial<User>[] }> {
    if (!q || q.trim().length < 2) return { users: [] };
    const term = `%${q.trim()}%`;
    const users = await this.userRepository.find({
      where: [
        { telegramUsername: ILike(term) },
        { telegramFirstName: ILike(term) },
      ],
      take: limit,
      select: ['id', 'telegramUsername', 'telegramFirstName', 'reputationScore', 'completedDeals'],
    });
    return { users };
  }

  async update(id: string, data: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);

    Object.assign(user, data);
    user.updatedAt = new Date();

    return this.userRepository.save(user);
  }

  /**
   * Attach an EVM wallet to the user. Validates the address format,
   * checksums it, and rejects if the same address is already attached
   * to a different (active) user — wallet uniqueness is required for
   * unambiguous payout routing.
   */
  async attachWallet(userId: string, walletAddress: string): Promise<User> {
    if (!ethers.isAddress(walletAddress)) {
      throw new BadRequestException(
        `Not a valid EVM address: "${walletAddress}"`,
      );
    }
    if (walletAddress === ethers.ZeroAddress) {
      throw new BadRequestException('Wallet cannot be the zero address');
    }
    const checksummed = ethers.getAddress(walletAddress);

    const existing = await this.userRepository.findOne({
      where: { walletAddress: checksummed, deletedAt: IsNull() },
    });
    if (existing && existing.id !== userId) {
      throw new ConflictException(
        `Wallet ${checksummed} is already attached to another account`,
      );
    }

    const user = await this.findById(userId);
    user.walletAddress = checksummed;
    user.walletAttachedAt = new Date();
    user.updatedAt = new Date();
    const saved = await this.userRepository.save(user);
    this.logger.log(`Wallet attached: user=${userId} wallet=${checksummed}`);
    return saved;
  }

  /**
   * Detach the wallet. Used when the user wants to swap addresses.
   * Does NOT delete the user.
   */
  async detachWallet(userId: string): Promise<User> {
    const user = await this.findById(userId);
    user.walletAddress = null;
    user.walletAttachedAt = null;
    user.updatedAt = new Date();
    const saved = await this.userRepository.save(user);
    this.logger.log(`Wallet detached: user=${userId}`);
    return saved;
  }

  /** Ignore empty or punctuation-only names from Telegram clients. */
  private sanitizeTelegramName(value?: string): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (trimmed.length < 2 || !/[\p{L}\p{N}]/u.test(trimmed)) {
      return undefined;
    }
    return trimmed;
  }

  async updateTelegramUser(
    telegramId: number,
    username?: string,
    firstName?: string,
    lastName?: string,
    languageCode?: string,
  ): Promise<User> {
    const safeFirst = this.sanitizeTelegramName(firstName);
    const safeLast = this.sanitizeTelegramName(lastName);
    const safeUsername = username?.trim() || undefined;

    let user = await this.findByTelegramId(telegramId);

    if (user) {
      user.telegramUsername = safeUsername || user.telegramUsername;
      user.telegramFirstName = safeFirst ?? user.telegramFirstName;
      user.telegramLastName = safeLast ?? user.telegramLastName;
      user.telegramLanguageCode = languageCode || user.telegramLanguageCode;
      user.updatedAt = new Date();

      if (languageCode && languageCode !== user.telegramLanguageCode) {
        await this.setDefaultLanguage(user, languageCode);
      }
    } else {
      user = await this.create({
        telegramId,
        telegramUsername: safeUsername,
        telegramFirstName: safeFirst,
        telegramLastName: safeLast,
        telegramLanguageCode: languageCode,
      });
    }

    return this.userRepository.save(user);
  }

  async updateLastLogin(id: string, ip?: string): Promise<void> {
    await this.userRepository.update(id, {
      lastLoginAt: new Date(),
      lastLoginIp: ip || null,
    });
  }

  async setStatus(id: string, status: UserStatus): Promise<User> {
    const user = await this.findById(id);
    user.status = status;
    user.updatedAt = new Date();
    return this.userRepository.save(user);
  }

  async ban(id: string, reason?: string): Promise<User> {
    const user = await this.findById(id);
    user.status = UserStatus.BANNED;
    user.metadata = {
      ...user.metadata,
      banReason: reason,
      bannedAt: new Date().toISOString(),
    };
    user.updatedAt = new Date();
    return this.userRepository.save(user);
  }

  async unban(id: string): Promise<User> {
    const user = await this.findById(id);
    user.status = UserStatus.ACTIVE;
    user.metadata = {
      ...user.metadata,
      unbannedAt: new Date().toISOString(),
    };
    user.updatedAt = new Date();
    return this.userRepository.save(user);
  }

  async addRole(id: string, role: UserType): Promise<User> {
    const user = await this.findById(id);

    if (!user.roles.includes(role)) {
      user.roles.push(role);
      user.updatedAt = new Date();
      await this.userRepository.save(user);
    }

    return user;
  }

  async removeRole(id: string, role: UserType): Promise<User> {
    const user = await this.findById(id);
    user.roles = user.roles.filter((r) => r !== role);
    user.updatedAt = new Date();
    return this.userRepository.save(user);
  }

  async createSession(data: CreateSessionDto): Promise<UserSession> {
    const user = await this.findById(data.userId);

    const session = this.sessionRepository.create({
      user,
      userId: data.userId,
      token: data.token || uuidv4(),
      type: data.type,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      deviceInfo: data.deviceInfo,
      expiresAt: new Date(Date.now() + (data.expiresIn || 30 * 24 * 60 * 60 * 1000)),
      lastActivityAt: new Date(),
      metadata: {},
    });

    return this.sessionRepository.save(session);
  }

  async findSessionByToken(token: string): Promise<UserSession | null> {
    return this.sessionRepository.findOne({
      where: { token },
      relations: ['user', 'user.languagePreferences'],
    });
  }

  async validateSession(token: string): Promise<UserSession | null> {
    const session = await this.findSessionByToken(token);

    if (!session) {
      return null;
    }

    if (!session.isValid) {
      return null;
    }

    session.updateActivity();
    await this.sessionRepository.save(session);

    return session;
  }

  async revokeSession(token: string, reason?: string): Promise<void> {
    const session = await this.findSessionByToken(token);

    if (session) {
      session.revoke(reason);
      await this.sessionRepository.save(session);
    }
  }

  async revokeAllUserSessions(userId: string, reason?: string): Promise<void> {
    await this.sessionRepository.update(
      { userId, isActive: true },
      {
        isActive: false,
        revokedAt: new Date(),
        revokeReason: reason,
      },
    );
  }

  async getUserLanguage(userId: string, context: string = 'global'): Promise<LanguageCode> {
    const preference = await this.languageRepository.findOne({
      where: { userId, context, isActive: true },
    });

    if (preference) {
      return preference.languageCode;
    }

    const user = await this.findById(userId);

    if (user.telegramLanguageCode) {
      return LanguagePreference.fromTelegramCode(user.telegramLanguageCode);
    }

    return LanguagePreference.getDefaultLanguage();
  }

  async setUserLanguage(
    userId: string,
    languageCode: LanguageCode,
    context: string = 'global',
  ): Promise<LanguagePreference> {
    const existing = await this.languageRepository.findOne({
      where: { userId, context },
    });

    if (existing) {
      existing.languageCode = languageCode;
      existing.usageCount += 1;
      existing.updatedAt = new Date();
      return this.languageRepository.save(existing);
    }

    const preference = this.languageRepository.create({
      user: { id: userId } as User,
      userId,
      languageCode,
      context,
      usageCount: 1,
    });

    return this.languageRepository.save(preference);
  }

  private async setDefaultLanguage(user: User, telegramLanguageCode?: string): Promise<void> {
    const languageCode = telegramLanguageCode
      ? LanguagePreference.fromTelegramCode(telegramLanguageCode)
      : LanguagePreference.getDefaultLanguage();

    await this.setUserLanguage(user.id, languageCode);
  }

  async incrementDealStats(
    userId: string,
    type: 'completed' | 'cancelled' | 'disputed',
  ): Promise<User> {
    const user = await this.findById(userId);

    switch (type) {
      case 'completed':
        user.completedDeals += 1;
        break;
      case 'cancelled':
        user.cancelledDeals += 1;
        break;
      case 'disputed':
        user.disputedDeals += 1;
        break;
    }

    user.updatedAt = new Date();
    return this.userRepository.save(user);
  }

  async updateReputation(userId: string, scoreDelta: number): Promise<User> {
    const user = await this.findById(userId);

    const newScore = Math.max(0, Math.min(100, user.reputationScore + scoreDelta));
    user.reputationScore = newScore;
    user.updatedAt = new Date();

    return this.userRepository.save(user);
  }

  async updateBalance(userId: string, amount: number): Promise<User> {
    const user = await this.findById(userId);

    user.balance += amount;

    if (user.balance < 0) {
      throw new ConflictException('Insufficient balance');
    }

    user.updatedAt = new Date();
    return this.userRepository.save(user);
  }

  async softDelete(id: string): Promise<void> {
    await this.userRepository.update(id, {
      deletedAt: new Date(),
      status: UserStatus.INACTIVE,
    });
  }

  async getUserStats(userId: string): Promise<{
    totalDeals: number;
    successRate: number;
    reputationScore: number;
    balance: number;
  }> {
    const user = await this.findById(userId);

    const totalDeals = user.completedDeals + user.cancelledDeals + user.disputedDeals;
    const successRate = totalDeals > 0 ? (user.completedDeals / totalDeals) * 100 : 0;

    return {
      totalDeals,
      successRate: Math.round(successRate * 100) / 100,
      reputationScore: user.reputationScore,
      balance: user.balance,
    };
  }

  /**
   * Получить всех пользователей (для админки)
   */
  async findAll(page: number = 1, limit: number = 20): Promise<{ users: User[]; total: number }> {
    const [users, total] = await this.userRepository.findAndCount({
      where: { deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });

    return { users, total };
  }

  /**
   * Забанить пользователя
   */
  async banUser(id: string, reason: string): Promise<User> {
    const user = await this.findById(id);

    user.status = UserStatus.BANNED;
    user.banReason = reason;
    user.bannedAt = new Date();
    user.updatedAt = new Date();

    return this.userRepository.save(user);
  }
}
