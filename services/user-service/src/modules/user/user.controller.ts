import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
  Req,
  UnauthorizedException,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { UserService, CreateUserDto, UpdateUserDto } from './user.service';
import { User, UserStatus, UserType } from './entities/user.entity';
import { SessionType } from './entities/user-session.entity';
import { LanguageCode } from './entities/language-preference.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPayload } from '../auth/auth.middleware';
import { Roles } from '../admin/decorators/roles.decorator';
import { Role } from '../admin/enums/role.enum';
import { RolesGuard } from '../admin/guards/roles.guard';

export class AttachWalletDto {
  walletAddress: string;
}

@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async create(@Body() data: CreateUserDto): Promise<User> {
    return this.userService.create(data);
  }

  @Get('telegram/:telegramId')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async findByTelegramId(
    @Param('telegramId', ParseIntPipe) telegramId: number,
  ): Promise<User | null> {
    return this.userService.findByTelegramId(telegramId);
  }

  @Get('email/:email')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async findByEmail(@Param('email') email: string): Promise<User | null> {
    return this.userService.findByEmail(email);
  }

  /**
   * GET /api/users/me
   *
   * Returns the canonical User row for the JWT bearer. Loads from the DB
   * (not just the cached middleware payload) so callers see current
   * settings, wallet address, etc.
   */
  @Get('me')
  async getCurrentUser(@Req() req: Request): Promise<User> {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Not authenticated');
    }
    return this.userService.findById(userId);
  }

  /**
   * POST /api/users/me/wallet
   * Body: { walletAddress: "0x..." }
   *
   * Attaches an EVM wallet to the current user. Required before the user
   * can participate in any deal that needs on-chain settlement (sellers
   * receive USDT here, buyers' deals are routed to clones predicated on
   * both parties having a wallet).
   */
  @Post('me/wallet')
  @HttpCode(HttpStatus.OK)
  async attachWallet(
    @Req() req: Request,
    @Body() body: AttachWalletDto,
  ): Promise<User> {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Not authenticated');
    }
    return this.userService.attachWallet(userId, body?.walletAddress ?? '');
  }

  /**
   * DELETE /api/users/me/wallet
   *
   * Detaches the wallet. The user must re-attach before participating
   * in any new on-chain deal. Existing escrows are unaffected.
   */
  @Delete('me/wallet')
  @HttpCode(HttpStatus.OK)
  async detachWallet(@Req() req: Request): Promise<User> {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException('Not authenticated');
    }
    return this.userService.detachWallet(userId);
  }

  @Get('search')
  async searchUsers(
    @Query('q') q: string,
    @Query('limit') limit?: number,
  ) {
    return this.userService.searchByQuery(q, limit ? Number(limit) : 10);
  }

  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
  ): Promise<User> {
    this.assertSelfOrAdministrator(id, user);
    return this.userService.findById(id);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateUserDto,
    @CurrentUser() user: UserPayload,
  ): Promise<User> {
    this.assertSelfOrAdministrator(id, user);
    return this.userService.update(id, data);
  }

  @Post(':id/sessions')
  async createSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      type: SessionType;
      ipAddress?: string;
      userAgent?: string;
      deviceInfo?: string;
      expiresIn?: number;
    },
    @CurrentUser() user: UserPayload,
  ): Promise<{ token: string; expiresAt: Date }> {
    this.assertSelf(id, user);
    const session = await this.userService.createSession({
      userId: id,
      ...body,
    });

    return {
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  @Delete(':id/sessions/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Param('token') token: string,
  ): Promise<void> {
    await this.userService.revokeSession(token);
  }

  @Post(':id/language')
  async setLanguage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { languageCode: LanguageCode; context?: string },
    @CurrentUser() user: UserPayload,
  ): Promise<{ languageCode: LanguageCode }> {
    this.assertSelf(id, user);
    await this.userService.setUserLanguage(
      id,
      body.languageCode,
      body.context || 'global',
    );

    return { languageCode: body.languageCode };
  }

  @Get(':id/language')
  async getLanguage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
    @Headers('x-context') context?: string,
  ): Promise<{ languageCode: LanguageCode }> {
    this.assertSelf(id, user);
    const languageCode = await this.userService.getUserLanguage(
      id,
      context || 'global',
    );

    return { languageCode };
  }

  @Put(':id/status')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: UserStatus },
  ): Promise<User> {
    return this.userService.setStatus(id, body.status);
  }

  @Post(':id/ban')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async ban(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ): Promise<User> {
    return this.userService.ban(id, body.reason);
  }

  @Post(':id/unban')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async unban(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
    return this.userService.unban(id);
  }

  @Post(':id/roles')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async addRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { role: UserType },
  ): Promise<User> {
    return this.userService.addRole(id, body.role);
  }

  @Delete(':id/roles/:role')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async removeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('role') role: UserType,
  ): Promise<User> {
    return this.userService.removeRole(id, role);
  }

  @Get(':id/stats')
  async getStats(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
  ): Promise<{
    totalDeals: number;
    successRate: number;
    reputationScore: number;
    balance: number;
  }> {
    this.assertSelfOrAdministrator(id, user);
    return this.userService.getUserStats(id);
  }

  @Post(':id/balance')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async updateBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { amount: number },
  ): Promise<User> {
    return this.userService.updateBalance(id, body.amount);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async softDelete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.userService.softDelete(id);
  }

  private assertSelf(targetUserId: string, user: UserPayload): void {
    if (targetUserId !== user.id) {
      throw new ForbiddenException('You can only manage your own account');
    }
  }

  private assertSelfOrAdministrator(targetUserId: string, user: UserPayload): void {
    if (targetUserId === user.id || this.hasAdministrativeRole(user)) {
      return;
    }
    throw new ForbiddenException('Access denied');
  }

  private hasAdministrativeRole(user: UserPayload): boolean {
    return user.roles.includes(UserType.ADMIN) || user.roles.includes(UserType.SUPER_ADMIN);
  }
}
