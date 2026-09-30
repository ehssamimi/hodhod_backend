import { MigrationInterface, QueryRunner } from 'typeorm';

// BE-09: rule versions, the point ledger and released content versions are history.
// Policy changes add rows; they never rewrite what already earned points.
export class ImmutableRuleHistory1790812800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION '% rows are append-only; add a new version or a compensating entry', TG_TABLE_NAME
          USING ERRCODE = 'integrity_constraint_violation';
      END; $$;
      CREATE TRIGGER scoring_rules_append_only BEFORE UPDATE OR DELETE ON scoring_rules
        FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
      CREATE TRIGGER point_ledger_append_only BEFORE UPDATE OR DELETE ON point_ledger
        FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();

      CREATE FUNCTION protect_released_content_version() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.published_at IS NOT NULL AND (TG_OP = 'DELETE' OR
           (NEW.content_id, NEW.version, NEW.unity_id, NEW.configuration, NEW.published_at)
           IS DISTINCT FROM (OLD.content_id, OLD.version, OLD.unity_id, OLD.configuration, OLD.published_at)) THEN
          RAISE EXCEPTION 'released content versions are immutable; add a new version'
            USING ERRCODE = 'integrity_constraint_violation';
        END IF;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END; $$;
      CREATE TRIGGER content_versions_released_immutable BEFORE UPDATE OR DELETE ON content_versions
        FOR EACH ROW EXECUTE FUNCTION protect_released_content_version();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER content_versions_released_immutable ON content_versions;
      DROP TRIGGER point_ledger_append_only ON point_ledger;
      DROP TRIGGER scoring_rules_append_only ON scoring_rules;
      DROP FUNCTION protect_released_content_version();
      DROP FUNCTION reject_history_mutation();
    `);
  }
}
