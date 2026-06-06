import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';
import { createPgEnum, dropPgEnum } from '../database/migration-enum.helper';

export class CreateDealTables1702400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await createPgEnum(queryRunner, 'deal_type_enum', ['physical', 'digital', 'service', 'rent']);
    await createPgEnum(queryRunner, 'deal_status_enum', [
      'draft',
      'pending_acceptance',
      'pending_payment',
      'in_progress',
      'pending_confirmation',
      'completed',
      'cancelled',
      'refunded',
      'disputed',
      'dispute_resolved',
      'frozen',
    ]);
    await createPgEnum(queryRunner, 'currency_enum', ['RUB', 'USD', 'EUR', 'TON', 'USDT', 'BTC']);
    await createPgEnum(queryRunner, 'message_type_enum', ['text', 'system', 'notification']);
    await createPgEnum(queryRunner, 'attachment_type_enum', [
      'image',
      'document',
      'video',
      'audio',
      'link',
      'voice',
    ]);
    await createPgEnum(queryRunner, 'invite_status_enum', [
      'pending',
      'accepted',
      'rejected',
      'expired',
      'cancelled',
    ]);
    await createPgEnum(queryRunner, 'deal_event_type_enum', [
      'deal_created',
      'counterparty_invited',
      'counterparty_accepted',
      'counterparty_rejected',
      'payment_received',
      'seller_started',
      'buyer_confirmed',
      'buyer_rejected',
      'dispute_opened',
      'dispute_resolved',
      'deal_cancelled',
      'deal_refunded',
      'message_sent',
      'attachment_added',
    ]);

    // Таблица deals
    await queryRunner.createTable(
      new Table({
        name: 'deals',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'deal_number',
            type: 'varchar',
            length: '50',
            isUnique: true,
          },
          {
            name: 'type',
            type: 'deal_type_enum',
          },
          {
            name: 'status',
            type: 'deal_status_enum',
            default: "'draft'",
          },
          {
            name: 'buyer_id',
            type: 'uuid',
          },
          {
            name: 'seller_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'amount',
            type: 'decimal',
            precision: 12,
            scale: 2,
          },
          {
            name: 'currency',
            type: 'currency_enum',
            default: "'RUB'",
          },
          {
            name: 'commission_rate',
            type: 'decimal',
            precision: 5,
            scale: 2,
            default: 0,
          },
          {
            name: 'commission_amount',
            type: 'decimal',
            precision: 12,
            scale: 2,
            default: 0,
          },
          {
            name: 'description',
            type: 'text',
          },
          {
            name: 'terms',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'deadline',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'title',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            default: "'{}'",
          },
          {
            name: 'is_public',
            type: 'boolean',
            default: false,
          },
          {
            name: 'public_slug',
            type: 'varchar',
            length: '255',
            isNullable: true,
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
            name: 'accepted_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'paid_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'completed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'cancelled_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'disputed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'arbitrator_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'cancel_reason',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'refund_reason',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Индексы для deals
    await queryRunner.createIndex(
      'deals',
      new TableIndex({
        name: 'IDX_DEALS_BUYER_ID',
        columnNames: ['buyer_id'],
      }),
    );

    await queryRunner.createIndex(
      'deals',
      new TableIndex({
        name: 'IDX_DEALS_SELLER_ID',
        columnNames: ['seller_id'],
      }),
    );

    await queryRunner.createIndex(
      'deals',
      new TableIndex({
        name: 'IDX_DEALS_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'deals',
      new TableIndex({
        name: 'IDX_DEALS_TYPE',
        columnNames: ['type'],
      }),
    );

    await queryRunner.createIndex(
      'deals',
      new TableIndex({
        name: 'IDX_DEALS_CREATED_AT',
        columnNames: ['created_at'],
      }),
    );

    // Foreign keys для deals
    await queryRunner.createForeignKey(
      'deals',
      new TableForeignKey({
        name: 'FK_DEALS_BUYER',
        columnNames: ['buyer_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createForeignKey(
      'deals',
      new TableForeignKey({
        name: 'FK_DEALS_SELLER',
        columnNames: ['seller_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Таблица deal_messages
    await queryRunner.createTable(
      new Table({
        name: 'deal_messages',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'deal_id',
            type: 'uuid',
          },
          {
            name: 'sender_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'type',
            type: 'message_type_enum',
            default: "'text'",
          },
          {
            name: 'content',
            type: 'text',
          },
          {
            name: 'is_edited',
            type: 'boolean',
            default: false,
          },
          {
            name: 'edited_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'read_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'is_deleted',
            type: 'boolean',
            default: false,
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
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

    // Индексы для deal_messages
    await queryRunner.createIndex(
      'deal_messages',
      new TableIndex({
        name: 'IDX_DEAL_MESSAGES_DEAL_ID',
        columnNames: ['deal_id'],
      }),
    );

    await queryRunner.createIndex(
      'deal_messages',
      new TableIndex({
        name: 'IDX_DEAL_MESSAGES_SENDER_ID',
        columnNames: ['sender_id'],
      }),
    );

    await queryRunner.createIndex(
      'deal_messages',
      new TableIndex({
        name: 'IDX_DEAL_MESSAGES_CREATED_AT',
        columnNames: ['created_at'],
      }),
    );

    // Foreign keys для deal_messages
    await queryRunner.createForeignKey(
      'deal_messages',
      new TableForeignKey({
        name: 'FK_DEAL_MESSAGES_DEAL',
        columnNames: ['deal_id'],
        referencedTableName: 'deals',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'deal_messages',
      new TableForeignKey({
        name: 'FK_DEAL_MESSAGES_SENDER',
        columnNames: ['sender_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Таблица deal_attachments
    await queryRunner.createTable(
      new Table({
        name: 'deal_attachments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'deal_id',
            type: 'uuid',
          },
          {
            name: 'uploaded_by_id',
            type: 'uuid',
          },
          {
            name: 'type',
            type: 'attachment_type_enum',
          },
          {
            name: 'url',
            type: 'varchar',
            length: '500',
          },
          {
            name: 'filename',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'mime_type',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'size',
            type: 'bigint',
            default: 0,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'is_image',
            type: 'boolean',
            default: false,
          },
          {
            name: 'width',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'height',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'duration',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'is_deleted',
            type: 'boolean',
            default: false,
          },
          {
            name: 'deleted_at',
            type: 'timestamp',
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

    // Индексы для deal_attachments
    await queryRunner.createIndex(
      'deal_attachments',
      new TableIndex({
        name: 'IDX_DEAL_ATTACHMENTS_DEAL_ID',
        columnNames: ['deal_id'],
      }),
    );

    await queryRunner.createIndex(
      'deal_attachments',
      new TableIndex({
        name: 'IDX_DEAL_ATTACHMENTS_UPLOADED_BY_ID',
        columnNames: ['uploaded_by_id'],
      }),
    );

    await queryRunner.createIndex(
      'deal_attachments',
      new TableIndex({
        name: 'IDX_DEAL_ATTACHMENTS_TYPE',
        columnNames: ['type'],
      }),
    );

    // Foreign keys для deal_attachments
    await queryRunner.createForeignKey(
      'deal_attachments',
      new TableForeignKey({
        name: 'FK_DEAL_ATTACHMENTS_DEAL',
        columnNames: ['deal_id'],
        referencedTableName: 'deals',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'deal_attachments',
      new TableForeignKey({
        name: 'FK_DEAL_ATTACHMENTS_UPLOADED_BY',
        columnNames: ['uploaded_by_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    // Таблица deal_invites
    await queryRunner.createTable(
      new Table({
        name: 'deal_invites',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'deal_id',
            type: 'uuid',
          },
          {
            name: 'invited_user_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'invited_user_telegram_id',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'invite_token',
            type: 'varchar',
            length: '100',
          },
          {
            name: 'invite_url',
            type: 'varchar',
            length: '500',
          },
          {
            name: 'status',
            type: 'invite_status_enum',
            default: "'pending'",
          },
          {
            name: 'message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
          },
          {
            name: 'accepted_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'rejected_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'rejected_by',
            type: 'uuid',
            isNullable: true,
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
            name: 'view_count',
            type: 'int',
            default: 0,
          },
          {
            name: 'last_viewed_at',
            type: 'timestamp',
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

    // Индексы для deal_invites
    await queryRunner.createIndex(
      'deal_invites',
      new TableIndex({
        name: 'IDX_DEAL_INVITES_DEAL_ID',
        columnNames: ['deal_id'],
      }),
    );

    await queryRunner.createIndex(
      'deal_invites',
      new TableIndex({
        name: 'IDX_DEAL_INVITES_INVITED_USER_ID',
        columnNames: ['invited_user_id'],
      }),
    );

    await queryRunner.createIndex(
      'deal_invites',
      new TableIndex({
        name: 'IDX_DEAL_INVITES_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'deal_invites',
      new TableIndex({
        name: 'IDX_DEAL_INVITES_EXPIRES_AT',
        columnNames: ['expires_at'],
      }),
    );

    // Unique индекс на invite_token
    await queryRunner.createIndex(
      'deal_invites',
      new TableIndex({
        name: 'IDX_DEAL_INVITES_TOKEN',
        columnNames: ['invite_token'],
        isUnique: true,
      }),
    );

    // Foreign keys для deal_invites
    await queryRunner.createForeignKey(
      'deal_invites',
      new TableForeignKey({
        name: 'FK_DEAL_INVITES_DEAL',
        columnNames: ['deal_id'],
        referencedTableName: 'deals',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'deal_invites',
      new TableForeignKey({
        name: 'FK_DEAL_INVITES_INVITED_USER',
        columnNames: ['invited_user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Таблица deal_events
    await queryRunner.createTable(
      new Table({
        name: 'deal_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'deal_id',
            type: 'uuid',
          },
          {
            name: 'type',
            type: 'deal_event_type_enum',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
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
            name: 'ip_address',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'user_agent',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Индексы для deal_events
    await queryRunner.createIndex(
      'deal_events',
      new TableIndex({
        name: 'IDX_DEAL_EVENTS_DEAL_ID',
        columnNames: ['deal_id'],
      }),
    );

    await queryRunner.createIndex(
      'deal_events',
      new TableIndex({
        name: 'IDX_DEAL_EVENTS_TYPE',
        columnNames: ['type'],
      }),
    );

    await queryRunner.createIndex(
      'deal_events',
      new TableIndex({
        name: 'IDX_DEAL_EVENTS_CREATED_AT',
        columnNames: ['created_at'],
      }),
    );

    await queryRunner.createIndex(
      'deal_events',
      new TableIndex({
        name: 'IDX_DEAL_EVENTS_USER_ID',
        columnNames: ['user_id'],
      }),
    );

    // Foreign keys для deal_events
    await queryRunner.createForeignKey(
      'deal_events',
      new TableForeignKey({
        name: 'FK_DEAL_EVENTS_DEAL',
        columnNames: ['deal_id'],
        referencedTableName: 'deals',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'deal_events',
      new TableForeignKey({
        name: 'FK_DEAL_EVENTS_USER',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Удаляем foreign keys
    await queryRunner.dropForeignKey('deal_events', 'FK_DEAL_EVENTS_USER');
    await queryRunner.dropForeignKey('deal_events', 'FK_DEAL_EVENTS_DEAL');
    await queryRunner.dropForeignKey('deal_invites', 'FK_DEAL_INVITES_INVITED_USER');
    await queryRunner.dropForeignKey('deal_invites', 'FK_DEAL_INVITES_DEAL');
    await queryRunner.dropForeignKey('deal_attachments', 'FK_DEAL_ATTACHMENTS_UPLOADED_BY');
    await queryRunner.dropForeignKey('deal_attachments', 'FK_DEAL_ATTACHMENTS_DEAL');
    await queryRunner.dropForeignKey('deal_messages', 'FK_DEAL_MESSAGES_SENDER');
    await queryRunner.dropForeignKey('deal_messages', 'FK_DEAL_MESSAGES_DEAL');
    await queryRunner.dropForeignKey('deals', 'FK_DEALS_SELLER');
    await queryRunner.dropForeignKey('deals', 'FK_DEALS_BUYER');

    // Удаляем таблицы
    await queryRunner.dropTable('deal_events');
    await queryRunner.dropTable('deal_invites');
    await queryRunner.dropTable('deal_attachments');
    await queryRunner.dropTable('deal_messages');
    await queryRunner.dropTable('deals');

    // Удаляем enum типы
    await dropPgEnum(queryRunner, 'deal_event_type_enum');
    await dropPgEnum(queryRunner, 'invite_status_enum');
    await dropPgEnum(queryRunner, 'attachment_type_enum');
    await dropPgEnum(queryRunner, 'message_type_enum');
    await dropPgEnum(queryRunner, 'currency_enum');
    await dropPgEnum(queryRunner, 'deal_status_enum');
    await dropPgEnum(queryRunner, 'deal_type_enum');
  }
}
