import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import type { Update } from 'telegraf/types';
import {
  TelegramTestCallbackDto,
  TelegramTestCommandDto,
} from './dto/telegram-test-inject.dto';
import { TelegramTestInjectService } from './telegram-test-inject.service';
import { TelegramTestInjectResult } from './telegram-test-inject.types';

@Controller('internal/telegram/test')
export class TelegramTestInjectController {
  constructor(private readonly injectService: TelegramTestInjectService) {}

  private guard(secret: string | undefined): void {
    this.injectService.assertEnabled(secret);
  }

  @Post('update')
  @HttpCode(200)
  async injectRaw(
    @Headers('x-telegram-test-secret') secret: string | undefined,
    @Body() update: Update,
  ): Promise<TelegramTestInjectResult> {
    this.guard(secret);
    return this.injectService.injectUpdate(update);
  }

  @Post('command')
  @HttpCode(200)
  async injectCommand(
    @Headers('x-telegram-test-secret') secret: string | undefined,
    @Body() body: TelegramTestCommandDto,
  ): Promise<TelegramTestInjectResult> {
    this.guard(secret);
    const text = body?.text?.trim();
    if (!text) {
      return { ok: false, capture: null, error: 'text is required' };
    }
    return this.injectService.injectCommand(text);
  }

  @Post('callback')
  @HttpCode(200)
  async injectCallback(
    @Headers('x-telegram-test-secret') secret: string | undefined,
    @Body() body: TelegramTestCallbackDto,
  ): Promise<TelegramTestInjectResult> {
    this.guard(secret);
    const data = body?.data?.trim();
    if (!data) {
      return { ok: false, capture: null, error: 'data is required' };
    }
    return this.injectService.injectCallback(data);
  }
}
