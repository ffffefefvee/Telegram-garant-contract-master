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
} from '@nestjs/common';
import { Request } from 'express';
import { UserService, CreateUserDto, UpdateUserDto } from './user.service';
import { User, UserStatus, UserType } from './entities/user.entity';
import { SessionType } from './entities/user-session.entity';
import { LanguageCode } from './entities/language-preference.entity';

export class AttachWalletDto {
  walletAddress: string;
}

@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() data: CreateUserDto): Promise<User> {
    return this.userService.create(data);
  }

  @Get('telegram/:telegramId')
  async findByTelegramId(
    @Param('telegramId', ParseIntPipe) telegramId: number,
  ): Promise<User | null> {
    return this.userService.findByTelegramId(telegramId);
  }

  @Get('email/:email')
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
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
    return this.userService.findById(id);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateUserDto,
  ): Promise<User> {
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
  ): Promise<{ token: string; expiresAt: Date }> {
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
  ): Promise<{ languageCode: LanguageCode }> {
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
    @Headers('x-context') context?: string,
  ): Promise<{ languageCode: LanguageCode }> {
    const languageCode = await this.userService.getUserLanguage(
      id,
      context || 'global',
    );

    return { languageCode };
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: UserStatus },
  ): Promise<User> {
    return this.userService.setStatus(id, body.status);
  }

  @Post(':id/ban')
  async ban(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ): Promise<User> {
    return this.userService.ban(id, body.reason);
  }

  @Post(':id/unban')
  async unban(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
    return this.userService.unban(id);
  }

  @Post(':id/roles')
  async addRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { role: UserType },
  ): Promise<User> {
    return this.userService.addRole(id, body.role);
  }

  @Delete(':id/roles/:role')
  async removeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('role') role: UserType,
  ): Promise<User> {
    return this.userService.removeRole(id, role);
  }

  @Get(':id/stats')
  async getStats(@Param('id', ParseUUIDPipe) id: string): Promise<{
    totalDeals: number;
    successRate: number;
    reputationScore: number;
    balance: number;
  }> {
    return this.userService.getUserStats(id);
  }

  @Post(':id/balance')
  async updateBalance(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { amount: number },
  ): Promise<User> {
    return this.userService.updateBalance(id, body.amount);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async softDelete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.userService.softDelete(id);
  }
}
