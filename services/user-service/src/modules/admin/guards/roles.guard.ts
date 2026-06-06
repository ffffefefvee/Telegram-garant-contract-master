import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';

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
    const user = request.user; // Предполагается, что user уже добавлен в request после AuthMiddleware

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    // Проверяем роль пользователя (временно используем поле role, если оно есть, или默认 admin для теста)
    // В реальной системе это должно проверяться через JWT токен
    const userRole: Role = user.role || Role.USER; 

    const hasRole = requiredRoles.some((role) => userRole === role);
    
    if (!hasRole) {
      throw new ForbiddenException(`Требуется одна из ролей: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
