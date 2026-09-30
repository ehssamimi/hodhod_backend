import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adopt the existing development table without deleting or rewriting users. */
export class UsersBaseline1790553600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(254) NOT NULL UNIQUE,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    const table = await queryRunner.getTable('users');
    const id = table?.findColumnByName('id');
    const email = table?.findColumnByName('email');
    const createdAt = table?.findColumnByName('createdAt');
    if (!id?.isPrimary || id.type !== 'uuid' ||
        email?.type !== 'character varying' || email.length !== '254' || email.isNullable ||
        !table?.uniques.some(key => key.columnNames.length === 1 && key.columnNames[0] === 'email') ||
        createdAt?.type !== 'timestamp with time zone' || createdAt.isNullable) {
      throw new Error('Existing users table differs from the supported baseline; review before migrating.');
    }
  }

  async down(): Promise<void> {
    // Deliberately retain users: this table may predate the migration history.
    // Reapplying the baseline safely adopts the retained table.
  }
}
