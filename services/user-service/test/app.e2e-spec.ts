import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../src/modules/user/entities/user.entity';

describe('UserModule (e2e)', () => {
  let app: INestApplication;
  let mockUserRepository: any;

  beforeEach(async () => {
    mockUserRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue(mockUserRepository)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/users (GET) - should return empty array', () => {
    mockUserRepository.find.mockResolvedValue([]);

    return request(app.getHttpServer())
      .get('/api/users')
      .expect(200)
      .expect([]);
  });

  it('/api/users/telegram/:id (GET) - should return user by telegram id', () => {
    const mockUser = {
      id: 'test-uuid',
      telegramId: 123456789,
      telegramUsername: 'testuser',
    };

    mockUserRepository.findOne.mockResolvedValue(mockUser);

    return request(app.getHttpServer())
      .get('/api/users/telegram/123456789')
      .expect(200)
      .expect(mockUser);
  });
});
