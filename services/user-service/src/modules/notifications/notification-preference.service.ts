import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference } from './entities/notification-preference.entity';

export interface UpdatePreferenceInput {
  mutedAll?: boolean;
  mutedEventTypes?: string[];
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}

@Injectable()
export class NotificationPreferenceService {
  private readonly logger = new Logger(NotificationPreferenceService.name);

  constructor(
    @InjectRepository(NotificationPreference)
    private readonly repo: Repository<NotificationPreference>,
  ) {}

  async getForUser(userId: string): Promise<NotificationPreference | null> {
    return this.repo.findOne({ where: { userId } });
  }

  async getOrDefault(userId: string): Promise<NotificationPreference> {
    const existing = await this.getForUser(userId);
    if (existing) return existing;
    // Virtual default row — NOT persisted. Used for read paths where
    // we just want opt-out flags without a write.
    return this.repo.create({
      userId,
      mutedAll: false,
      mutedEventTypes: [],
      quietHoursStart: null,
      quietHoursEnd: null,
    });
  }

  async update(
    userId: string,
    input: UpdatePreferenceInput,
  ): Promise<NotificationPreference> {
    let row = await this.getForUser(userId);
    if (!row) {
      row = this.repo.create({
        userId,
        mutedAll: false,
        mutedEventTypes: [],
        quietHoursStart: null,
        quietHoursEnd: null,
      });
    }

    if (input.mutedAll !== undefined) row.mutedAll = input.mutedAll;
    if (input.mutedEventTypes !== undefined) {
      row.mutedEventTypes = input.mutedEventTypes.slice();
    }
    if (input.quietHoursStart !== undefined) {
      row.quietHoursStart = input.quietHoursStart;
    }
    if (input.quietHoursEnd !== undefined) {
      row.quietHoursEnd = input.quietHoursEnd;
    }

    return this.repo.save(row);
  }

  /**
   * Pure predicate — does this user currently accept this eventType?
   * Caller is expected to pass the row from getOrDefault() so we never
   * hit the DB here.
   */
  isMuted(pref: NotificationPreference, eventType: string): boolean {
    if (pref.mutedAll) return true;
    return pref.mutedEventTypes.includes(eventType);
  }

  /**
   * Returns milliseconds to delay delivery if current UTC time falls
   * inside the user's quiet hours. 0 if no quiet hours set or we're
   * outside the window. We deliberately interpret quiet hours as UTC
   * for the first pass — timezone handling is a follow-up.
   */
  quietHoursDelayMs(
    pref: NotificationPreference,
    now: Date = new Date(),
  ): number {
    if (!pref.quietHoursStart || !pref.quietHoursEnd) return 0;
    const startMin = parseHM(pref.quietHoursStart);
    const endMin = parseHM(pref.quietHoursEnd);
    if (startMin === null || endMin === null) return 0;

    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const insideWindow =
      startMin <= endMin
        ? nowMin >= startMin && nowMin < endMin
        : nowMin >= startMin || nowMin < endMin;

    if (!insideWindow) return 0;

    const targetMin = endMin;
    let deltaMin = targetMin - nowMin;
    if (deltaMin <= 0) deltaMin += 24 * 60;
    return deltaMin * 60 * 1000;
  }
}

function parseHM(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
