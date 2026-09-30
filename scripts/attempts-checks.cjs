const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const tag = randomUUID().slice(0, 8);
  const s1 = await login(`att-s1-${tag}@example.com`);
  const s2 = await login(`att-s2-${tag}@example.com`);
  const s3 = await login(`att-s3-${tag}@example.com`);
  const call = (path, method = 'GET', body, token = s1.accessToken) => request(path, { method, body, token });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
  const hours = h => new Date(Date.now() + h * 3600000).toISOString();
  const submit = (body, who = s1) => call('/attempts', 'POST', { durationSeconds: 90, ...body }, who.accessToken);
  const count = async (sql, params) => (await source.query(sql, params))[0].n;

  // A game used in Adventure and in assignments, with a locked follow-up stage.
  const mk = async name => {
    const row = (await source.query("INSERT INTO content_items(title,subject,kind,status) VALUES ($1,$2,'both','published') RETURNING id", [name + tag, 'Att-' + tag]))[0];
    await source.query("INSERT INTO content_versions(content_id,version,unity_id,published_at) VALUES ($1,1,$2,now() - interval '1 day')", [row.id, 'att.' + row.id]);
    return row.id;
  };
  const game = await mk('Game');
  const next = await mk('Next');
  let position = Number((await source.query('SELECT COALESCE(max(position),0)+1000 AS p FROM adventure_stages'))[0].p);
  await source.query('INSERT INTO adventure_stages(content_id,position) VALUES ($1,$2)', [game, position]);
  await source.query('INSERT INTO adventure_stages(content_id,position,prerequisite_content_id,unlock_stars) VALUES ($1,$2,$3,3)', [next, position + 1, game]);
  // Admin-defined rule v1 for the game: total points for 0..5 best stars.
  const rule1 = ok(await call('/admin/rules', 'POST', { contentId: game, maxStars: 5, passStars: 3, definition: { starPoints: [0, 0, 0, 20, 30, 40] } }, admin.accessToken), 201);
  const A = (over = {}) => ({ attemptId: randomUUID(), contentId: game, context: 'adventure', stars: 3, ...over });

  // ---- BE-14: identity, validation, idempotency, server timestamps ----
  assert.equal((await request('/attempts', { method: 'POST', body: A() })).status, 401);
  for (const user of [teacher, admin]) assert.equal((await submit(A(), user)).status, 403);
  for (const [why, body] of [['empty', {}], ['bad id', A({ attemptId: 'x' })], ['bad context', A({ context: 'practice' })], ['stars -1', A({ stars: -1 })],
    ['stars 11', A({ stars: 11 })], ['float stars', A({ stars: 2.5 })], ['long duration', A({ durationSeconds: 21601 })], ['negative duration', A({ durationSeconds: -1 })],
    ['adventure with assignment', A({ assignmentId: randomUUID() })], ['assignment without id', A({ context: 'assignment' })],
    ['extra received', A({ receivedAt: '2000-01-01T00:00:00Z' })], ['extra student', A({ studentId: s2.user.id })], ['extra points', A({ points: 999 })]]) {
    assert.equal((await submit(body)).status, 400, why);
  }
  assert.equal((await submit(A({ stars: 6 }))).status, 400, 'above the rule ceiling');
  assert.equal((await submit(A({ contentId: randomUUID() }))).status, 404, 'not on the map');
  assert.equal((await submit(A({ contentId: next }))).status, 403, 'locked stage');
  assert.equal(await count('SELECT count(*)::int AS n FROM game_attempts WHERE student_id=$1', [s1.user.id]), 0, 'rejected requests store nothing');

  const first = A({ stars: 3 });
  const created = ok(await submit(first), 201);
  assert.deepEqual([created.duplicate, created.context, created.contentId, created.assignmentId, created.contentVersion, created.scoringRuleId, created.stars, created.maxStars, created.passStars, created.passed],
    [false, 'adventure', game, null, 1, rule1.id, 3, 5, 3, true]);
  assert.deepEqual(created.progress, { bestStars: 3, attemptCount: 1, passed: true, improved: true, firstPassedAt: created.progress.firstPassedAt });
  assert.ok(created.progress.firstPassedAt);
  const row = (await source.query('SELECT * FROM game_attempts WHERE id=$1', [first.attemptId]))[0];
  assert.equal(row.student_id, s1.user.id);
  assert.equal(Math.round((row.completed_at - row.started_at) / 1000), 90, 'start derived from the duration');
  assert.ok(Math.abs(Date.now() - row.received_at.getTime()) < 60000, 'receipt time is the server clock');
  // Same ID again: identical result, nothing new.
  const replay = await submit(first);
  assert.equal(replay.status, 200);
  assert.deepEqual({ ...replay.data, duplicate: false }, created);
  assert.equal(replay.data.duplicate, true);
  assert.equal(await count('SELECT count(*)::int AS n FROM game_attempts WHERE id=$1', [first.attemptId]), 1);
  assert.equal(await count('SELECT count(*)::int AS n FROM point_ledger WHERE attempt_id=$1', [first.attemptId]), 1);
  assert.equal(await count('SELECT attempt_count AS n FROM adventure_progress WHERE student_id=$1 AND content_id=$2', [s1.user.id, game]), 1);
  assert.equal((await submit({ ...first, stars: 4 })).status, 409, 'same ID, different data');
  assert.equal((await submit(first, s2)).status, 409, 'another student cannot reuse the ID');
  const race = await Promise.all(Array.from({ length: 5 }, () => submit(A({ attemptId: '11111111-1111-4111-8111-' + tag.padEnd(12, '0').slice(0, 12), stars: 2 }))));
  assert.deepEqual(race.map(r => r.status).sort(), [200, 200, 200, 200, 201]);
  for (const r of race) assert.deepEqual({ ...r.data, duplicate: false }, { ...race[0].data, duplicate: false });
  console.log('PASS BE-14 attempt recording: unique ID, context checks, server timestamps, replay returns the identical result, concurrent duplicates make one row');

  // ---- BE-15: independent best stars, pass at 3 of 5 ----
  const progressOf = async () => (await source.query('SELECT best_stars, attempt_count, first_passed_at FROM adventure_progress WHERE student_id=$1 AND content_id=$2', [s1.user.id, game]))[0];
  let p = await progressOf();
  assert.deepEqual([p.best_stars, p.attempt_count], [3, 2], 'the 2-star race attempt counted once, best stays 3');
  const passedAt = p.first_passed_at;
  const worse = ok(await submit(A({ stars: 1 })), 201);
  assert.deepEqual([worse.progress.bestStars, worse.progress.attemptCount, worse.progress.improved, worse.passed, worse.pointsAwarded], [3, 3, false, false, 0]);
  p = await progressOf();
  assert.deepEqual([p.best_stars, p.attempt_count], [3, 3]);
  assert.deepEqual(p.first_passed_at, passedAt, 'first pass time is kept');
  // A failed first attempt in another student is in_progress, not passed.
  const fail = ok(await submit(A({ stars: 2 }), s2), 201);
  assert.deepEqual([fail.progress.passed, fail.progress.firstPassedAt, fail.passed], [false, null, false]);
  // Passing the first stage opens the next; the map shows the stars.
  const map = (await call('/adventure/map')).data.stages;
  assert.equal(map.find(x => x.contentId === next).status, 'unlocked');
  assert.equal(map.find(x => x.contentId === game).bestStars, 3);
  assert.equal(ok(await submit(A({ contentId: next, stars: 4 })), 201).progress.bestStars, 4);
  console.log('PASS BE-15 per-context best stars: worse attempts never lower it, pass at the rule line (3 of 5), stage unlocks');

  // ---- BE-16: ledger deltas ----
  const ledger = async (student, sql = '') => source.query(`SELECT * FROM point_ledger WHERE student_id=$1 ${sql} ORDER BY created_at, id`, [student.user.id]);
  assert.deepEqual((await ledger(s1, `AND attempt_id IN (SELECT id FROM game_attempts WHERE content_id='${game}')`)).map(l => l.delta), [20]);
  const up = ok(await submit(A({ stars: 4 })), 201);
  assert.equal(up.pointsAwarded, 10, '20 -> 30 adds only 10');
  assert.equal(ok(await submit(A({ stars: 4 })), 201).pointsAwarded, 0, 'repeat without improvement');
  const both = await Promise.all([submit(A({ stars: 5 })), submit(A({ stars: 5 }))]);
  assert.deepEqual(both.map(r => r.status), [201, 201]);
  assert.deepEqual(both.map(r => r.data.pointsAwarded).sort((a, b) => a - b), [0, 10], 'concurrent equal results pay once');
  const rows = await ledger(s1, `AND attempt_id IN (SELECT id FROM game_attempts WHERE content_id='${game}')`);
  assert.deepEqual(rows.map(l => l.delta), [20, 10, 10]);
  assert.ok(rows.every(l => l.source === 'adventure' && l.assignment_id === null && l.scoring_rule_id === rule1.id && l.idempotency_key.startsWith('attempt:')));
  // A newer rule only affects later results; recorded points never change.
  const rule2 = ok(await call('/admin/rules', 'POST', { contentId: game, maxStars: 5, passStars: 3, definition: { starPoints: [0, 0, 0, 10, 15, 20] } }, admin.accessToken), 201);
  const before = await source.query('SELECT * FROM point_ledger ORDER BY id');
  assert.equal(ok(await submit(A({ stars: 5 }), s2), 201).pointsAwarded, 20);
  const newer = (await source.query("SELECT scoring_rule_id FROM game_attempts WHERE student_id=$1 AND stars=5 AND content_id=$2", [s2.user.id, game]))[0];
  assert.equal(newer.scoring_rule_id, rule2.id);
  const after = new Map((await source.query('SELECT * FROM point_ledger')).map(r => [r.id, r]));
  for (const old of before) assert.deepEqual(after.get(old.id), old);
  assert.equal(ok(await submit(A({ stars: 5 })), 201).pointsAwarded, 0, 'a lower-valued newer rule never subtracts or re-pays');
  assert.equal((await ledger(s1, `AND attempt_id IN (SELECT id FROM game_attempts WHERE content_id='${game}')`)).reduce((n, l) => n + l.delta, 0), 40);

  // Assignment turns are separate contexts with their own progress and points.
  const cls = ok(await call('/teacher/classes', 'POST', { name: 'Att ' + tag }, teacher.accessToken), 201);
  for (const s of [s1, s2]) ok(await call('/classes/join', 'POST', { code: cls.joinCode }, s.accessToken));
  const assign = async (body = {}) => ok(await call('/teacher/assignments', 'POST', { classId: cls.id, contentId: game, audience: 'whole_class', endsAt: hours(48), ...body }, teacher.accessToken), 201);
  const t1 = await assign();
  const t2 = await assign();
  const inTurn = (id, over = {}) => A({ context: 'assignment', assignmentId: id, ...over });
  const r1 = ok(await submit(inTurn(t1.id, { stars: 4 })), 201);
  assert.deepEqual([r1.progress.attemptCount, r1.progress.bestStars, r1.pointsAwarded, r1.assignmentId], [1, 4, 15, t1.id], 'Adventure best (5) does not carry into the turn');
  const r2 = ok(await submit(inTurn(t2.id, { stars: 3 })), 201);
  assert.deepEqual([r2.progress.attemptCount, r2.progress.bestStars, r2.pointsAwarded], [1, 3, 10], 'a fresh turn of the same game starts from zero');
  assert.equal(ok(await submit(inTurn(t1.id, { stars: 5 })), 201).pointsAwarded, 5);
  const ledger1 = await source.query('SELECT delta, source, assignment_id FROM point_ledger WHERE assignment_id=$1 ORDER BY created_at', [t1.id]);
  assert.deepEqual(ledger1.map(l => [l.delta, l.source]), [[15, 'assignment'], [5, 'assignment']]);
  const turn1 = ok(await call('/assignments/mine/' + t1.id));
  assert.deepEqual([turn1.status, turn1.bestStars, turn1.attemptCount, turn1.points], ['passed', 5, 2, 20]);
  assert.deepEqual([ok(await call('/assignments/mine/' + t2.id)).points, (await progressOf()).best_stars], [10, 5]);
  const teacherView = ok(await call(`/teacher/assignments/${t1.id}/progress`, 'GET', undefined, teacher.accessToken));
  assert.equal(teacherView.students.find(s => s.studentId === s1.user.id).points, 20);

  // Assignment access and window rules.
  assert.equal((await submit(inTurn(t1.id, { contentId: next }))).status, 400, 'content must match the turn');
  assert.equal((await submit(inTurn(randomUUID()))).status, 404);
  assert.equal((await submit(inTurn(t1.id), s3)).status, 404, 'not addressed to this student');
  const later = await assign({ startsAt: hours(24), endsAt: hours(48) });
  assert.equal((await submit(inTurn(later.id))).status, 409, 'not started');
  const over = await assign();
  await source.query("UPDATE assignments SET starts_at=now()-interval '3 days', ends_at=now()-interval '1 day' WHERE id=$1", [over.id]);
  assert.equal((await submit(inTurn(over.id))).status, 409, 'window closed');
  const stopped = await assign();
  ok(await call(`/teacher/assignments/${stopped.id}/cancel`, 'POST', undefined, teacher.accessToken));
  assert.equal((await submit(inTurn(stopped.id))).status, 409, 'cancelled');
  await source.query("UPDATE content_items SET status='draft' WHERE id=$1", [game]);
  assert.equal((await submit(inTurn(t2.id, { stars: 5 }))).status, 409, 'content no longer published');
  assert.equal((await submit(A())).status, 404, 'Adventure hides unpublished content too');
  await source.query("UPDATE content_items SET status='published' WHERE id=$1", [game]);
  ok(await call('/classes/leave', 'POST'));
  assert.equal((await submit(inTurn(t1.id, { stars: 5 }))).status, 404, 'left the class');
  assert.equal(await count("SELECT count(*)::int AS n FROM game_attempts WHERE student_id=$1 AND context='assignment' AND assignment_id = ANY($2)", [s1.user.id, [later.id, over.id, stopped.id]]), 0);
  // Recorded history cannot be rewritten.
  await assert.rejects(() => source.query('UPDATE point_ledger SET delta=1 WHERE attempt_id=$1', [first.attemptId]), e => (e.driverError?.code ?? e.code) === '23000');
  console.log('PASS BE-16 ledger: improvement-only deltas, atomic concurrent awards, rule versions never rewrite, independent assignment turns');
};
