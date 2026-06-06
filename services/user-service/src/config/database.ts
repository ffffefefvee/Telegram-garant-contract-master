import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';

export const databaseConfig = {
  type: 'postgres' as const,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'garant_user',
  password: process.env.DB_PASSWORD || 'garant_pass',
  database: process.env.DB_NAME || 'garant_db',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  // synchronize is opt-in via DB_SYNCHRONIZE=true. Used by the local e2e
  // runner (scripts/local-e2e.sh) which boots a throwaway database and
  // wants entity-driven schema without running migrations. Never set this
  // to true in production — it auto-applies entity diffs to the live DB.
  synchronize: process.env.DB_SYNCHRONIZE === 'true',
  logging: process.env.NODE_ENV === 'development',
  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
};

export const getDatabaseConfig = (): TypeOrmModuleOptions => ({
  ...databaseConfig,
});

/**
 * DataSource exported for the TypeORM CLI (migration:run, migration:generate,
 * migration:revert). The CLI requires a default export of a DataSource
 * instance — without this export the migration scripts in package.json fail
 * with "Given data source file must contain export of a DataSource instance".
 */
const dataSource = new DataSource(databaseConfig as DataSourceOptions);
export default dataSource;
