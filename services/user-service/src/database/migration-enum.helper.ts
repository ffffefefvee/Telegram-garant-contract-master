import { QueryRunner } from 'typeorm';

/** PostgreSQL ENUM — TypeORM 0.3 has no TableEnum / createEnum on QueryRunner */
export async function createPgEnum(
  queryRunner: QueryRunner,
  name: string,
  values: string[],
): Promise<void> {
  const literals = values
    .map((v) => `'${v.replace(/'/g, "''")}'`)
    .join(', ');
  await queryRunner.query(`CREATE TYPE "${name}" AS ENUM(${literals})`);
}

export async function dropPgEnum(
  queryRunner: QueryRunner,
  name: string,
): Promise<void> {
  await queryRunner.query(`DROP TYPE IF EXISTS "${name}"`);
}
