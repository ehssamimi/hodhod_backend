import { MigrationInterface, QueryRunner } from 'typeorm';

export class MvpDataModel1790553601000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE users
  ADD COLUMN role varchar(16) NOT NULL DEFAULT 'student',
  ADD COLUMN display_name varchar(120),
  ADD COLUMN avatar_id varchar(128),
  ADD COLUMN timezone varchar(64) NOT NULL DEFAULT 'UTC',
  ADD COLUMN auth_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'teacher', 'admin')),
  ADD CONSTRAINT users_auth_version_check CHECK (auth_version >= 0);

CREATE TABLE student_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE teacher_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO student_profiles(user_id) SELECT id FROM users;

CREATE TABLE role_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_role varchar(16) NOT NULL CHECK (previous_role IN ('student','teacher','admin')),
  new_role varchar(16) NOT NULL CHECK (new_role IN ('student','teacher','admin')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_role <> new_role)
);
CREATE INDEX role_change_audit_user_time_idx ON role_change_audit(user_id, created_at);

CREATE TABLE classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL,
  join_code varchar(32) NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK ((status = 'active' AND archived_at IS NULL) OR
         (status = 'archived' AND archived_at IS NOT NULL)),
  CHECK (archived_at IS NULL OR archived_at >= created_at)
);
CREATE INDEX classes_teacher_idx ON classes(teacher_id);
CREATE TABLE class_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= joined_at)
);
CREATE UNIQUE INDEX class_memberships_one_active_student_idx
  ON class_memberships(student_id) WHERE ended_at IS NULL;
CREATE INDEX class_memberships_class_idx ON class_memberships(class_id, student_id);

CREATE TABLE content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(200) NOT NULL,
  subject varchar(120) NOT NULL,
  grade smallint NOT NULL DEFAULT 3 CHECK (grade > 0),
  kind varchar(16) NOT NULL CHECK (kind IN ('adventure','practice','both')),
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE content_versions (
  content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  unity_id varchar(200) NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_id, version)
);
CREATE TABLE scoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid REFERENCES content_items(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  max_stars smallint NOT NULL DEFAULT 5 CHECK (max_stars > 0),
  pass_stars smallint NOT NULL DEFAULT 3 CHECK (pass_stars >= 0 AND pass_stars <= max_stars),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, max_stars),
  UNIQUE NULLS NOT DISTINCT (content_id, version)
);
CREATE TABLE adventure_stages (
  content_id uuid PRIMARY KEY REFERENCES content_items(id) ON DELETE RESTRICT,
  position integer NOT NULL UNIQUE CHECK (position > 0),
  prerequisite_content_id uuid REFERENCES adventure_stages(content_id) ON DELETE RESTRICT,
  unlock_stars smallint NOT NULL DEFAULT 3 CHECK (unlock_stars >= 0),
  CHECK (prerequisite_content_id IS NULL OR prerequisite_content_id <> content_id)
);

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE RESTRICT,
  audience varchar(16) NOT NULL CHECK (audience IN ('whole_class','selected')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (id, content_id)
);
CREATE INDEX assignments_class_time_idx ON assignments(class_id, starts_at, ends_at);
CREATE INDEX assignments_teacher_idx ON assignments(teacher_id);
CREATE TABLE assignment_recipients (
  assignment_id uuid NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id)
);
CREATE INDEX assignment_recipients_student_idx ON assignment_recipients(student_id);

CREATE TABLE game_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content_id uuid NOT NULL,
  content_version integer NOT NULL,
  context varchar(16) NOT NULL CHECK (context IN ('adventure','assignment')),
  assignment_id uuid,
  scoring_rule_id uuid NOT NULL REFERENCES scoring_rules(id) ON DELETE RESTRICT,
  stars smallint NOT NULL CHECK (stars >= 0),
  max_stars smallint NOT NULL CHECK (max_stars > 0 AND stars <= max_stars),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at >= started_at),
  CHECK ((context = 'adventure' AND assignment_id IS NULL) OR
         (context = 'assignment' AND assignment_id IS NOT NULL)),
  FOREIGN KEY (content_id, content_version) REFERENCES content_versions(content_id, version) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, content_id) REFERENCES assignments(id, content_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, student_id) REFERENCES assignment_recipients(assignment_id, student_id) ON DELETE RESTRICT,
  FOREIGN KEY (scoring_rule_id, max_stars) REFERENCES scoring_rules(id, max_stars) ON DELETE RESTRICT,
  UNIQUE (id, student_id),
  UNIQUE (id, student_id, context),
  UNIQUE (id, assignment_id)
);
CREATE INDEX game_attempts_student_content_idx ON game_attempts(student_id, content_id, received_at);
CREATE INDEX game_attempts_assignment_idx ON game_attempts(assignment_id, student_id);

CREATE TABLE adventure_progress (
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content_id uuid NOT NULL REFERENCES adventure_stages(content_id) ON DELETE RESTRICT,
  best_stars smallint NOT NULL DEFAULT 0 CHECK (best_stars >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  first_passed_at timestamptz,
  last_attempt_at timestamptz,
  PRIMARY KEY (student_id, content_id)
);
CREATE TABLE assignment_progress (
  assignment_id uuid NOT NULL,
  student_id uuid NOT NULL,
  best_stars smallint NOT NULL DEFAULT 0 CHECK (best_stars >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  first_passed_at timestamptz,
  last_attempt_at timestamptz,
  PRIMARY KEY (assignment_id, student_id),
  FOREIGN KEY (assignment_id, student_id) REFERENCES assignment_recipients(assignment_id, student_id) ON DELETE RESTRICT
);

CREATE TABLE daily_activity (
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  activity_date date NOT NULL,
  timezone varchar(64) NOT NULL,
  qualifying_attempt_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, activity_date),
  FOREIGN KEY (qualifying_attempt_id, student_id) REFERENCES game_attempts(id, student_id) ON DELETE RESTRICT
);
CREATE TABLE streaks (
  student_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  current_days integer NOT NULL DEFAULT 0 CHECK (current_days >= 0),
  best_days integer NOT NULL DEFAULT 0 CHECK (best_days >= current_days),
  last_activity_date date,
  FOREIGN KEY (student_id, last_activity_date) REFERENCES daily_activity(student_id, activity_date) ON DELETE RESTRICT
);
CREATE TABLE point_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  delta integer NOT NULL CHECK (delta <> 0),
  reason text NOT NULL,
  source varchar(16) NOT NULL CHECK (source IN ('adventure','assignment','streak','adjustment')),
  assignment_id uuid,
  attempt_id uuid,
  scoring_rule_id uuid REFERENCES scoring_rules(id) ON DELETE RESTRICT,
  activity_date date,
  idempotency_key varchar(200) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'assignment' AND assignment_id IS NOT NULL AND attempt_id IS NOT NULL AND activity_date IS NULL) OR
         (source = 'adventure' AND assignment_id IS NULL AND attempt_id IS NOT NULL AND activity_date IS NULL) OR
         (source = 'streak' AND assignment_id IS NULL AND attempt_id IS NULL AND activity_date IS NOT NULL) OR
         (source = 'adjustment' AND assignment_id IS NULL AND attempt_id IS NULL AND activity_date IS NULL)),
  CHECK (source = 'adjustment' OR scoring_rule_id IS NOT NULL),
  FOREIGN KEY (attempt_id, student_id, source) REFERENCES game_attempts(id, student_id, context) ON DELETE RESTRICT,
  FOREIGN KEY (attempt_id, assignment_id) REFERENCES game_attempts(id, assignment_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, student_id) REFERENCES assignment_recipients(assignment_id, student_id) ON DELETE RESTRICT,
  FOREIGN KEY (student_id, activity_date) REFERENCES daily_activity(student_id, activity_date) ON DELETE RESTRICT,
  UNIQUE (student_id, idempotency_key)
);
CREATE UNIQUE INDEX point_ledger_attempt_idx ON point_ledger(attempt_id) WHERE attempt_id IS NOT NULL;
CREATE UNIQUE INDEX point_ledger_streak_day_idx ON point_ledger(student_id, activity_date) WHERE source = 'streak';
CREATE INDEX point_ledger_student_time_idx ON point_ledger(student_id, created_at);
CREATE TABLE game_feedback (
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content_id uuid NOT NULL REFERENCES content_items(id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, content_id)
);
CREATE INDEX game_feedback_content_idx ON game_feedback(content_id);
`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const tables = ["game_feedback","point_ledger","streaks","daily_activity","assignment_progress","adventure_progress","game_attempts","assignment_recipients","assignments","adventure_stages","scoring_rules","content_versions","content_items","class_memberships","classes","role_change_audit","teacher_profiles","student_profiles"];
    // Hold locks until the transaction ends, so writes cannot race the checks.
    await queryRunner.query('LOCK TABLE users, ' + tables.map(t => '"' + t + '"').join(', ') + ' IN ACCESS EXCLUSIVE MODE');
    for (const table of tables.filter(t => t !== 'student_profiles')) {
      const rows: Array<{ present: boolean }> = await queryRunner.query(
        'SELECT EXISTS (SELECT 1 FROM "' + table + '") AS present',
      );
      if (rows[0].present) throw new Error('Rollback would discard MVP data in ' + table + '; back up and plan a data migration first.');
    }
    const changed: Array<{ present: boolean }> = await queryRunner.query(`
      SELECT EXISTS (SELECT 1 FROM users WHERE role <> 'student' OR
        display_name IS NOT NULL OR avatar_id IS NOT NULL OR timezone <> 'UTC' OR auth_version <> 0) AS present
    `);
    if (changed[0].present) throw new Error('Rollback would discard user profile data; back up and plan a data migration first.');
    // student_profiles contains only a user reference and creation timestamp.
    // It is reproducible; accounts and the original createdAt remain untouched.
    for (const table of tables) await queryRunner.query('DROP TABLE "' + table + '"');
    await queryRunner.query(`
      ALTER TABLE users DROP COLUMN auth_version, DROP COLUMN timezone,
        DROP COLUMN avatar_id, DROP COLUMN display_name, DROP COLUMN role
    `);
  }
}
