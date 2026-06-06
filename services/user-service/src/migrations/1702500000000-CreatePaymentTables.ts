import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';
import { createPgEnum, dropPgEnum } from '../database/migration-enum.helper';

export class CreatePaymentTables1702500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await createPgEnum(queryRunner, 'payment_type_enum', [
      'deposit',
      'deal_payment',
      'refund',
      'withdraw',
      'commission',
      'arbitration_fee',
    ]);
    await createPgEnum(queryRunner, 'payment_status_enum', [
      'pending',
      'processing',
      'completed',
      'expired',
      'cancelled',
      'failed',
      'refunded',
    ]);
    await createPgEnum(queryRunner, 'payment_method_enum', [
      'cryptomus',
      'card',
      'e_wallet',
      'crypto',
      'balance',
    ]);

    // Таблица payments
    await queryRunner.createTable(
      new Table({
        name: 'payments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'transaction_id',
            type: 'varchar',
            length: '100',
            isUnique: true,
          },
          {
            name: 'type',
            type: 'payment_type_enum',
          },
          {
            name: 'status',
            type: 'payment_status_enum',
            default: "'pending'",
          },
          {
            name: 'user_id',
            type: 'uuid',
          },
          {
            name: 'deal_id',
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
            type: 'varchar',
            length: '10',
            default: "'RUB'",
          },
          {
            name: 'crypto_amount',
            type: 'decimal',
            precision: 12,
            scale: 8,
            isNullable: true,
          },
          {
            name: 'crypto_currency',
            type: 'varchar',
            length: '10',
            isNullable: true,
          },
          {
            name: 'payment_method',
            type: 'payment_method_enum',
            default: "'cryptomus'",
          },
          {
            name: 'fee',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 0,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'payment_url',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'wallet_address',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'cryptomus_data',
            type: 'jsonb',
            default: "'{}'",
          },
          {
            name: 'paid_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'failure_reason',
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
            name: 'refunded_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'refunded_by',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'ip_address',
            type: 'varchar',
            length: '45',
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

    // Индексы для payments
    await queryRunner.createIndex(
      'payments',
      new TableIndex({
        name: 'IDX_PAYMENTS_USER_ID',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'payments',
      new TableIndex({
        name: 'IDX_PAYMENTS_DEAL_ID',
        columnNames: ['deal_id'],
      }),
    );

    await queryRunner.createIndex(
      'payments',
      new TableIndex({
        name: 'IDX_PAYMENTS_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'payments',
      new TableIndex({
        name: 'IDX_PAYMENTS_TYPE',
        columnNames: ['type'],
      }),
    );

    await queryRunner.createIndex(
      'payments',
      new TableIndex({
        name: 'IDX_PAYMENTS_CREATED_AT',
        columnNames: ['created_at'],
      }),
    );

    // Foreign keys для payments
    await queryRunner.createForeignKey(
      'payments',
      new TableForeignKey({
        name: 'FK_PAYMENTS_USER',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createForeignKey(
      'payments',
      new TableForeignKey({
        name: 'FK_PAYMENTS_DEAL',
        columnNames: ['deal_id'],
        referencedTableName: 'deals',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Таблица commission_rates
    await queryRunner.createTable(
      new Table({
        name: 'commission_rates',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'type',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'rate',
            type: 'decimal',
            precision: 5,
            scale: 2,
          },
          {
            name: 'min_amount',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 0,
          },
          {
            name: 'max_amount',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 0,
          },
          {
            name: 'fixed_fee',
            type: 'decimal',
            precision: 10,
            scale: 2,
            default: 0,
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'description',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'valid_from',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'valid_to',
            type: 'timestamp',
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
            name: 'created_by',
            type: 'uuid',
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

    // Индексы для commission_rates
    await queryRunner.createIndex(
      'commission_rates',
      new TableIndex({
        name: 'IDX_COMMISSION_RATES_TYPE',
        columnNames: ['type'],
      }),
    );

    await queryRunner.createIndex(
      'commission_rates',
      new TableIndex({
        name: 'IDX_COMMISSION_RATES_IS_ACTIVE',
        columnNames: ['is_active'],
      }),
    );

    // Таблица currency_rates
    await queryRunner.createTable(
      new Table({
        name: 'currency_rates',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'from_currency',
            type: 'varchar',
            length: '10',
          },
          {
            name: 'to_currency',
            type: 'varchar',
            length: '10',
          },
          {
            name: 'rate',
            type: 'decimal',
            precision: 18,
            scale: 8,
          },
          {
            name: 'inverse_rate',
            type: 'decimal',
            precision: 18,
            scale: 8,
            default: 1,
          },
          {
            name: 'source',
            type: 'varchar',
            length: '50',
            default: "'manual'",
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'valid_at',
            type: 'timestamp',
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

    // Индексы для currency_rates
    await queryRunner.createIndex(
      'currency_rates',
      new TableIndex({
        name: 'IDX_CURRENCY_RATES_FROM_TO',
        columnNames: ['from_currency', 'to_currency'],
      }),
    );

    await queryRunner.createIndex(
      'currency_rates',
      new TableIndex({
        name: 'IDX_CURRENCY_RATES_SOURCE',
        columnNames: ['source'],
      }),
    );

    await queryRunner.createIndex(
      'currency_rates',
      new TableIndex({
        name: 'IDX_CURRENCY_RATES_CREATED_AT',
        columnNames: ['created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Удаляем foreign keys
    await queryRunner.dropForeignKey('payments', 'FK_PAYMENTS_DEAL');
    await queryRunner.dropForeignKey('payments', 'FK_PAYMENTS_USER');

    // Удаляем таблицы
    await queryRunner.dropTable('currency_rates');
    await queryRunner.dropTable('commission_rates');
    await queryRunner.dropTable('payments');

    // Удаляем enum типы
    await dropPgEnum(queryRunner, 'payment_method_enum');
    await dropPgEnum(queryRunner, 'payment_status_enum');
    await dropPgEnum(queryRunner, 'payment_type_enum');
  }
}
