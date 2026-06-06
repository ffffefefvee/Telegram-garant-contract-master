import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ILike, IsNull, Repository } from 'typeorm';
import { UserService } from './user.service';
import { User, UserStatus, UserType } from './entities/user.entity';
import { UserSession } from './entities/user-session.entity';
import { LanguagePreference, LanguageCode } from './entities/language-preference.entity';

const makeMockUser = (): Partial<User> => ({
  id: 'test-uuid-123',
  telegramId: 123456789,
  telegramUsername: 'testuser',
  telegramFirstName: 'Test',
  telegramLastName: 'User',
  telegramLanguageCode: 'ru',
  status: UserStatus.ACTIVE,
  roles: [UserType.BUYER],
  balance: 0,
  reputationScore: 0,
  completedDeals: 0,
  cancelledDeals: 0,
  disputedDeals: 0,
  settings: {},
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('UserService', () => {
  let service: UserService;
  let userRepository: Repository<User>;
  let sessionRepository: Repository<UserSession>;
  let languageRepository: Repository<LanguagePreference>;
  let mockUser: Partial<User>;

  const mockUserRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    find: jest.fn(),
  };

  const mockSessionRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const mockLanguageRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    mockUser = makeMockUser();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(UserSession),
          useValue: mockSessionRepository,
        },
        {
          provide: getRepositoryToken(LanguagePreference),
          useValue: mockLanguageRepository,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    sessionRepository = module.get<Repository<UserSession>>(getRepositoryToken(UserSession));
    languageRepository = module.get<Repository<LanguagePreference>>(
      getRepositoryToken(LanguagePreference),
    );

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new user successfully', async () => {
      const createDto = {
        telegramId: 123456789,
        telegramUsername: 'testuser',
        telegramFirstName: 'Test',
      };

      mockUserRepository.findOne.mockResolvedValue(null);
      mockUserRepository.create.mockReturnValue(mockUser);
      mockUserRepository.save.mockResolvedValue(mockUser);
      mockLanguageRepository.save.mockResolvedValue({});

      const result = await service.create(createDto);

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ...createDto,
          status: UserStatus.ACTIVE,
          roles: [UserType.BUYER],
        }),
      );
      expect(userRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockUser);
    });

    it('should throw ConflictException if user with telegramId already exists', async () => {
      const createDto = { telegramId: 123456789 };

      mockUserRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.create(createDto)).rejects.toThrow('already exists');
    });
  });

  describe('findByTelegramId', () => {
    it('should return user by telegram ID', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findByTelegramId(123456789);

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { telegramId: 123456789, deletedAt: IsNull() },
        relations: ['languagePreferences'],
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null if user not found', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      const result = await service.findByTelegramId(999999999);

      expect(result).toBeNull();
    });
  });

  describe('updateTelegramUser', () => {
    it('should update existing user', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.save.mockResolvedValue(mockUser);

      const result = await service.updateTelegramUser(
        123456789,
        'newusername',
        'NewFirst',
        'NewLast',
        'en',
      );

      expect(userRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockUser);
    });

    it('should create new user if not exists', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      mockUserRepository.create.mockReturnValue(mockUser);
      mockUserRepository.save.mockResolvedValue(mockUser);
      mockLanguageRepository.save.mockResolvedValue({});

      const result = await service.updateTelegramUser(
        999999999,
        'newuser',
        'New',
        'User',
        'ru',
      );

      expect(userRepository.create).toHaveBeenCalled();
      expect(userRepository.save).toHaveBeenCalled();
    });
  });

  describe('createSession', () => {
    it('should create a new session', async () => {
      const sessionData = {
        userId: 'test-uuid-123',
        type: 'telegram' as const,
        ipAddress: '127.0.0.1',
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockSessionRepository.create.mockReturnValue({
        ...sessionData,
        token: 'test-token',
        expiresAt: new Date(),
      });
      mockSessionRepository.save.mockResolvedValue({ token: 'test-token' });

      const result = await service.createSession({
        userId: sessionData.userId,
        type: 'telegram' as any,
        ipAddress: sessionData.ipAddress,
      });

      expect(sessionRepository.create).toHaveBeenCalled();
      expect(sessionRepository.save).toHaveBeenCalled();
    });
  });

  describe('validateSession', () => {
    it('should return valid session', async () => {
      const mockSession = {
        token: 'test-token',
        isActive: true,
        expiresAt: new Date(Date.now() + 1000000),
        revokedAt: null,
        isValid: true,
        user: mockUser,
        updateActivity: jest.fn(),
      };

      mockSessionRepository.findOne.mockResolvedValue(mockSession);
      mockSessionRepository.save.mockResolvedValue(mockSession);

      const result = await service.validateSession('test-token');

      expect(result).toEqual(mockSession);
    });

    it('should return null for expired session', async () => {
      const mockSession = {
        token: 'test-token',
        isActive: true,
        expiresAt: new Date(Date.now() - 1000000),
        revokedAt: null,
        isValid: false,
      };

      mockSessionRepository.findOne.mockResolvedValue(mockSession);

      const result = await service.validateSession('test-token');

      expect(result).toBeNull();
    });
  });

  describe('getUserLanguage', () => {
    it('should return user language preference', async () => {
      const mockPreference = {
        languageCode: LanguageCode.EN,
        context: 'global',
      };

      mockLanguageRepository.findOne.mockResolvedValue(mockPreference);

      const result = await service.getUserLanguage('test-uuid-123');

      expect(result).toBe(LanguageCode.EN);
    });

    it('should return default language if no preference', async () => {
      mockLanguageRepository.findOne.mockResolvedValue(null);
      mockUserRepository.findOne.mockResolvedValue({
        ...mockUser,
        telegramLanguageCode: null,
      });

      const result = await service.getUserLanguage('test-uuid-123');

      expect(result).toBe(LanguageCode.RU);
    });
  });

  describe('updateReputation', () => {
    it('should update user reputation score', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.save.mockResolvedValue({
        ...mockUser,
        reputationScore: 10,
      });

      const result = await service.updateReputation('test-uuid-123', 10);

      expect(userRepository.save).toHaveBeenCalled();
      expect(result.reputationScore).toBe(10);
    });

    it('should not allow reputation score below 0', async () => {
      const lowReputationUser = { ...mockUser, reputationScore: 5 };

      mockUserRepository.findOne.mockResolvedValue(lowReputationUser);
      mockUserRepository.save.mockResolvedValue({
        ...lowReputationUser,
        reputationScore: 0,
      });

      const result = await service.updateReputation('test-uuid-123', -10);

      expect(result.reputationScore).toBe(0);
    });
  });

  describe('updateBalance', () => {
    it('should update user balance', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockUserRepository.save.mockResolvedValue({
        ...mockUser,
        balance: 100,
      });

      const result = await service.updateBalance('test-uuid-123', 100);

      expect(result.balance).toBe(100);
    });

    it('should throw error on insufficient balance', async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.updateBalance('test-uuid-123', -100)).rejects.toThrow(
        'Insufficient balance',
      );
    });
  });

  describe('getUserStats', () => {
    it('should return user statistics', async () => {
      const userWithDeals = {
        ...mockUser,
        completedDeals: 8,
        cancelledDeals: 1,
        disputedDeals: 1,
      };

      mockUserRepository.findOne.mockResolvedValue(userWithDeals);

      const result = await service.getUserStats('test-uuid-123');

      expect(result.totalDeals).toBe(10);
      expect(result.successRate).toBe(80);
      expect(result.reputationScore).toBe(0);
      expect(result.balance).toBe(0);
    });
  });

  describe('attachWallet', () => {
    const VALID = '0x' + 'a'.repeat(40);

    it('rejects invalid EVM address strings', async () => {
      await expect(service.attachWallet('test-uuid-123', 'not-an-address')).rejects.toThrow(
        /valid EVM address/,
      );
    });

    it('rejects the zero address', async () => {
      await expect(
        service.attachWallet('test-uuid-123', '0x0000000000000000000000000000000000000000'),
      ).rejects.toThrow(/zero address/);
    });

    it('rejects when address is already attached to a different user', async () => {
      mockUserRepository.findOne.mockImplementation(async ({ where }: any) => {
        if (where.walletAddress) {
          return { id: 'someone-else', walletAddress: where.walletAddress };
        }
        return mockUser;
      });
      await expect(service.attachWallet('test-uuid-123', VALID)).rejects.toThrow(
        /already attached/,
      );
    });

    it('attaches a checksummed address and timestamps walletAttachedAt', async () => {
      const target = { ...mockUser, walletAddress: null, walletAttachedAt: null };
      mockUserRepository.findOne.mockImplementation(async ({ where }: any) => {
        if (where.walletAddress) return null; // not in use
        if (where.id) return target;
        return null;
      });
      mockUserRepository.save.mockImplementation(async (u: User) => u);

      const result = await service.attachWallet('test-uuid-123', VALID);

      expect(result.walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(result.walletAttachedAt).toBeInstanceOf(Date);
    });

    it('is idempotent when the same user re-attaches the same wallet', async () => {
      const target = { ...mockUser, id: 'test-uuid-123', walletAddress: VALID };
      mockUserRepository.findOne.mockImplementation(async ({ where }: any) => {
        if (where.walletAddress) return target;
        if (where.id) return target;
        return null;
      });
      mockUserRepository.save.mockImplementation(async (u: User) => u);

      await expect(service.attachWallet('test-uuid-123', VALID)).resolves.toBeDefined();
    });
  });

  describe('detachWallet', () => {
    it('clears walletAddress and walletAttachedAt', async () => {
      const target = {
        ...mockUser,
        walletAddress: '0x' + 'b'.repeat(40),
        walletAttachedAt: new Date(),
      };
      mockUserRepository.findOne.mockResolvedValue(target);
      mockUserRepository.save.mockImplementation(async (u: User) => u);

      const result = await service.detachWallet('test-uuid-123');

      expect(result.walletAddress).toBeNull();
      expect(result.walletAttachedAt).toBeNull();
    });
  });

  describe('searchByQuery', () => {
    it('should return empty list for empty query without calling repository', async () => {
      const result = await service.searchByQuery('');

      expect(result).toEqual({ users: [] });
      expect(mockUserRepository.find).not.toHaveBeenCalled();
    });

    it('should return empty list for single-character query without calling repository', async () => {
      const result = await service.searchByQuery('a');

      expect(result).toEqual({ users: [] });
      expect(mockUserRepository.find).not.toHaveBeenCalled();
    });

    it('should return empty list for whitespace-only query without calling repository', async () => {
      const result = await service.searchByQuery('  ');

      expect(result).toEqual({ users: [] });
      expect(mockUserRepository.find).not.toHaveBeenCalled();
    });

    it('should call find with ILike on telegramUsername and telegramFirstName for valid query', async () => {
      const foundUsers = [
        { ...mockUser, telegramUsername: 'ivan123', telegramFirstName: 'Ivan' },
      ];
      mockUserRepository.find.mockResolvedValue(foundUsers);

      const result = await service.searchByQuery('ivan');

      expect(mockUserRepository.find).toHaveBeenCalledWith({
        where: [
          { telegramUsername: ILike('%ivan%') },
          { telegramFirstName: ILike('%ivan%') },
        ],
        take: 10,
        select: ['id', 'telegramUsername', 'telegramFirstName', 'reputationScore', 'completedDeals'],
      });
      expect(result).toEqual({ users: foundUsers });
    });

    it('should use default limit of 10 when limit is not provided', async () => {
      mockUserRepository.find.mockResolvedValue([]);

      await service.searchByQuery('ivan');

      expect(mockUserRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });

    it('should pass custom limit to repository find call', async () => {
      mockUserRepository.find.mockResolvedValue([]);

      await service.searchByQuery('ivan', 5);

      expect(mockUserRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it('should trim the query before building the search term', async () => {
      mockUserRepository.find.mockResolvedValue([]);

      await service.searchByQuery('  ivan  ');

      expect(mockUserRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { telegramUsername: ILike('%ivan%') },
            { telegramFirstName: ILike('%ivan%') },
          ],
        }),
      );
    });

    it('should return empty users array when repository returns no matches', async () => {
      mockUserRepository.find.mockResolvedValue([]);

      const result = await service.searchByQuery('unknownuser');

      expect(result).toEqual({ users: [] });
    });
  });
});
