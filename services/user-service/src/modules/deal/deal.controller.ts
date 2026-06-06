import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
} from '@nestjs/common';
import { DealService, CreateDealDto, UpdateDealDto, DealFilterDto } from './deal.service';
import { Deal } from './entities/deal.entity';
import { DealMessage } from './entities/deal-message.entity';
import { DealInvite } from './entities/deal-invite.entity';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserPayload } from '../auth/auth.middleware';

@Controller('deals')
export class DealController {
  constructor(private dealService: DealService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() data: CreateDealDto,
    @CurrentUser() user: UserPayload,
  ): Promise<Deal> {
    return this.dealService.create(data, user.id);
  }

  @Get()
  async findMany(
    @Query() filter: DealFilterDto,
    @CurrentUser() user: UserPayload,
  ): Promise<{ deals: Deal[]; total: number }> {
    return this.dealService.findMany(filter, user.id);
  }

  @Get('number/:number')
  async findByNumber(@Param('number') number: string): Promise<Deal> {
    return this.dealService.findByNumber(number);
  }

  @Get(':id')
  async findById(@Param('id', ParseUUIDPipe) id: string): Promise<Deal> {
    return this.dealService.findById(id, [
      'buyer',
      'seller',
      'messages',
      'attachments',
      'events',
    ]);
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateDealDto,
    @CurrentUser() user: UserPayload,
  ): Promise<Deal> {
    return this.dealService.update(id, data, user.id);
  }

  @Post(':id/cancel')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: UserPayload,
  ): Promise<Deal> {
    return this.dealService.cancel(id, user.id, body.reason);
  }

  @Post(':id/accept')
  async accept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
  ): Promise<Deal> {
    return this.dealService.accept(id, user.id);
  }

  @Post(':id/reject')
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
    @CurrentUser() user: UserPayload,
  ): Promise<Deal> {
    return this.dealService.reject(id, user.id, body.reason);
  }

  @Post(':id/confirm')
  async confirmReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
  ): Promise<Deal> {
    return this.dealService.confirmReceipt(id, user.id);
  }

  @Post(':id/ship')
  async markShipped(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
  ): Promise<Deal> {
    return this.dealService.markShipped(id, user.id);
  }

  @Get(':id/escrow')
  async getEscrow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.dealService.getEscrowForDeal(id, user.id);
  }

  @Post(':id/escrow/release-sync')
  async syncEscrowRelease(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { txHash?: string },
    @CurrentUser() user: UserPayload,
  ): Promise<Deal> {
    return this.dealService.syncEscrowRelease(id, user.id, body.txHash);
  }

  @Post(':id/dispute')
  async openDispute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason: string },
    @CurrentUser() user: UserPayload,
  ): Promise<Deal> {
    return this.dealService.openDispute(id, user.id, body.reason);
  }

  @Get(':id/messages')
  async getMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', ParseIntPipe) limit: number = 50,
    @Query('offset', ParseIntPipe) offset: number = 0,
  ): Promise<DealMessage[]> {
    return this.dealService.getMessages(id, limit, offset);
  }

  @Post(':id/messages')
  async createMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { content: string },
    @CurrentUser() user: UserPayload,
  ): Promise<DealMessage> {
    return this.dealService.createMessage({
      dealId: id,
      senderId: user.id,
      content: body.content,
    });
  }

  @Get(':id/events')
  async getEvents(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit', ParseIntPipe) limit: number = 50,
  ) {
    return this.dealService.getEvents(id, limit);
  }

  @Post(':id/invite')
  async createInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      invitedUserId?: string;
      invitedUserTelegramId?: string;
      message?: string;
      expiresInHours?: number;
    },
    @CurrentUser() user: UserPayload,
  ): Promise<DealInvite> {
    return this.dealService.createInvite(
      id,
      user.id,
      body.invitedUserId,
      body.invitedUserTelegramId,
      body.message,
      body.expiresInHours,
    );
  }

  @Get(':id/stats')
  async getStats(
    @Param('id', ParseUUIDPipe) _id: string,
    @CurrentUser() user: UserPayload,
  ): Promise<{
    totalDeals: number;
    activeDeals: number;
    completedDeals: number;
    totalAmount: number;
    asBuyer: number;
    asSeller: number;
  }> {
    return this.dealService.getUserStats(user.id);
  }
}
