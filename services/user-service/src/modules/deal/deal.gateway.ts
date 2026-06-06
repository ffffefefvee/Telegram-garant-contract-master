import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DealGatewayService } from './deal-gateway.service';

@WebSocketGateway({
  namespace: '/deals',
  cors: { origin: '*' },
})
export class DealGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(DealGateway.name);

  constructor(private readonly gatewayService: DealGatewayService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const dealId = String(client.handshake.query.dealId ?? '');
      const token = String(
        client.handshake.auth?.token ?? client.handshake.query.token ?? '',
      );
      const userId = await this.gatewayService.resolveUserIdFromToken(token);
      if (
        !dealId ||
        !userId ||
        !(await this.gatewayService.validateAccess(dealId, token))
      ) {
        client.disconnect(true);
        return;
      }
      client.data.dealId = dealId;
      client.data.userId = userId;
      await client.join(`deal:${dealId}`);
      this.logger.log(`WS client joined deal:${dealId}`);
    } catch (err) {
      this.logger.warn(`WS connection rejected: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('send_message')
  async onSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { content?: string; type?: string },
  ): Promise<void> {
    const dealId = client.data.dealId as string | undefined;
    const userId = client.data.userId as string | undefined;
    const content = body?.content?.trim();
    if (!dealId || !userId || !content) {
      return;
    }

    const saved = await this.gatewayService.saveMessage(
      dealId,
      userId,
      content,
      body.type ?? 'text',
    );
    this.server.to(`deal:${dealId}`).emit('message', saved);
  }
}
