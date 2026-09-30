import { MigrationInterface, QueryRunner } from 'typeorm';

// BE-14: the first response for an attempt is stored so a repeated submission
// replays exactly the same result instead of recomputing it.
export class AttemptResultSnapshot1790899200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE game_attempts ADD COLUMN result jsonb');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE game_attempts DROP COLUMN result');
  }
}
