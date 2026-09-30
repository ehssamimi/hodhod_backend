import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmailAuthentication1790640000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE auth_email_codes (
        email varchar(254) PRIMARY KEY,
        request_id uuid NOT NULL UNIQUE,
        code_hash char(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE auth_rate_limits (
        bucket varchar(100) PRIMARY KEY,
        window_start timestamptz NOT NULL DEFAULT now(),
        hits integer NOT NULL DEFAULT 1 CHECK (hits > 0)
      );
      CREATE TABLE auth_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        auth_version integer NOT NULL CHECK (auth_version >= 0),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (expires_at > created_at)
      );
      CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
      CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    // Removing authentication state deliberately logs all sessions out.
    await runner.query('DROP TABLE auth_sessions, auth_rate_limits, auth_email_codes');
  }
}
