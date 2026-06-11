import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Liveness/readiness probes. Both routes are excluded from
 * RequireAuthMiddleware (see AuthModule) and are intended for Docker/Railway
 * healthchecks and uptime monitors.
 *
 *   GET /api/ping   — pure liveness, no dependencies.
 *   GET /api/health — readiness: verifies the database connection.
 */
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('ping')
  ping(): { status: string } {
    return { status: 'ok' };
  }

  @Get('health')
  async health(): Promise<{ status: string; db: string; uptimeSec: number }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        db: 'down',
        uptimeSec: Math.floor(process.uptime()),
      });
    }
    return {
      status: 'ok',
      db: 'up',
      uptimeSec: Math.floor(process.uptime()),
    };
  }
}
