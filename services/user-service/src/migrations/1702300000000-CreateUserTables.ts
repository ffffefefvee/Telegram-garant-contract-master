import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';
import { createPgEnum, dropPgEnum } from '../database/migration-enum.helper';

export class CreateUserTables1702300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await createPgEnum(queryRunner, 'user_status_enum', [
      'active',
      'inactive',
      'banned',
      'pending_verification',
    ]);
    await createPgEnum(queryRunner, 'user_type_enum', ['buyer', 'seller', 'arbitrator', 'admin']);
    await createPgEnum(queryRunner, 'session_type_enum', ['telegram', 'web', 'api']);
    await createPgEnum(queryRunner, 'language_code_enum', ['ru', 'en', 'es']);

    // Таблица users
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'telegram_id',
            type: 'bigint',
            isUnique: true,
            isNullable: true,
          },
          {
            name: 'telegram_username',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'telegram_first_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'telegram_last_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'telegram_language_code',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'email',
            type: 'varchar',
            length: '255',
            isUnique: true,
            isNullable: true,
          },
          {
            name: 'password_hash',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'user_status_enum',
            default: "'active'",
          },
          {
            name: 'roles',
            type: 'user_type_enum',
            isArray: true,
            default: "'{buyer}'",
          },
          {
            name: 'balance',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 0,
          },
          {
            name: 'reputation_score',
            type: 'decimal',
            precision: 5,
            scale: 2,
            default: 0,
          },
          {
            name: 'completed_deals',
            type: 'int',
            default: 0,
          },
          {
            name: 'cancelled_deals',
            type: 'int',
            default: 0,
          },
          {
            name: 'disputed_deals',
            type: 'int',
            default: 0,
          },
          {
            name: 'last_login_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'last_login_ip',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'settings',
            type: 'jsonb',
            default: "'{}'",
          },
          {
            name: 'metadata',
            type: 'jsonb',
            default: "'{}'",
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Индексы для users
    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_USERS_TELEGRAM_ID',
        columnNames: ['telegram_id'],
      }),
    );

    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_USERS_EMAIL',
        columnNames: ['email'],
      }),
    );

    await queryRunner.createIndex(
      'users',
      new TableIndex({
        name: 'IDX_USERS_STATUS',
        columnNames: ['status'],
      }),
    );

    // Таблица user_sessions
    await queryRunner.createTable(
      new Table({
        name: 'user_sessions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
          },
          {
            name: 'token',
            type: 'varchar',
            length: '500',
            isUnique: true,
          },
          {
            name: 'type',
            type: 'session_type_enum',
            default: "'telegram'",
          },
          {
            name: 'ip_address',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'user_agent',
            type: 'varchar',
            length: '500',
            isNullable: true,
          },
          {
            name: 'device_info',
            type: 'varchar',
            length: '50',
            isNullable: true,
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
          },
          {
            name: 'last_activity_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'revoked_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'revoke_reason',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            default: "'{}'",
          },
        ],
      }),
      true,
    );

    // Индексы для user_sessions
    await queryRunner.createIndex(
      'user_sessions',
      new TableIndex({
        name: 'IDX_USER_SESSIONS_USER_ID',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'user_sessions',
      new TableIndex({
        name: 'IDX_USER_SESSIONS_TOKEN',
        columnNames: ['token'],
      }),
    );

    await queryRunner.createIndex(
      'user_sessions',
      new TableIndex({
        name: 'IDX_USER_SESSIONS_EXPIRES_AT',
        columnNames: ['expires_at'],
      }),
    );

    await queryRunner.createIndex(
      'user_sessions',
      new TableIndex({
        name: 'IDX_USER_SESSIONS_IS_ACTIVE',
        columnNames: ['is_active'],
      }),
    );

    // Foreign key для user_sessions
    await queryRunner.createForeignKey(
      'user_sessions',
      new TableForeignKey({
        name: 'FK_USER_SESSIONS_USER',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Таблица language_preferences
    await queryRunner.createTable(
      new Table({
        name: 'language_preferences',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
          },
          {
            name: 'language_code',
            type: 'language_code_enum',
            default: "'ru'",
          },
          {
            name: 'context',
            type: 'varchar',
            length: '50',
            default: "'global'",
          },
          {
            name: 'usage_count',
            type: 'int',
            default: 0,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
        ],
      }),
      true,
    );

    // Индексы для language_preferences
    await queryRunner.createIndex(
      'language_preferences',
      new TableIndex({
        name: 'IDX_LANGUAGE_PREFERENCES_USER_ID',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'language_preferences',
      new TableIndex({
        name: 'IDX_LANGUAGE_PREFERENCES_LANGUAGE_CODE',
        columnNames: ['language_code'],
      }),
    );

    await queryRunner.createIndex(
      'language_preferences',
      new TableIndex({
        name: 'IDX_LANGUAGE_PREFERENCES_CONTEXT',
        columnNames: ['context'],
      }),
    );

    // Уникальный индекс на комбинацию user_id + context
    await queryRunner.createIndex(
      'language_preferences',
      new TableIndex({
        name: 'IDX_LANGUAGE_PREFERENCES_USER_CONTEXT',
        columnNames: ['user_id', 'context'],
        isUnique: true,
      }),
    );

    // Foreign key для language_preferences
    await queryRunner.createForeignKey(
      'language_preferences',
      new TableForeignKey({
        name: 'FK_LANGUAGE_PREFERENCES_USER',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Удаляем foreign keys
    await queryRunner.dropForeignKey('language_preferences', 'FK_LANGUAGE_PREFERENCES_USER');
    await queryRunner.dropForeignKey('user_sessions', 'FK_USER_SESSIONS_USER');

    // Удаляем таблицы
    await queryRunner.dropTable('language_preferences');
    await queryRunner.dropTable('user_sessions');
    await queryRunner.dropTable('users');

    await dropPgEnum(queryRunner, 'language_code_enum');
    await dropPgEnum(queryRunner, 'session_type_enum');
    await dropPgEnum(queryRunner, 'user_type_enum');
    await dropPgEnum(queryRunner, 'user_status_enum');
  }
}
