// An isolated disposable PostgreSQL container; never uses .env credentials.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
require('ts-node/register');
const { Client } = require('pg');
const { DataSource } = require('typeorm');
const { databaseOptions } = require('../src/database/data-source');
const { User } = require('../src/users/user.entity');
const { EmailAuthentication1790640000000 } = require('../src/database/migrations/1790640000000-EmailAuthentication');
const { CloseArchivedMemberships1790726400000 } = require('../src/database/migrations/1790726400000-CloseArchivedMemberships');
const { AttemptResultSnapshot1790899200000 } = require('../src/database/migrations/1790899200000-AttemptResultSnapshot');
const { ImmutableRuleHistory1790812800000 } = require('../src/database/migrations/1790812800000-ImmutableRuleHistory');
process.env.AUTH_OTP_SECRET = randomUUID() + randomUUID();
process.env.AUTH_VERIFY_IP_LIMIT='100';
// Test fixture only, not a product decision: total points for 0..5 best stars.
process.env.SCORING_STAR_POINTS='0,0,0,20,30,40';

const name = 'hodhod-be01-test-' + randomUUID().slice(0, 8);
const password = randomUUID();
let container;
const connections = [];
function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
async function rejectsCode(action, code) {
  await assert.rejects(action, error => (error.driverError?.code ?? error.code) === code);
}
async function main() {
  // --pull=never makes this predictable and avoids a network dependency.
  container = docker('run', '--detach', '--rm', '--pull=never', '--name', name,
    '-e', 'POSTGRES_USER=hodhod_test', '-e', 'POSTGRES_PASSWORD=' + password,
    '-e', 'POSTGRES_DB=postgres', '-p', '127.0.0.1::5432', 'postgres:17-alpine');
  const port = Number(docker('port', container, '5432/tcp').split(':').pop());
  const connection = { host: '127.0.0.1', port, user: 'hodhod_test', password, database: 'postgres' };
  let admin;
  for (let tries = 0; tries < 40; tries++) {
    const candidate = new Client(connection);
    try { await candidate.connect(); admin = candidate; break; }
    catch { await candidate.end().catch(() => {}); await delay(500); }
  }
  assert.ok(admin, 'Disposable PostgreSQL failed to become ready');
  connections.push(admin);
  async function source(database, legacy = false, full = false) {
    await admin.query('CREATE DATABASE "' + database + '"');
    const ds = new DataSource({ ...databaseOptions(), migrations: full ? databaseOptions().migrations : databaseOptions().migrations.slice(0, 2), host: connection.host, port,
      username: connection.user, password, database });
    await ds.initialize();
    connections.push(ds);
    if (legacy) {
      // Match the pre-migration TypeORM schema, including its uuid-ossp default.
      await ds.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      await ds.query(`CREATE TABLE users (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        email varchar(254) NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now())`);
      await ds.query(`INSERT INTO users(email, "createdAt") VALUES ('legacy@example.com', '2026-01-01T00:00:00Z')`);
    }
    return ds;
  }

  const fresh = await source('be01_fresh');
  assert.equal(fresh.options.synchronize, false);
  assert.equal((await fresh.runMigrations()).length, 2);
  assert.equal((await fresh.runMigrations()).length, 0, 'Migrations must not rerun');
  const count = await fresh.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'");
  assert.equal(count[0].count, 20, '19 domain tables plus migration history');
  console.log('PASS empty database and idempotent migration runner');

  const users = fresh.getRepository(User);
  const student = await users.save(users.create({ email: 'student@example.com' }));
  const other = await users.save(users.create({ email: 'other@example.com' }));
  const teacher = await users.save(users.create({ email: 'teacher@example.com', role: 'teacher' }));
  assert.equal(student.role, 'student');
  assert.equal(student.timezone, 'UTC');
  assert.equal(student.authVersion, 0);
  await rejectsCode(() => users.save(users.create({ email: student.email })), '23505');
  await rejectsCode(() => fresh.query("UPDATE users SET role='owner' WHERE id=$1", [student.id]), '23514');
  process.env.NODE_ENV = 'development';
  process.env.AUTH_DEV_OTP_ENABLED = 'true';
  console.log('PASS default role and user constraints');

  async function row(sql, values = []) { return (await fresh.query(sql + ' RETURNING *', values))[0]; }
  const a = await row("INSERT INTO classes(teacher_id,name,join_code) VALUES ($1,'Class A','AAA')", [teacher.id]);
  const b = await row("INSERT INTO classes(teacher_id,name,join_code) VALUES ($1,'Class B','BBB')", [teacher.id]);
  const race = await Promise.allSettled([a, b].map(c => fresh.query(
    'INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [c.id, student.id])));
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(race.find(r => r.status === 'rejected').reason.driverError.code, '23505');
  await fresh.query('UPDATE class_memberships SET ended_at=now() WHERE student_id=$1', [student.id]);
  await fresh.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [b.id, student.id]);
  assert.equal((await fresh.query('SELECT * FROM class_memberships WHERE student_id=$1', [student.id])).length, 2);
  await rejectsCode(() => fresh.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [randomUUID(), other.id]), '23503');
  console.log('PASS concurrent active membership uniqueness, history and foreign keys');

  const content = await row("INSERT INTO content_items(title,subject,kind) VALUES ('Multiply','Math','both')");
  const different = await row("INSERT INTO content_items(title,subject,kind) VALUES ('Divide','Math','practice')");
  for (const c of [content, different]) await fresh.query('INSERT INTO content_versions(content_id,version,unity_id) VALUES ($1,1,$2)', [c.id,c.title]);
  await fresh.query('INSERT INTO adventure_stages(content_id,position) VALUES ($1,1)', [content.id]);
  const rule = await row("INSERT INTO scoring_rules(version,definition) VALUES (1,'{}')");
  await rejectsCode(() => fresh.query("INSERT INTO scoring_rules(version,definition) VALUES (1,'{}')"), '23505');
  async function assign() {
    const assignment = await row(`INSERT INTO assignments(teacher_id,class_id,content_id,audience,starts_at,ends_at)
      VALUES ($1,$2,$3,'selected',now(),now()+interval '7 days')`, [teacher.id,b.id,content.id]);
    await fresh.query('INSERT INTO assignment_recipients(assignment_id,student_id) VALUES ($1,$2)', [assignment.id, student.id]);
    return assignment;
  }
  const first = await assign();
  const second = await assign();
  await rejectsCode(() => fresh.query(`INSERT INTO assignments(teacher_id,class_id,content_id,audience,starts_at,ends_at)
    VALUES ($1,$2,$3,'selected',now(),now())`, [teacher.id,b.id,content.id]), '23514');
  const attemptSql = `INSERT INTO game_attempts(id,student_id,content_id,content_version,context,assignment_id,scoring_rule_id,stars,max_stars,started_at,completed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())`;
  const attempt = (id, context = 'adventure', assignmentId = null, contentId = content.id, studentId = student.id, stars = 3, max = 5, version = 1) =>
    fresh.query(attemptSql, [id,studentId,contentId,version,context,assignmentId,rule.id,stars,max]);
  const adventureAttempt = randomUUID();
  const attemptRace = await Promise.allSettled([attempt(adventureAttempt), attempt(adventureAttempt)]);
  assert.equal(attemptRace.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(attemptRace.find(r => r.status === 'rejected').reason.driverError.code, '23505');
  const firstAttempt = randomUUID();
  const secondAttempt = randomUUID();
  await attempt(firstAttempt, 'assignment', first.id);
  await attempt(secondAttempt, 'assignment', second.id);
  await rejectsCode(() => attempt(randomUUID(), 'adventure', first.id), '23514');
  await rejectsCode(() => attempt(randomUUID(), 'assignment'), '23514');
  await rejectsCode(() => attempt(randomUUID(), 'assignment', first.id, different.id), '23503');
  await rejectsCode(() => attempt(randomUUID(), 'assignment', first.id, content.id, other.id), '23503');
  await rejectsCode(() => attempt(randomUUID(), 'adventure', null, content.id, student.id, 6), '23514');
  await rejectsCode(() => attempt(randomUUID(), 'adventure', null, content.id, student.id, 6, 6), '23503');
  await rejectsCode(() => attempt(randomUUID(), 'adventure', null, content.id, student.id, 3, 5, 2), '23503');
  await fresh.query('INSERT INTO adventure_progress(student_id,content_id,best_stars,attempt_count) VALUES ($1,$2,5,1)', [student.id,content.id]);
  for (const [assignment, stars] of [[first,3],[second,1]]) {
    await fresh.query('INSERT INTO assignment_progress(assignment_id,student_id,best_stars,attempt_count) VALUES ($1,$2,$3,1)', [assignment.id, student.id, stars]);
  }
  assert.equal((await fresh.query('SELECT best_stars FROM adventure_progress'))[0].best_stars, 5);
  assert.deepEqual((await fresh.query('SELECT best_stars FROM assignment_progress ORDER BY best_stars')).map(r => r.best_stars), [1,3]);
  console.log('PASS attempt replay/concurrency, context/recipient/content/version constraints and independent progress');

  const ledgerSql = `INSERT INTO point_ledger(student_id,delta,reason,source,assignment_id,attempt_id,scoring_rule_id,idempotency_key)
    VALUES ($1,20,'test',$2,$3,$4,$5,$6)`;
  const ledger = (source, assignmentId, attemptId, key) => fresh.query(ledgerSql, [student.id,source,assignmentId,attemptId,rule.id,key]);
  await ledger('adventure', null, adventureAttempt, 'adventure-improvement');
  await ledger('assignment', first.id, firstAttempt, 'first-improvement');
  await ledger('assignment', second.id, secondAttempt, 'second-improvement');
  await rejectsCode(() => ledger('adventure', null, adventureAttempt, 'duplicate'), '23505');
  const unusedAttempt = randomUUID();
  await attempt(unusedAttempt, 'assignment', first.id);
  await rejectsCode(() => ledger('adventure', null, unusedAttempt, 'wrong-context'), '23503');
  await rejectsCode(() => ledger('assignment', second.id, unusedAttempt, 'wrong-assignment'), '23503');
  await fresh.query(`INSERT INTO daily_activity(student_id,activity_date,timezone,qualifying_attempt_id)
    VALUES ($1,'2026-09-28','Asia/Tehran',$2)`, [student.id, adventureAttempt]);
  await rejectsCode(() => fresh.query(`INSERT INTO daily_activity(student_id,activity_date,timezone,qualifying_attempt_id)
    VALUES ($1,'2026-09-28','Asia/Tehran',$2)`, [student.id,firstAttempt]), '23505');
  await fresh.query(`INSERT INTO point_ledger(student_id,delta,reason,source,scoring_rule_id,activity_date,idempotency_key)
    VALUES ($1,10,'daily reward','streak',$2,'2026-09-28','streak-day')`, [student.id,rule.id]);
  await rejectsCode(() => fresh.query(`INSERT INTO point_ledger(student_id,delta,reason,source,scoring_rule_id,activity_date,idempotency_key)
    VALUES ($1,10,'daily reward','streak',$2,'2026-09-28','another-key')`, [student.id,rule.id]), '23505');
  await fresh.query('INSERT INTO game_feedback(student_id,content_id,rating) VALUES ($1,$2,4)', [student.id,content.id]);
  await rejectsCode(() => fresh.query('INSERT INTO game_feedback(student_id,content_id,rating) VALUES ($1,$2,3)', [student.id,content.id]), '23505');
  await rejectsCode(() => fresh.query('INSERT INTO game_feedback(student_id,content_id,rating) VALUES ($1,$2,5)', [other.id,content.id]), '23514');
  const sum = (await fresh.query('SELECT sum(delta)::int AS total FROM point_ledger WHERE student_id=$1', [student.id]))[0].total;
  assert.equal(sum, 70);
  await fresh.query('UPDATE class_memberships SET ended_at=now() WHERE student_id=$1 AND ended_at IS NULL', [student.id]);
  await fresh.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [a.id,student.id]);
  assert.equal((await fresh.query('SELECT sum(delta)::int AS total FROM point_ledger WHERE student_id=$1', [student.id]))[0].total, sum);
  await assert.rejects(() => fresh.undoLastMigration(), /Rollback would discard MVP data/);
  assert.equal((await fresh.query('SELECT * FROM schema_migrations')).length, 2);
  console.log('PASS ledger attribution, reward deduplication, feedback, transfer retention and safe rollback refusal');

  const legacy = await source('be01_legacy', true);
  const before = (await legacy.query('SELECT * FROM users'))[0];
  await legacy.runMigrations();
  const after = (await legacy.query('SELECT * FROM users'))[0];
  assert.equal(after.id, before.id);
  assert.equal(after.email, before.email);
  assert.equal(after.createdAt.toISOString(), before.createdAt.toISOString());
  assert.equal(after.role, 'student');
  assert.equal((await legacy.query('SELECT * FROM student_profiles'))[0].user_id, before.id);
  await legacy.query("UPDATE users SET display_name='Keep this' WHERE id=$1", [before.id]);
  await assert.rejects(() => legacy.undoLastMigration(), /Rollback would discard user profile data/);
  await legacy.query('UPDATE users SET display_name=NULL WHERE id=$1', [before.id]);
  await legacy.undoLastMigration();
  assert.deepEqual((await legacy.query('SELECT * FROM users'))[0], before);
  await legacy.undoLastMigration();
  assert.deepEqual((await legacy.query('SELECT * FROM users'))[0], before);
  assert.equal((await legacy.runMigrations()).length, 2);
  console.log('PASS legacy user adoption, guarded rollback, baseline preservation and reapply');

  const failure = await source('be01_failure');
  await failure.query('CREATE TABLE classes (unexpected integer)');
  await rejectsCode(() => failure.runMigrations(), '42P07');
  const rolledBack = await failure.query("SELECT to_regclass('public.users') AS users, to_regclass('public.student_profiles') AS profiles");
  assert.equal(rolledBack[0].users, null);
  assert.equal(rolledBack[0].profiles, null);
  assert.equal((await failure.query('SELECT * FROM schema_migrations')).length, 0);
  console.log('PASS partial migration failure rolls back the entire schema transaction');
  console.log('All BE-01 PostgreSQL integration checks passed.');
  fresh.migrations.push(new EmailAuthentication1790640000000());
  await fresh.runMigrations();
  const archived = (await fresh.query(`INSERT INTO classes(teacher_id,name,join_code,status,archived_at)
    VALUES ($1,'Legacy archived','LEGACY-ARCHIVED','archived',clock_timestamp()) RETURNING id`,[teacher.id]))[0];
  const historical = (await fresh.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2) RETURNING *',[archived.id,other.id]))[0];
  fresh.migrations.push(new CloseArchivedMemberships1790726400000());
  assert.equal((await fresh.runMigrations()).length,1);
  const corrected = (await fresh.query('SELECT * FROM class_memberships WHERE id=$1',[historical.id]))[0];
  assert.ok(corrected.ended_at >= corrected.joined_at);
  assert.deepEqual({...corrected,ended_at:null},historical);
  assert.equal((await fresh.query('SELECT id FROM class_memberships WHERE student_id=$1 AND ended_at IS NULL',[student.id])).length,1);
  await fresh.undoLastMigration();
  assert.deepEqual((await fresh.query('SELECT * FROM class_memberships WHERE id=$1',[historical.id]))[0],corrected);
  assert.equal((await fresh.runMigrations()).length,1);
  assert.equal((await fresh.runMigrations()).length,0);
  fresh.migrations.push(new ImmutableRuleHistory1790812800000());
  assert.equal((await fresh.runMigrations()).length,1);
  await fresh.undoLastMigration();
  assert.equal((await fresh.runMigrations()).length,1);
  assert.equal((await fresh.runMigrations()).length,0);
  console.log('PASS BE-09 append-only history triggers apply, revert and reapply');
  fresh.migrations.push(new AttemptResultSnapshot1790899200000());
  assert.equal((await fresh.runMigrations()).length,1);
  await fresh.undoLastMigration();
  assert.equal((await fresh.runMigrations()).length,1);
  console.log('PASS BE-14 attempt result snapshot column applies, reverts and reapplies');
  console.log('PASS BE-06 historical archive repair, active membership retention and non-reopening rollback');
  await require('./identity-checks.cjs')(fresh);
  console.log('All BE-02 identity integration checks passed.');
  const emailSource = await source('be03_full', false, true);
  assert.equal((await emailSource.runMigrations()).length, 6);
  await require('./email-auth-checks.cjs')(emailSource);
  console.log('All BE-03 email authentication checks passed.');
}
main().catch(error => {
  // Avoid printing connection options, generated credentials or complete driver objects.
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
}).finally(async () => {
  for (const connection of connections.reverse()) {
    if (connection instanceof DataSource) await connection.destroy().catch(() => {});
    else await connection.end().catch(() => {});
  }
  if (container) {
    try { docker('rm', '--force', container); }
    catch { console.error('Could not remove disposable test container: ' + name); process.exitCode = 1; }
  }
});
