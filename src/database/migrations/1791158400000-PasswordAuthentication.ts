import { MigrationInterface, QueryRunner } from 'typeorm';

export class PasswordAuthentication1791158400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE users ADD COLUMN password_hash varchar(255);
      ALTER TABLE auth_email_codes DROP CONSTRAINT auth_email_codes_pkey;
      ALTER TABLE auth_email_codes
        ADD COLUMN purpose varchar(32) NOT NULL DEFAULT 'sign-in',
        ADD CONSTRAINT auth_email_codes_purpose_check CHECK (purpose IN ('sign-in','password-reset')),
        ADD PRIMARY KEY (email,purpose);
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DELETE FROM auth_email_codes WHERE purpose <> 'sign-in';
      ALTER TABLE auth_email_codes DROP CONSTRAINT auth_email_codes_pkey;
      ALTER TABLE auth_email_codes DROP CONSTRAINT auth_email_codes_purpose_check;
      ALTER TABLE auth_email_codes DROP COLUMN purpose;
      ALTER TABLE auth_email_codes ADD PRIMARY KEY (email);
      ALTER TABLE users DROP COLUMN password_hash;
    `);
  }
}
