import { MigrationInterface, QueryRunner } from 'typeorm';

export class CloseArchivedMemberships1790726400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Earlier class APIs archived classes without ending their open memberships.
    // Preserve every row and use the recorded archive time, never a client time.
    await queryRunner.query(`UPDATE class_memberships m
      SET ended_at=GREATEST(m.joined_at,c.archived_at)
      FROM classes c WHERE c.id=m.class_id AND c.status='archived' AND m.ended_at IS NULL`);
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Retain corrected history. Reopening memberships could conflict with a later
    // transfer and cannot be distinguished safely from legitimate ended records.
  }
}
