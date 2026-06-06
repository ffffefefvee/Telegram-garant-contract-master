import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  NotificationPreferenceService,
  UpdatePreferenceInput,
} from './notification-preference.service';

interface AuthedUser {
  id: string;
  roles?: string[];
}

/**
 * Self-service preferences for the current authenticated user.
 * Protected by the global auth middleware that populates `req.user`.
 */
@Controller('notifications/preferences')
export class NotificationController {
  constructor(
    private readonly preferences: NotificationPreferenceService,
  ) {}

  @Get()
  async getMine(@Req() req: Request) {
    const user = this.requireUser(req);
    return this.preferences.getOrDefault(user.id);
  }

  @Patch()
  async updateMine(@Req() req: Request, @Body() body: UpdatePreferenceInput) {
    const user = this.requireUser(req);
    return this.preferences.update(user.id, body);
  }

  private requireUser(req: Request): AuthedUser {
    const user = (req as unknown as { user?: AuthedUser }).user;
    if (!user?.id) {
      throw new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
