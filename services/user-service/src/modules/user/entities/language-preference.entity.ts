import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  Index,
  JoinColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

export enum LanguageCode {
  RU = 'ru',
  EN = 'en',
  ES = 'es',
}

export const SUPPORTED_LANGUAGES: LanguageCode[] = [
  LanguageCode.RU,
  LanguageCode.EN,
  LanguageCode.ES,
];

@Entity('language_preferences')
@Unique(['user', 'context'])
@Index(['userId'])
@Index(['languageCode'])
export class LanguagePreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.languagePreferences, {
    onDelete: 'CASCADE',
    eager: true,
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({
    type: 'enum',
    enum: LanguageCode,
    default: LanguageCode.RU,
  })
  languageCode: LanguageCode;

  @Column({ type: 'varchar', length: 50, default: 'global' })
  @Index()
  context: string;

  @Column({ type: 'int', default: 0 })
  usageCount: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  // Статические методы для работы с языками
  static getDefaultLanguage(): LanguageCode {
    return LanguageCode.RU;
  }

  static fromTelegramCode(code: string | undefined): LanguageCode {
    if (!code) {
      return this.getDefaultLanguage();
    }

    const normalizedCode = code.toLowerCase().split('-')[0];

    switch (normalizedCode) {
      case 'ru':
      case 'uk':
      case 'be':
      case 'kk':
        return LanguageCode.RU;
      case 'es':
      case 'ca':
        return LanguageCode.ES;
      case 'en':
      default:
        return LanguageCode.EN;
    }
  }

  static isSupported(code: string): boolean {
    const normalizedCode = code.toLowerCase().split('-')[0];
    return Object.values(LanguageCode).includes(normalizedCode as LanguageCode);
  }
}
