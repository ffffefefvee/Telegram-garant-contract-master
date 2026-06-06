import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';
import { createPgEnum, dropPgEnum } from '../database/migration-enum.helper';

export class CreateArbitrationTables1710000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await createPgEnum(queryRunner, 'dispute_status_enum', [
      'opened',
      'waiting_seller_response',
      'waiting_buyer_evidence',
      'waiting_seller_evidence',
      'pending_arbitrator',
      'under_review',
      'decision_made',
      'appeal_period',
      'appealed',
      'enforced',
      'closed',
    ]);
    await createPgEnum(queryRunner, 'dispute_type_enum', [
      'product_mismatch',
      'not_received',
      'not_working',
      'seller_no_response',
      'buyer_no_confirm',
      'refund_request',
      'fraud',
      'other',
    ]);
    await createPgEnum(queryRunner, 'dispute_side_enum', ['buyer', 'seller']);
    await createPgEnum(queryRunner, 'arbitration_decision_type_enum', [
      'full_refund_to_buyer',
      'partial_refund_to_buyer',
      'full_payment_to_seller',
      'partial_payment_to_seller',
      'split_funds',
      'refund_no_penalty',
    ]);
    await createPgEnum(queryRunner, 'evidence_type_enum', [
      'screenshot',
      'video',
      'file',
      'link',
      'text',
      'audio',
    ]);
    await createPgEnum(queryRunner, 'arbitrator_status_enum', [
      'active',
      'pending',
      'suspended',
      'rejected',
    ]);
    await createPgEnum(queryRunner, 'arbitration_event_type_enum', [
      'dispute_opened',
      'seller_response',
      'evidence_submitted',
      'arbitrator_assigned',
      'decision_made',
      'appeal_filed',
      'decision_enforced',
      'dispute_closed',
      'penalty_applied',
      'message_sent',
    ]);

    // === Таблица disputes ===
    await queryRunner.createTable(
      new Table({
        name: 'disputes',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'dispute_number',
            type: 'varchar',
            length: '50',
            isUnique: true,
          },
          {
            name: 'deal_id',
            type: 'uuid',
          },
          {
            name: 'opener_id',
            type: 'uuid',
          },
          {
            name: 'opened_by',
            type: 'enum',
            enumName: 'dispute_side_enum',
          },
          {
            name: 'type',
            type: 'enum',
            enumName: 'dispute_type_enum',
          },
          {
            name: 'status',
            type: 'enum',
            enumName: 'dispute_status_enum',
            default: "'opened'",
          },
          {
            name: 'reason',
            type: 'text',
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'claimed_amount',
            type: 'decimal',
            precision: 12,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'penalty_percent',
            type: 'decimal',
            precision: 5,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'arbitrator_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'arbitrator_assigned_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'seller_response_due_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'evidence_due_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'decision_due_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'appeal_due_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'resolved_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'closed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'resolution',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'penalty_amount',
            type: 'decimal',
            precision: 12,
            scale: 2,
            default: 0,
          },
          {
            name: 'arbitrator_fee',
            type: 'decimal',
            precision: 12,
            scale: 2,
            default: 0,
          },
          {
            name: 'platform_fee',
            type: 'decimal',
            precision: 12,
            scale: 2,
            default: 0,
          },
          {
            name: 'is_appealable',
            type: 'boolean',
            default: false,
          },
          {
            name: 'appealed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'appeal_arbitrator_id',
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
            name: 'metadata',
            type: 'jsonb',
            default: '{}',
          },
          {
            name: 'chat_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'decision_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'appeal_id',
            type: 'uuid',
            isNullable: true,
          },
        ],
      }),
    );

    // === Таблица evidence ===
    await queryRunner.createTable(
      new Table({
        name: 'evidence',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'dispute_id',
            type: 'uuid',
          },
          {
            name: 'submitted_by_id',
            type: 'uuid',
          },
          {
            name: 'type',
            type: 'enum',
            enumName: 'evidence_type_enum',
          },
          {
            name: 'description',
            type: 'text',
          },
          {
            name: 'content',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'file_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'file_path',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'file_type',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'file_size',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'file_hash',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'is_verified',
            type: 'boolean',
            default: false,
          },
          {
            name: 'verified_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'verified_by_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'view_count',
            type: 'int',
            default: 0,
          },
        ],
      }),
    );

    // === Таблица arbitration_chats ===
    await queryRunner.createTable(
      new Table({
        name: 'arbitration_chats',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'dispute_id',
            type: 'uuid',
            isUnique: true,
          },
          {
            name: 'last_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'last_message_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'buyer_unread_count',
            type: 'int',
            default: 0,
          },
          {
            name: 'seller_unread_count',
            type: 'int',
            default: 0,
          },
          {
            name: 'arbitrator_unread_count',
            type: 'int',
            default: 0,
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
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
        ],
      }),
    );

    // === Таблица arbitration_chat_messages ===
    await queryRunner.createTable(
      new Table({
        name: 'arbitration_chat_messages',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'chat_id',
            type: 'uuid',
          },
          {
            name: 'sender_id',
            type: 'uuid',
          },
          {
            name: 'content',
            type: 'text',
          },
          {
            name: 'attachments',
            type: 'text',
            isNullable: true,
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
            default: '{}',
          },
        ],
      }),
    );

    // === Таблица arbitration_decisions ===
    await queryRunner.createTable(
      new Table({
        name: 'arbitration_decisions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'dispute_id',
            type: 'uuid',
            isUnique: true,
          },
          {
            name: 'arbitrator_id',
            type: 'uuid',
          },
          {
            name: 'decision_type',
            type: 'enum',
            enumName: 'arbitration_decision_type_enum',
          },
          {
            name: 'reasoning',
            type: 'text',
          },
          {
            name: 'comments',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'refund_to_buyer',
            type: 'decimal',
            precision: 12,
            scale: 2,
          },
          {
            name: 'payment_to_seller',
            type: 'decimal',
            precision: 12,
            scale: 2,
          },
          {
            name: 'penalty_amount',
            type: 'decimal',
            precision: 12,
            scale: 2,
            default: 0,
          },
          {
            name: 'arbitrator_fee',
            type: 'decimal',
            precision: 12,
            scale: 2,
            default: 0,
          },
          {
            name: 'platform_fee',
            type: 'decimal',
            precision: 12,
            scale: 2,
            default: 0,
          },
          {
            name: 'penalty_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'is_appealable',
            type: 'boolean',
            default: false,
          },
          {
            name: 'appeal_period_hours',
            type: 'int',
            default: 24,
          },
          {
            name: 'is_enforced',
            type: 'boolean',
            default: false,
          },
          {
            name: 'enforced_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'enforced_by_id',
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
            name: 'metadata',
            type: 'jsonb',
            default: '{}',
          },
        ],
      }),
    );

    // === Таблица arbitration_events ===
    await queryRunner.createTable(
      new Table({
        name: 'arbitration_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'dispute_id',
            type: 'uuid',
          },
          {
            name: 'type',
            type: 'enum',
            enumName: 'arbitration_event_type_enum',
          },
          {
            name: 'description',
            type: 'text',
          },
          {
            name: 'actor_id',
            type: 'uuid',
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
            default: '{}',
          },
        ],
      }),
    );

    // === Таблица appeals ===
    await queryRunner.createTable(
      new Table({
        name: 'appeals',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'dispute_id',
            type: 'uuid',
            isUnique: true,
          },
          {
            name: 'appellant_id',
            type: 'uuid',
          },
          {
            name: 'original_decision_id',
            type: 'uuid',
          },
          {
            name: 'reason',
            type: 'text',
          },
          {
            name: 'new_evidence',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'deposit_amount',
            type: 'decimal',
            precision: 12,
            scale: 2,
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '50',
            default: "'pending'",
          },
          {
            name: 'reviewer_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'reviewer_assigned_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'reviewed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'review_decision',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'is_deposit_refunded',
            type: 'boolean',
            default: false,
          },
          {
            name: 'deposit_refunded_at',
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
            name: 'metadata',
            type: 'jsonb',
            default: '{}',
          },
        ],
      }),
    );

    // === Таблица deal_terms ===
    await queryRunner.createTable(
      new Table({
        name: 'deal_terms',
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
            isUnique: true,
          },
          {
            name: 'acceptance_criteria',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'required_evidence',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'study_period_hours',
            type: 'int',
            default: 24,
          },
          {
            name: 'custom_conditions',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'delivery_method',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'delivery_timeframe',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'warranty_terms',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'has_warranty',
            type: 'boolean',
            default: false,
          },
          {
            name: 'warranty_days',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'refund_policy',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'is_refundable',
            type: 'boolean',
            default: false,
          },
          {
            name: 'refund_days',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'additional_notes',
            type: 'text',
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
            name: 'metadata',
            type: 'jsonb',
            default: '{}',
          },
        ],
      }),
    );

    // === Таблица arbitration_settings ===
    await queryRunner.createTable(
      new Table({
        name: 'arbitration_settings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'key',
            type: 'varchar',
            length: '100',
            isUnique: true,
          },
          {
            name: 'value',
            type: 'text',
          },
          {
            name: 'description',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'value_type',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'metadata',
            type: 'jsonb',
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
            name: 'updated_by',
            type: 'uuid',
            isNullable: true,
          },
        ],
      }),
    );

    // === Таблица arbitrator_profiles ===
    await queryRunner.createTable(
      new Table({
        name: 'arbitrator_profiles',
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
            isUnique: true,
          },
          {
            name: 'status',
            type: 'enum',
            enumName: 'arbitrator_status_enum',
            default: "'pending'",
          },
          {
            name: 'rating',
            type: 'decimal',
            precision: 5,
            scale: 2,
            default: 0,
          },
          {
            name: 'total_cases',
            type: 'int',
            default: 0,
          },
          {
            name: 'completed_cases',
            type: 'int',
            default: 0,
          },
          {
            name: 'appealed_cases',
            type: 'int',
            default: 0,
          },
          {
            name: 'overturned_cases',
            type: 'int',
            default: 0,
          },
          {
            name: 'total_earned',
            type: 'decimal',
            precision: 12,
            scale: 2,
            default: 0,
          },
          {
            name: 'deposit_amount',
            type: 'decimal',
            precision: 12,
            scale: 2,
            default: 0,
          },
          {
            name: 'specialization',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'bio',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'languages',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'approved_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'approved_by_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'suspended_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'suspension_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'suspended_by_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'last_active_at',
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
            name: 'metadata',
            type: 'jsonb',
            default: '{}',
          },
        ],
      }),
    );

    // === Создаем индексы ===
    
    // Индексы для disputes
    await queryRunner.createIndex(
      'disputes',
      new TableIndex({
        name: 'IDX_disputes_deal_id',
        columnNames: ['deal_id'],
      }),
    );
    await queryRunner.createIndex(
      'disputes',
      new TableIndex({
        name: 'IDX_disputes_opener_id',
        columnNames: ['opener_id'],
      }),
    );
    await queryRunner.createIndex(
      'disputes',
      new TableIndex({
        name: 'IDX_disputes_status',
        columnNames: ['status'],
      }),
    );
    await queryRunner.createIndex(
      'disputes',
      new TableIndex({
        name: 'IDX_disputes_type',
        columnNames: ['type'],
      }),
    );
    await queryRunner.createIndex(
      'disputes',
      new TableIndex({
        name: 'IDX_disputes_created_at',
        columnNames: ['created_at'],
      }),
    );
    await queryRunner.createIndex(
      'disputes',
      new TableIndex({
        name: 'IDX_disputes_arbitrator_id',
        columnNames: ['arbitrator_id'],
      }),
    );

    // Индексы для evidence
    await queryRunner.createIndex(
      'evidence',
      new TableIndex({
        name: 'IDX_evidence_dispute_id',
        columnNames: ['dispute_id'],
      }),
    );
    await queryRunner.createIndex(
      'evidence',
      new TableIndex({
        name: 'IDX_evidence_submitted_by_id',
        columnNames: ['submitted_by_id'],
      }),
    );
    await queryRunner.createIndex(
      'evidence',
      new TableIndex({
        name: 'IDX_evidence_type',
        columnNames: ['type'],
      }),
    );
    await queryRunner.createIndex(
      'evidence',
      new TableIndex({
        name: 'IDX_evidence_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Индексы для arbitration_chats
    await queryRunner.createIndex(
      'arbitration_chats',
      new TableIndex({
        name: 'IDX_arbitration_chats_dispute_id',
        columnNames: ['dispute_id'],
      }),
    );

    // Индексы для arbitration_chat_messages
    await queryRunner.createIndex(
      'arbitration_chat_messages',
      new TableIndex({
        name: 'IDX_arbitration_chat_messages_chat_id',
        columnNames: ['chat_id'],
      }),
    );
    await queryRunner.createIndex(
      'arbitration_chat_messages',
      new TableIndex({
        name: 'IDX_arbitration_chat_messages_sender_id',
        columnNames: ['sender_id'],
      }),
    );
    await queryRunner.createIndex(
      'arbitration_chat_messages',
      new TableIndex({
        name: 'IDX_arbitration_chat_messages_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Индексы для arbitration_decisions
    await queryRunner.createIndex(
      'arbitration_decisions',
      new TableIndex({
        name: 'IDX_arbitration_decisions_dispute_id',
        columnNames: ['dispute_id'],
      }),
    );
    await queryRunner.createIndex(
      'arbitration_decisions',
      new TableIndex({
        name: 'IDX_arbitration_decisions_arbitrator_id',
        columnNames: ['arbitrator_id'],
      }),
    );
    await queryRunner.createIndex(
      'arbitration_decisions',
      new TableIndex({
        name: 'IDX_arbitration_decisions_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Индексы для arbitration_events
    await queryRunner.createIndex(
      'arbitration_events',
      new TableIndex({
        name: 'IDX_arbitration_events_dispute_id',
        columnNames: ['dispute_id'],
      }),
    );
    await queryRunner.createIndex(
      'arbitration_events',
      new TableIndex({
        name: 'IDX_arbitration_events_type',
        columnNames: ['type'],
      }),
    );
    await queryRunner.createIndex(
      'arbitration_events',
      new TableIndex({
        name: 'IDX_arbitration_events_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Индексы для appeals
    await queryRunner.createIndex(
      'appeals',
      new TableIndex({
        name: 'IDX_appeals_dispute_id',
        columnNames: ['dispute_id'],
      }),
    );
    await queryRunner.createIndex(
      'appeals',
      new TableIndex({
        name: 'IDX_appeals_appellant_id',
        columnNames: ['appellant_id'],
      }),
    );
    await queryRunner.createIndex(
      'appeals',
      new TableIndex({
        name: 'IDX_appeals_status',
        columnNames: ['status'],
      }),
    );
    await queryRunner.createIndex(
      'appeals',
      new TableIndex({
        name: 'IDX_appeals_created_at',
        columnNames: ['created_at'],
      }),
    );

    // Индексы для arbitrator_profiles
    await queryRunner.createIndex(
      'arbitrator_profiles',
      new TableIndex({
        name: 'IDX_arbitrator_profiles_user_id',
        columnNames: ['user_id'],
      }),
    );
    await queryRunner.createIndex(
      'arbitrator_profiles',
      new TableIndex({
        name: 'IDX_arbitrator_profiles_status',
        columnNames: ['status'],
      }),
    );
    await queryRunner.createIndex(
      'arbitrator_profiles',
      new TableIndex({
        name: 'IDX_arbitrator_profiles_rating',
        columnNames: ['rating'],
      }),
    );

    // === Создаем внешние ключи ===

    // Disputes foreign keys
    await queryRunner.createForeignKey(
      'disputes',
      new TableForeignKey({
        name: 'FK_disputes_deal',
        columnNames: ['deal_id'],
        referencedTableName: 'deals',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'disputes',
      new TableForeignKey({
        name: 'FK_disputes_opener',
        columnNames: ['opener_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'disputes',
      new TableForeignKey({
        name: 'FK_disputes_arbitrator',
        columnNames: ['arbitrator_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
    await queryRunner.createForeignKey(
      'disputes',
      new TableForeignKey({
        name: 'FK_disputes_appeal_arbitrator',
        columnNames: ['appeal_arbitrator_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Evidence foreign keys
    await queryRunner.createForeignKey(
      'evidence',
      new TableForeignKey({
        name: 'FK_evidence_dispute',
        columnNames: ['dispute_id'],
        referencedTableName: 'disputes',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'evidence',
      new TableForeignKey({
        name: 'FK_evidence_submitted_by',
        columnNames: ['submitted_by_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'evidence',
      new TableForeignKey({
        name: 'FK_evidence_verified_by',
        columnNames: ['verified_by_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // ArbitrationChat foreign keys
    await queryRunner.createForeignKey(
      'arbitration_chats',
      new TableForeignKey({
        name: 'FK_arbitration_chats_dispute',
        columnNames: ['dispute_id'],
        referencedTableName: 'disputes',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // ArbitrationChatMessage foreign keys
    await queryRunner.createForeignKey(
      'arbitration_chat_messages',
      new TableForeignKey({
        name: 'FK_arbitration_chat_messages_chat',
        columnNames: ['chat_id'],
        referencedTableName: 'arbitration_chats',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'arbitration_chat_messages',
      new TableForeignKey({
        name: 'FK_arbitration_chat_messages_sender',
        columnNames: ['sender_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // ArbitrationDecision foreign keys
    await queryRunner.createForeignKey(
      'arbitration_decisions',
      new TableForeignKey({
        name: 'FK_arbitration_decisions_dispute',
        columnNames: ['dispute_id'],
        referencedTableName: 'disputes',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'arbitration_decisions',
      new TableForeignKey({
        name: 'FK_arbitration_decisions_arbitrator',
        columnNames: ['arbitrator_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'arbitration_decisions',
      new TableForeignKey({
        name: 'FK_arbitration_decisions_enforced_by',
        columnNames: ['enforced_by_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // ArbitrationEvent foreign keys
    await queryRunner.createForeignKey(
      'arbitration_events',
      new TableForeignKey({
        name: 'FK_arbitration_events_dispute',
        columnNames: ['dispute_id'],
        referencedTableName: 'disputes',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'arbitration_events',
      new TableForeignKey({
        name: 'FK_arbitration_events_actor',
        columnNames: ['actor_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // Appeal foreign keys
    await queryRunner.createForeignKey(
      'appeals',
      new TableForeignKey({
        name: 'FK_appeals_dispute',
        columnNames: ['dispute_id'],
        referencedTableName: 'disputes',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'appeals',
      new TableForeignKey({
        name: 'FK_appeals_appellant',
        columnNames: ['appellant_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'appeals',
      new TableForeignKey({
        name: 'FK_appeals_original_decision',
        columnNames: ['original_decision_id'],
        referencedTableName: 'arbitration_decisions',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'appeals',
      new TableForeignKey({
        name: 'FK_appeals_reviewer',
        columnNames: ['reviewer_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // DealTerms foreign keys
    await queryRunner.createForeignKey(
      'deal_terms',
      new TableForeignKey({
        name: 'FK_deal_terms_deal',
        columnNames: ['deal_id'],
        referencedTableName: 'deals',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // ArbitratorProfile foreign keys
    await queryRunner.createForeignKey(
      'arbitrator_profiles',
      new TableForeignKey({
        name: 'FK_arbitrator_profiles_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createForeignKey(
      'arbitrator_profiles',
      new TableForeignKey({
        name: 'FK_arbitrator_profiles_approved_by',
        columnNames: ['approved_by_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
    await queryRunner.createForeignKey(
      'arbitrator_profiles',
      new TableForeignKey({
        name: 'FK_arbitrator_profiles_suspended_by',
        columnNames: ['suspended_by_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Удаляем таблицы в обратном порядке
    await queryRunner.dropTable('arbitrator_profiles');
    await queryRunner.dropTable('arbitration_settings');
    await queryRunner.dropTable('deal_terms');
    await queryRunner.dropTable('appeals');
    await queryRunner.dropTable('arbitration_events');
    await queryRunner.dropTable('arbitration_decisions');
    await queryRunner.dropTable('arbitration_chat_messages');
    await queryRunner.dropTable('arbitration_chats');
    await queryRunner.dropTable('evidence');
    await queryRunner.dropTable('disputes');

    // Удаляем ENUM типы
    await dropPgEnum(queryRunner, 'arbitrator_status_enum');
    await dropPgEnum(queryRunner, 'arbitration_event_type_enum');
    await dropPgEnum(queryRunner, 'evidence_type_enum');
    await dropPgEnum(queryRunner, 'arbitration_decision_type_enum');
    await dropPgEnum(queryRunner, 'dispute_side_enum');
    await dropPgEnum(queryRunner, 'dispute_type_enum');
    await dropPgEnum(queryRunner, 'dispute_status_enum');
  }
}
