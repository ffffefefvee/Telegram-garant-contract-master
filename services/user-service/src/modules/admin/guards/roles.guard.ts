import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import type { UserPayload } from '../../auth/auth.middleware';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as UserPayload | undefined;

    if (!user) {
      throw new ForbiddenException('Authenticated user is required');
    }

    // RequireAuthMiddleware loads these roles from the canonical User record
    // after JWT verification. Do not trust a legacy singular `user.role`
    // field: accepting it would allow a request object forged by another
    // middleware or test helper to bypass RBAC.
    const userRoles = new Set<string>(user.roles ?? []);
    const hasRole = requiredRoles.some((role) => userRoles.has(role));
    
    if (!hasRole) {
      throw new ForbiddenException(`Требуется одна из ролей: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
