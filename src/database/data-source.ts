import 'dotenv/config';
import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from '../users/user.entity';
import { UsersBaseline1790553600000 } from './migrations/1790553600000-UsersBaseline';
import { MvpDataModel1790553601000 } from './migrations/1790553601000-MvpDataModel';

import { EmailAuthentication1790640000000 } from './migrations/1790640000000-EmailAuthentication';
import { CloseArchivedMemberships1790726400000 } from './migrations/1790726400000-CloseArchivedMemberships';
import { ImmutableRuleHistory1790812800000 } from './migrations/1790812800000-ImmutableRuleHistory';
import { AttemptResultSnapshot1790899200000 } from './migrations/1790899200000-AttemptResultSnapshot';

export function databaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DATABASE_HOST ?? '127.0.0.1',
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    entities: [User],
    migrations: [UsersBaseline1790553600000, MvpDataModel1790553601000, EmailAuthentication1790640000000, CloseArchivedMemberships1790726400000, ImmutableRuleHistory1790812800000, AttemptResultSnapshot1790899200000],
    migrationsTableName: 'schema_migrations',
    migrationsTransactionMode: 'all',
    synchronize: false,
    migrationsRun: false,
    // PostgreSQL 17 provides gen_random_uuid(); no extension privilege needed.
    uuidExtension: 'pgcrypto',
    installExtensions: false,
  };
}

export default new DataSource(databaseOptions());
