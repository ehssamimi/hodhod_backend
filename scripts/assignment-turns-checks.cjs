const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const tag = randomUUID().slice(0, 8);
  const s1 = await login(`turn-s1-${tag}@example.com`);
  const s2 = await login(`turn-s2-${tag}@example.com`);
  let other = await login(`turn-other-${tag}@example.com`);
  await source.query("UPDATE users SET role='teacher',auth_version=auth_version+1 WHERE id=$1", [other.user.id]);
  other = await login(`turn-other-${tag}@example.com`);
  const call = (path, method = 'GET', body, token = teacher.accessToken) => request(path, { method, body, token });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
  const cls = ok(await call('/teacher/classes', 'POST', { name: 'Turns ' + tag }), 201);
  for (const s of [s1, s2]) ok(await call('/classes/join', 'POST', { code: cls.joinCode }, s.accessToken));

  // One game used in Adventure and in assignments.
  const content = (await source.query("INSERT INTO content_items(title,subject,kind,status) VALUES ($1,$2,'both','published') RETURNING id", ['Turns ' + tag, 'Turns-' + tag]))[0].id;
  await source.query("INSERT INTO content_versions(content_id,version,unity_id,published_at) VALUES ($1,1,$2,now() - interval '1 day')", [content, 'turns.' + content]);
  const position = Number((await source.query('SELECT COALESCE(max(position),0)+1000 AS p FROM adventure_stages'))[0].p);
  await source.query('INSERT INTO adventure_stages(content_id,position) VALUES ($1,$2)', [content, position]);
  const rule = (await source.query('SELECT id, max_stars FROM scoring_rules WHERE content_id IS NULL ORDER BY version DESC LIMIT 1'))[0];
  assert.ok(rule, 'a global rule exists in this database');

  const attempt = async (student, context, assignmentId, stars) => (await source.query(`INSERT INTO game_attempts(student_id,content_id,content_version,context,assignment_id,
      scoring_rule_id,stars,max_stars,started_at,completed_at) VALUES ($1,$2,1,$3,$4,$5,$6,$7,now(),now()) RETURNING id`,
    [student.user.id, content, context, assignmentId, rule.id, stars, rule.max_stars]))[0].id;
  const points = (student, source_, attemptId, assignmentId, delta) => source.query(`INSERT INTO point_ledger(student_id,delta,reason,source,assignment_id,attempt_id,scoring_rule_id,idempotency_key)
    VALUES ($1,$2,'turn fixture',$3,$4,$5,$6,$7)`, [student.user.id, delta, source_, assignmentId, attemptId, rule.id, randomUUID()]);
  const progress = async id => ok(await call(`/teacher/assignments/${id}/progress`));
  const by = (data, student) => data.students.find(s => s.studentId === student.user.id);

  // Adventure result for s1 exists before any assignment.
  const adv = await attempt(s1, 'adventure', null, 4);
  await source.query('INSERT INTO adventure_progress(student_id,content_id,best_stars,attempt_count,first_passed_at,last_attempt_at) VALUES ($1,$2,4,1,now(),now())', [s1.user.id, content]);
  await points(s1, 'adventure', adv, null, 30);

  // First turn: fresh, then s1 plays it.
  const body = { classId: cls.id, contentId: content, audience: 'whole_class', endsAt: new Date(Date.now() + 7 * 86400000).toISOString() };
  const first = ok(await call('/teacher/assignments', 'POST', body), 201);
  let p1 = await progress(first.id);
  assert.equal(p1.assignmentId, first.id);
  assert.deepEqual(p1.students.map(s => [s.status, s.bestStars, s.attemptCount, s.points]), [['not_started', 0, 0, 0], ['not_started', 0, 0, 0]], 'Adventure result does not complete the assignment');
  const a1 = await attempt(s1, 'assignment', first.id, 3);
  await source.query('INSERT INTO assignment_progress(assignment_id,student_id,best_stars,attempt_count,first_passed_at,last_attempt_at) VALUES ($1,$2,3,1,now(),now())', [first.id, s1.user.id]);
  await points(s1, 'assignment', a1, first.id, 20);
  p1 = await progress(first.id);
  assert.deepEqual([by(p1, s1).status, by(p1, s1).bestStars, by(p1, s1).attemptCount, by(p1, s1).points], ['passed', 3, 1, 20]);
  assert.ok(by(p1, s1).firstPassedAt && by(p1, s1).lastAttemptAt);
  assert.deepEqual([by(p1, s2).status, by(p1, s2).points], ['not_started', 0]);

  // Assigning the same game again is a new turn: new ID, and nothing carries over.
  const second = ok(await call('/teacher/assignments', 'POST', body), 201);
  assert.notEqual(second.id, first.id);
  const p2 = await progress(second.id);
  assert.deepEqual(p2.students.map(s => [s.status, s.bestStars, s.attemptCount, s.points]), [['not_started', 0, 0, 0], ['not_started', 0, 0, 0]],
    'neither Adventure (4 stars, 30 points) nor the earlier turn (3 stars, 20 points) completes the new turn');

  // Playing the new turn earns its own points, and the first turn is untouched.
  const a2 = await attempt(s1, 'assignment', second.id, 3);
  await source.query('INSERT INTO assignment_progress(assignment_id,student_id,best_stars,attempt_count,first_passed_at,last_attempt_at) VALUES ($1,$2,3,1,now(),now())', [second.id, s1.user.id]);
  await points(s1, 'assignment', a2, second.id, 20);
  const half = await attempt(s2, 'assignment', second.id, 2);
  await source.query('INSERT INTO assignment_progress(assignment_id,student_id,best_stars,attempt_count,last_attempt_at) VALUES ($1,$2,2,1,now())', [second.id, s2.user.id]);
  await points(s2, 'assignment', half, second.id, 8);
  const q2 = await progress(second.id);
  assert.deepEqual([by(q2, s1).status, by(q2, s1).points], ['passed', 20]);
  assert.deepEqual([by(q2, s2).status, by(q2, s2).bestStars, by(q2, s2).points, by(q2, s2).firstPassedAt], ['in_progress', 2, 8, null]);
  const q1 = await progress(first.id);
  assert.deepEqual(q1.students.map(s => [s.studentId, s.status, s.bestStars, s.attemptCount, s.points]).sort(),
    p1.students.map(s => [s.studentId, s.status, s.bestStars, s.attemptCount, s.points]).sort());
  // Ledger and Adventure progress stay separate per context.
  assert.equal((await source.query("SELECT sum(delta)::int AS n FROM point_ledger WHERE student_id=$1 AND source='adventure' AND attempt_id=$2", [s1.user.id, adv]))[0].n, 30);
  assert.equal((await source.query('SELECT best_stars FROM adventure_progress WHERE student_id=$1 AND content_id=$2', [s1.user.id, content]))[0].best_stars, 4);
  // The database keeps each turn's progress keyed by its own assignment ID.
  assert.equal((await source.query('SELECT count(*)::int AS n FROM assignment_progress WHERE student_id=$1 AND assignment_id = ANY($2)', [s1.user.id, [first.id, second.id]]))[0].n, 2);

  // Cancelling one turn does not touch another; access is per owning teacher and role.
  ok(await call(`/teacher/assignments/${first.id}/cancel`, 'POST'));
  assert.equal((await progress(first.id)).phase, 'cancelled');
  assert.equal((await progress(second.id)).phase, 'active');
  assert.equal((await call(`/teacher/assignments/${second.id}/progress`, 'GET', undefined, other.accessToken)).status, 404);
  for (const user of [s1, admin]) assert.equal((await call(`/teacher/assignments/${second.id}/progress`, 'GET', undefined, user.accessToken)).status, 403);
  assert.equal((await call(`/teacher/assignments/${second.id}/progress`, 'GET', undefined, '')).status, 401);
  assert.equal((await call('/teacher/assignments/invalid/progress')).status, 400);
  assert.equal((await call(`/teacher/assignments/${randomUUID()}/progress`)).status, 404);

  // A student who leaves the class is no longer visible to that teacher; their records remain.
  ok(await call('/classes/leave', 'POST', undefined, s2.accessToken));
  assert.deepEqual((await progress(second.id)).students.map(s => s.studentId), [s1.user.id]);
  assert.equal((await source.query('SELECT count(*)::int AS n FROM assignment_progress WHERE student_id=$1 AND assignment_id=$2', [s2.user.id, second.id]))[0].n, 1);
  console.log('PASS BE-11 independent assignment turns: fresh ID, own status/attempts/points, no carry-over from Adventure or earlier turns');
};
