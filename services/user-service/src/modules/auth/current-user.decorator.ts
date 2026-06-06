import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { UserPayload } from './auth.middleware';

/**
 * Param decorator that exposes the authenticated user attached by
 * `RequireAuthMiddleware`. Replaces the legacy
 * `(arguments[0] as any).user` access pattern, which never actually worked
 * — `arguments[0]` in a NestJS controller is the first decorated route
 * parameter, not the express Request, so the user always ended up
 * undefined and downstream service calls saw `user.id === undefined`.
 *
 * Usage:
 *   async create(@Body() data: CreateDealDto, @CurrentUser() user: UserPayload)
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UserPayload => {
    const req = ctx.switchToHttp().getRequest();
    const user = req?.user as UserPayload | undefined;
    if (!user) {
      throw new UnauthorizedException('Not authenticated');
    }
    return user;
  },
);
