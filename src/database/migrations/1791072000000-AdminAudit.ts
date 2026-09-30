import { MigrationInterface, QueryRunner } from 'typeorm';

// BE-21: who changed content, paths and scoring rules, and when. Append-only.
export class AdminAudit1791072000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE admin_audit (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        action varchar(40) NOT NULL,
        entity_type varchar(30) NOT NULL,
        entity_id uuid,
        details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX admin_audit_time_idx ON admin_audit(created_at DESC);
      CREATE INDEX admin_audit_entity_idx ON admin_audit(entity_type, entity_id, created_at DESC);
      CREATE INDEX admin_audit_actor_idx ON admin_audit(actor_id, created_at DESC);
      CREATE TRIGGER admin_audit_append_only BEFORE UPDATE OR DELETE ON admin_audit
        FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE admin_audit');
  }
}
