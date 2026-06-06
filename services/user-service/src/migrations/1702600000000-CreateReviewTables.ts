import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';
import { createPgEnum, dropPgEnum } from '../database/migration-enum.helper';

export class CreateReviewTables1702600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await createPgEnum(queryRunner, 'review_type_enum', ['buyer_to_seller', 'seller_to_buyer']);
    await createPgEnum(queryRunner, 'review_status_enum', ['draft', 'published', 'hidden', 'deleted']);
    await createPgEnum(queryRunner, 'reputation_event_type_enum', [
      'review_received',
      'deal_completed',
      'deal_cancelled',
      'dispute_opened',
      'dispute_won',
      'dispute_lost',
      'rule_violation',
      'verification_completed',
      'bonus',
      'penalty',
    ]);

    // Таблица reviews
    await queryRunner.createTable(
      new Table({
        name: 'reviews',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'author_id',
            type: 'uuid',
          },
          {
            name: 'target_id',
            type: 'uuid',
          },
          {
            name: 'deal_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'type',
            type: 'review_type_enum',
          },
          {
            name: 'rating',
            type: 'int',
          },
          {
            name: 'comment',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'review_status_enum',
            default: "'published'",
          },
          {
            name: 'is_anonymous',
            type: 'boolean',
            default: false,
          },
          {
            name: 'ratings',
            type: 'jsonb',
            default: "'{}'",
          },
          {
            name: 'helpful_count',
            type: 'int',
            default: 0,
          },
          {
            name: 'not_helpful_count',
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
            name: 'published_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'hidden_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'hide_reason',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'hidden_by',
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

    // Индексы для reviews
    await queryRunner.createIndex(
      'reviews',
      new TableIndex({
        name: 'IDX_REVIEWS_AUTHOR_ID',
        columnNames: ['author_id'],
      }),
    );

    await queryRunner.createIndex(
      'reviews',
      new TableIndex({
        name: 'IDX_REVIEWS_TARGET_ID',
        columnNames: ['target_id'],
      }),
    );

    await queryRunner.createIndex(
      'reviews',
      new TableIndex({
        name: 'IDX_REVIEWS_DEAL_ID',
        columnNames: ['deal_id'],
      }),
    );

    await queryRunner.createIndex(
      'reviews',
      new TableIndex({
        name: 'IDX_REVIEWS_RATING',
        columnNames: ['rating'],
      }),
    );

    await queryRunner.createIndex(
      'reviews',
      new TableIndex({
        name: 'IDX_REVIEWS_CREATED_AT',
        columnNames: ['created_at'],
      }),
    );

    // Уникальный индекс на deal_id + author_id
    await queryRunner.createIndex(
      'reviews',
      new TableIndex({
        name: 'IDX_REVIEWS_DEAL_AUTHOR',
        columnNames: ['deal_id', 'author_id'],
        isUnique: true,
      }),
    );

    // Foreign keys для reviews
    await queryRunner.createForeignKey(
      'reviews',
      new TableForeignKey({
        name: 'FK_REVIEWS_AUTHOR',
        columnNames: ['author_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createForeignKey(
      'reviews',
      new TableForeignKey({
        name: 'FK_REVIEWS_TARGET',
        columnNames: ['target_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );

    await queryRunner.createForeignKey(
      'reviews',
      new TableForeignKey({
        name: 'FK_REVIEWS_DEAL',
        columnNames: ['deal_id'],
        referencedTableName: 'deals',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Таблица reputation_scores
    await queryRunner.createTable(
      new Table({
        name: 'reputation_scores',
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
            name: 'deal_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'type',
            type: 'reputation_event_type_enum',
          },
          {
            name: 'score_delta',
            type: 'int',
          },
          {
            name: 'score_before',
            type: 'int',
          },
          {
            name: 'score_after',
            type: 'int',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'reason',
            type: 'text',
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

    // Индексы для reputation_scores
    await queryRunner.createIndex(
      'reputation_scores',
      new TableIndex({
        name: 'IDX_REPUTATION_SCORES_USER_ID',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'reputation_scores',
      new TableIndex({
        name: 'IDX_REPUTATION_SCORES_TYPE',
        columnNames: ['type'],
      }),
    );

    await queryRunner.createIndex(
      'reputation_scores',
      new TableIndex({
        name: 'IDX_REPUTATION_SCORES_CREATED_AT',
        columnNames: ['created_at'],
      }),
    );

    // Foreign keys для reputation_scores
    await queryRunner.createForeignKey(
      'reputation_scores',
      new TableForeignKey({
        name: 'FK_REPUTATION_SCORES_USER',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'reputation_scores',
      new TableForeignKey({
        name: 'FK_REPUTATION_SCORES_DEAL',
        columnNames: ['deal_id'],
        referencedTableName: 'deals',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Удаляем foreign keys
    await queryRunner.dropForeignKey('reputation_scores', 'FK_REPUTATION_SCORES_DEAL');
    await queryRunner.dropForeignKey('reputation_scores', 'FK_REPUTATION_SCORES_USER');
    await queryRunner.dropForeignKey('reviews', 'FK_REVIEWS_DEAL');
    await queryRunner.dropForeignKey('reviews', 'FK_REVIEWS_TARGET');
    await queryRunner.dropForeignKey('reviews', 'FK_REVIEWS_AUTHOR');

    // Удаляем таблицы
    await queryRunner.dropTable('reputation_scores');
    await queryRunner.dropTable('reviews');

    // Удаляем enum типы
    await dropPgEnum(queryRunner, 'reputation_event_type_enum');
    await dropPgEnum(queryRunner, 'review_status_enum');
    await dropPgEnum(queryRunner, 'review_type_enum');
  }
}
