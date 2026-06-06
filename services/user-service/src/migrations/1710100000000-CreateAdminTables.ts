import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateAdminTables1710100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // === Таблица admin_profiles ===
    await queryRunner.createTable(
      new Table({
        name: 'admin_profiles',
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
            name: 'role',
            type: 'varchar',
            length: '50',
            default: "'admin'",
          },
          {
            name: 'is_active',
            type: 'boolean',
            default: true,
          },
          {
            name: 'permissions',
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
        ],
      }),
    );

    // === Таблица admin_logs ===
    await queryRunner.createTable(
      new Table({
        name: 'admin_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'admin_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'action',
            type: 'varchar',
            length: '100',
          },
          {
            name: 'target_id',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'description',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'ip_address',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'details',
            type: 'jsonb',
            default: '{}',
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );

    // === Индексы ===
    await queryRunner.createIndex(
      'admin_profiles',
      new TableIndex({ name: 'IDX_admin_profiles_user_id', columnNames: ['user_id'] }),
    );

    await queryRunner.createIndex(
      'admin_logs',
      new TableIndex({ name: 'IDX_admin_logs_admin_id', columnNames: ['admin_id'] }),
    );
    await queryRunner.createIndex(
      'admin_logs',
      new TableIndex({ name: 'IDX_admin_logs_action', columnNames: ['action'] }),
    );
    await queryRunner.createIndex(
      'admin_logs',
      new TableIndex({ name: 'IDX_admin_logs_created_at', columnNames: ['created_at'] }),
    );

    // === Внешние ключи ===
    await queryRunner.createForeignKey(
      'admin_profiles',
      new TableForeignKey({
        name: 'FK_admin_profiles_user',
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Добавим колонки ban_reason и banned_at в users (если их нет)
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason VARCHAR(255);
    `);
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('admin_logs');
    await queryRunner.dropTable('admin_profiles');
    
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS ban_reason`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS banned_at`);
  }
}
