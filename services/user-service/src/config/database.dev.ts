import { TypeOrmModuleOptions } from '@nestjs/typeorm';

// Конфигурация для локальной разработки с SQLite
export const databaseConfigSqlite = {
  type: 'sqlite',
  database: ':memory:',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: true, // Автоматическое создание таблиц (только для dev!)
  logging: true,
};

// Конфигурация для PostgreSQL (локальная)
export const databaseConfigPostgres = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'garant_user',
  password: process.env.DB_PASSWORD || 'garant_pass',
  database: process.env.DB_NAME || 'garant_db',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
};

// Автоматический выбор конфигурации
export const getDatabaseConfig = (): TypeOrmModuleOptions => {
  const useSqlite = process.env.DB_USE_SQLITE === 'true';
  
  if (useSqlite) {
    return databaseConfigSqlite as TypeOrmModuleOptions;
  }
  
  return databaseConfigPostgres as TypeOrmModuleOptions;
};
