import { MigrationInterface, QueryRunner } from 'typeorm';

// BE-18: rejected or implausible attempts leave an append-only trace for later review.
export class SuspiciousEvents1790985600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE suspicious_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        attempt_id uuid,
        content_id uuid,
        context varchar(16),
        assignment_id uuid,
        reason varchar(40) NOT NULL,
        details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX suspicious_events_student_idx ON suspicious_events(student_id, created_at DESC);
      CREATE INDEX suspicious_events_reason_idx ON suspicious_events(reason, created_at DESC);
      CREATE TRIGGER suspicious_events_append_only BEFORE UPDATE OR DELETE ON suspicious_events
        FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE suspicious_events');
  }
}
