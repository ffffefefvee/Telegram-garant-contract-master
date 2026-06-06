import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DealMessage, MessageType } from './entities/deal-message.entity';
import { UserService } from '../user/user.service';
import { Deal } from './entities/deal.entity';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class DealGatewayService {
  private readonly logger = new Logger(DealGatewayService.name);

  constructor(
    @InjectRepository(DealMessage)
    private messageRepository: Repository<DealMessage>,
    @InjectRepository(Deal)
    private dealRepository: Repository<Deal>,
    private userService: UserService,
    private authService: AuthService,
  ) {}

  async saveMessage(
    dealId: string,
    userId: string,
    content: string,
    type: string = 'text',
  ): Promise<DealMessage> {
    const message = this.messageRepository.create({
      dealId,
      senderId: userId,
      content,
      type: type as MessageType,
    });

    const saved = await this.messageRepository.save(message);

    this.logger.log(`Message saved: ${saved.id} for deal ${dealId}`);

    return saved;
  }

  async resolveUserIdFromToken(token: string): Promise<string | null> {
    try {
      const payload = await this.authService.verifyToken(token);
      return payload?.sub ?? null;
    } catch {
      return null;
    }
  }

  async validateAccess(dealId: string, token: string): Promise<boolean> {
    try {
      const userId = await this.resolveUserIdFromToken(token);
      if (!userId) return false;

      const deal = await this.dealRepository.findOne({ where: { id: dealId } });
      if (!deal) return false;

      return deal.buyerId === userId || deal.sellerId === userId;
    } catch {
      return false;
    }
  }

  async getMessages(dealId: string, limit: number = 50, offset: number = 0) {
    return this.messageRepository.find({
      where: { dealId, isDeleted: false },
      relations: ['sender'],
      order: { createdAt: 'ASC' },
      skip: offset,
      take: limit,
    });
  }
}