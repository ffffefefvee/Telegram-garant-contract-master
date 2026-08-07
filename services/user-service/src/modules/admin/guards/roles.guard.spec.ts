import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common/interfaces';
import { Reflector } from '@nestjs/core';
import { UserType } from '../../user/entities/user.entity';
import { Role } from '../enums/role.enum';
import { RolesGuard } from './roles.guard';

function makeContext(user?: unknown): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;
  const guard = new RolesGuard(reflector);

  beforeEach(() => jest.clearAllMocks());

  it('allows an endpoint with no role requirement', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('rejects a request without an authenticated principal', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);

    expect(() => guard.canActivate(makeContext())).toThrow(ForbiddenException);
  });

  it('uses the canonical roles array and rejects a spoofed legacy role field', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    const user = {
      id: 'user-1',
      roles: [UserType.BUYER],
      role: Role.ADMIN,
    };

    expect(() => guard.canActivate(makeContext(user))).toThrow(ForbiddenException);
  });

  it('allows an authenticated administrator in the canonical roles array', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN, Role.SUPER_ADMIN]);
    const user = { id: 'admin-1', roles: [UserType.ADMIN] };

    expect(guard.canActivate(makeContext(user))).toBe(true);
  });
});
