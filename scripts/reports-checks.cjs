const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const tag = randomUUID().slice(0, 8);
  const [s1, s2, s3] = [await login(`rep-s1-${tag}@example.com`), await login(`rep-s2-${tag}@example.com`), await login(`rep-s3-${tag}@example.com`)];
  let second = await login(`rep-second-${tag}@example.com`);
  await source.query("UPDATE users SET role='teacher',auth_version=auth_version+1 WHERE id=$1", [second.user.id]);
  second = await login(`rep-second-${tag}@example.com`);
  const call = (path, method = 'GET', body, token = teacher.accessToken) => request(path, { method, body, token });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
  const hours = h => new Date(Date.now() + h * 3600000).toISOString();
  const clsA = ok(await call('/teacher/classes', 'POST', { name: 'Rep A ' + tag }), 201);
  const clsB = ok(await call('/teacher/classes', 'POST', { name: 'Rep B ' + tag }, second.accessToken), 201);
  for (const s of [s1, s2, s3]) ok(await call('/classes/join', 'POST', { code: clsA.joinCode }, s.accessToken));
  const row = (await source.query("INSERT INTO content_items(title,subject,kind,status) VALUES ($1,$2,'practice','published') RETURNING id", ['Report game ' + tag, 'Rep-' + tag]))[0];
  await source.query("INSERT INTO content_versions(content_id,version,unity_id,published_at) VALUES ($1,1,$2,now() - interval '1 day')", [row.id, 'rep.' + row.id]);
  const game = row.id;
  const turn1 = ok(await call('/teacher/assignments', 'POST', { classId: clsA.id, contentId: game, audience: 'whole_class', endsAt: hours(48) }), 201);
  const turn2 = ok(await call('/teacher/assignments', 'POST', { classId: clsA.id, contentId: game, audience: 'whole_class', endsAt: hours(48) }), 201);
  const play = async (who, turn, stars, duration) => ok(await call('/attempts', 'POST', { attemptId: randomUUID(), contentId: game, context: 'assignment', assignmentId: turn.id, stars, durationSeconds: duration }, who.accessToken), 201);
  await play(s1, turn1, 2, 60);
  const a2 = await play(s1, turn1, 4, 100);
  await play(s2, turn1, 1, 30);
  await play(s1, turn2, 3, 20);
  ok(await call('/feedback', 'POST', { contentId: game, rating: 3 }, s1.accessToken), 201);
  const report = id => call('/teacher/reports/assignments/' + id);

  // Access.
  assert.equal((await request('/teacher/reports/assignments/' + turn1.id)).status, 401);
  for (const user of [s1, admin]) assert.equal((await call('/teacher/reports/assignments/' + turn1.id, 'GET', undefined, user.accessToken)).status, 403);
  assert.equal((await call('/teacher/reports/assignments/' + turn1.id, 'GET', undefined, second.accessToken)).status, 404, 'another teacher');
  assert.equal((await call('/teacher/reports/assignments/invalid')).status, 400);
  assert.equal((await call('/teacher/reports/assignments/' + randomUUID())).status, 404);

  // Per-turn report: counts, times, best stars, pass state, feedback.
  const r1 = ok(await report(turn1.id));
  assert.deepEqual([r1.assignmentId, r1.classId, r1.contentId, r1.className, r1.contentTitle, r1.phase], [turn1.id, clsA.id, game, 'Rep A ' + tag, 'Report game ' + tag, 'active']);
  assert.deepEqual(r1.students.map(s => s.studentId).sort(), [s1.user.id, s2.user.id, s3.user.id].sort());
  const by = (r, who) => r.students.find(s => s.studentId === who.user.id);
  const x1 = by(r1, s1);
  assert.deepEqual([x1.status, x1.attemptCount, x1.bestStars, x1.passStars, x1.totalDurationSeconds, x1.feedbackRating], ['passed', 2, 4, 3, 160, 3]);
  assert.ok(x1.firstAttemptAt && x1.lastAttemptAt && x1.firstPassedAt);
  assert.ok(new Date(x1.firstAttemptAt) <= new Date(x1.lastAttemptAt));
  assert.deepEqual([by(r1, s2).status, by(r1, s2).attemptCount, by(r1, s2).bestStars, by(r1, s2).feedbackRating], ['in_progress', 1, 1, null]);
  assert.deepEqual([by(r1, s3).status, by(r1, s3).attemptCount, by(r1, s3).firstAttemptAt, by(r1, s3).totalDurationSeconds], ['not_started', 0, null, 0]);
  assert.ok(r1.students.every(s => !('email' in s)));
  // The second turn of the same game is reported separately.
  const r2 = ok(await report(turn2.id));
  assert.deepEqual([by(r2, s1).attemptCount, by(r2, s1).bestStars, by(r2, s2).status], [1, 3, 'not_started']);

  // Student detail inside a turn lists every attempt with time and duration.
  const detail = ok(await call(`/teacher/reports/assignments/${turn1.id}/students/${s1.user.id}`));
  assert.equal(detail.assignmentId, turn1.id);
  assert.deepEqual(detail.attempts.map(a => [a.stars, a.durationSeconds, a.contentVersion, a.maxStars]), [[2, 60, 1, 5], [4, 100, 1, 5]]);
  assert.equal(detail.attempts[1].attemptId, a2.attemptId);
  assert.ok(new Date(detail.attempts[0].receivedAt) <= new Date(detail.attempts[1].receivedAt));
  assert.equal((await call(`/teacher/reports/assignments/${turn1.id}/students/${randomUUID()}`)).status, 404);
  assert.equal((await call(`/teacher/reports/assignments/${turn1.id}/students/${s1.user.id}`, 'GET', undefined, second.accessToken)).status, 404);

  // Student view lists this teacher's turns for a current student.
  const student = ok(await call('/teacher/reports/students/' + s1.user.id));
  assert.deepEqual([student.studentId, student.classId, student.className], [s1.user.id, clsA.id, 'Rep A ' + tag]);
  assert.deepEqual(student.turns.map(t => t.assignmentId).sort(), [turn1.id, turn2.id].sort());
  const t1 = student.turns.find(t => t.assignmentId === turn1.id);
  assert.deepEqual([t1.status, t1.attemptCount, t1.bestStars, t1.feedbackRating, t1.contentTitle], ['passed', 2, 4, 3, 'Report game ' + tag]);
  assert.equal((await call('/teacher/reports/students/' + s1.user.id, 'GET', undefined, second.accessToken)).status, 404, 'not their student');
  assert.equal((await call('/teacher/reports/students/' + randomUUID())).status, 404);
  assert.equal((await call('/teacher/reports/students/invalid')).status, 400);
  // Assignment detail (BE-10) only lists current members.
  assert.equal(ok(await call('/teacher/assignments/' + turn1.id)).recipients.length, 3);

  // Transfer: the former teacher loses future access; records and the student's own view remain.
  ok(await call('/classes/join', 'POST', { code: clsB.joinCode }, s1.accessToken));
  assert.equal((await call('/teacher/reports/students/' + s1.user.id)).status, 404);
  assert.equal((await call(`/teacher/reports/assignments/${turn1.id}/students/${s1.user.id}`)).status, 404);
  const afterMove = ok(await report(turn1.id));
  assert.deepEqual(afterMove.students.map(s => s.studentId).sort(), [s2.user.id, s3.user.id].sort());
  assert.equal(ok(await call('/teacher/assignments/' + turn1.id)).recipients.length, 2, 'assignment detail also hides departed students');
  assert.equal(ok(await call('/teacher/assignments/' + turn1.id)).recipientCount, 3, 'original audience size is kept');
  assert.equal(ok(await call('/teacher/reports/students/' + s1.user.id, 'GET', undefined, second.accessToken)).classId, clsB.id);
  assert.deepEqual(ok(await call('/teacher/reports/students/' + s1.user.id, 'GET', undefined, second.accessToken)).turns, [], 'the new teacher does not inherit the old class turns');
  assert.equal((await source.query('SELECT count(*)::int AS n FROM game_attempts WHERE student_id=$1', [s1.user.id]))[0].n >= 3, true);
  console.log('PASS BE-13 teacher reports: per-turn and per-student attempts, times, best stars, pass and feedback; transfer cuts former teacher access');
};
