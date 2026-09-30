const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const tag = randomUUID().slice(0, 8);
  const [s1, s2, s3] = [await login(`val-s1-${tag}@example.com`), await login(`val-s2-${tag}@example.com`), await login(`val-s3-${tag}@example.com`)];
  const call = (path, method = 'GET', body, token = s1.accessToken) => request(path, { method, body, token });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
  const hours = h => new Date(Date.now() + h * 3600000).toISOString();
  const cls = ok(await call('/teacher/classes', 'POST', { name: 'Val ' + tag }, teacher.accessToken), 201);
  for (const s of [s1, s2]) ok(await call('/classes/join', 'POST', { code: cls.joinCode }, s.accessToken));
  const mk = async () => {
    const row = (await source.query("INSERT INTO content_items(title,subject,kind,status) VALUES ($1,$2,'both','published') RETURNING id", ['Val ' + tag, 'Val-' + tag]))[0];
    await source.query("INSERT INTO content_versions(content_id,version,unity_id,published_at) VALUES ($1,1,$2,now() - interval '1 day')", [row.id, 'val.' + row.id]);
    return row.id;
  };
  const game = await mk();
  const locked = await mk();
  const position = Number((await source.query('SELECT COALESCE(max(position),0)+1000 AS p FROM adventure_stages'))[0].p);
  await source.query('INSERT INTO adventure_stages(content_id,position) VALUES ($1,$2)', [game, position]);
  await source.query('INSERT INTO adventure_stages(content_id,position,prerequisite_content_id,unlock_stars) VALUES ($1,$2,$3,3)', [locked, position + 1, game]);
  const turn = ok(await call('/teacher/assignments', 'POST', { classId: cls.id, contentId: game, audience: 'whole_class', endsAt: hours(24) }, teacher.accessToken), 201);
  const submit = (who, body) => call('/attempts', 'POST', { durationSeconds: 60, attemptId: randomUUID(), ...body }, who.accessToken);
  const events = async (who, reason) => (await source.query('SELECT * FROM suspicious_events WHERE student_id=$1 AND reason=$2 ORDER BY created_at', [who.user.id, reason]));
  const attempts = async who => (await source.query('SELECT count(*)::int AS n FROM game_attempts WHERE student_id=$1', [who.user.id]))[0].n;
  const adv = (over = {}) => ({ contentId: game, context: 'adventure', stars: 3, ...over });
  const inTurn = (over = {}) => ({ contentId: game, context: 'assignment', assignmentId: turn.id, stars: 3, ...over });

  // Every rejected submission stores no attempt but leaves a traceable event.
  const cases = [
    ['stars_above_max', 400, s1, adv({ stars: 6 })],
    ['not_on_adventure_map', 404, s1, adv({ contentId: randomUUID() })],
    ['stage_locked', 403, s1, adv({ contentId: locked })],
    ['assignment_not_addressed', 404, s3, inTurn()],
    ['content_mismatch', 400, s1, inTurn({ contentId: locked })],
  ];
  for (const [reason, status, who, body] of cases) {
    assert.equal((await submit(who, body)).status, status, reason);
    const found = await events(who, reason);
    assert.equal(found.length, 1, reason);
    assert.equal(found[0].attempt_id, null);
    assert.equal(found[0].student_id, who.user.id);
    assert.ok(found[0].created_at && found[0].details.message);
  }
  assert.equal(await attempts(s1), 0);
  assert.equal(await attempts(s3), 0);
  assert.equal((await events(s1, 'stage_locked'))[0].content_id, locked);
  assert.equal((await events(s1, 'content_mismatch'))[0].assignment_id, turn.id);

  // Window and state problems.
  const later = ok(await call('/teacher/assignments', 'POST', { classId: cls.id, contentId: game, audience: 'whole_class', startsAt: hours(5), endsAt: hours(9) }, teacher.accessToken), 201);
  const over = ok(await call('/teacher/assignments', 'POST', { classId: cls.id, contentId: game, audience: 'whole_class', endsAt: hours(9) }, teacher.accessToken), 201);
  await source.query("UPDATE assignments SET starts_at=now()-interval '3 days', ends_at=now()-interval '1 day' WHERE id=$1", [over.id]);
  const gone = ok(await call('/teacher/assignments', 'POST', { classId: cls.id, contentId: game, audience: 'whole_class', endsAt: hours(9) }, teacher.accessToken), 201);
  ok(await call(`/teacher/assignments/${gone.id}/cancel`, 'POST', undefined, teacher.accessToken));
  for (const [reason, id] of [['assignment_not_started', later.id], ['window_closed', over.id], ['assignment_cancelled', gone.id]]) {
    assert.equal((await submit(s1, inTurn({ assignmentId: id }))).status, 409, reason);
    assert.equal((await events(s1, reason)).length, 1, reason);
  }

  // Attempt ID misuse is traced without leaking or reusing anyone's attempt.
  const shared = randomUUID();
  ok(await submit(s1, adv({ attemptId: shared, stars: 2 })), 201);
  assert.equal((await submit(s2, adv({ attemptId: shared, stars: 2 }))).status, 409);
  assert.equal((await events(s2, 'attempt_id_other_student')).length, 1);
  assert.equal((await submit(s1, adv({ attemptId: shared, stars: 3 }))).status, 409);
  assert.equal((await events(s1, 'attempt_id_data_mismatch')).length, 1);
  assert.equal(await attempts(s2), 0);
  assert.equal(await attempts(s1), 1);

  // Accepted but implausible: a passing result faster than any real play is stored and flagged.
  const fast = ok(await submit(s1, adv({ stars: 4, durationSeconds: 1 })), 201);
  const flagged = await events(s1, 'implausible_duration');
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].attempt_id, fast.attemptId);
  assert.deepEqual(flagged[0].details, { durationSeconds: 1, minimum: 3 });
  assert.equal((await source.query('SELECT count(*)::int AS n FROM game_attempts WHERE id=$1', [fast.attemptId]))[0].n, 1);
  ok(await submit(s1, adv({ stars: 4, durationSeconds: 90 })), 201);
  ok(await submit(s1, adv({ stars: 1, durationSeconds: 0 })), 201);
  assert.equal((await events(s1, 'implausible_duration')).length, 1, 'normal play and failing results are not flagged');
  assert.equal((await submit(s1, adv({ attemptId: fast.attemptId, stars: 4, durationSeconds: 1 }))).status, 200, 'a replay flags nothing new');
  assert.equal((await events(s1, 'implausible_duration')).length, 1);

  // Rate limit per account: excess submissions get 429 and are traced once per window.
  const previous = process.env.ATTEMPTS_PER_MINUTE;
  try {
    await source.query('DELETE FROM auth_rate_limits WHERE bucket=$1', ['attempt:' + s2.user.id]);
    process.env.ATTEMPTS_PER_MINUTE = '3';
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await submit(s2, adv({ stars: 1, durationSeconds: 30 }))).status);
    assert.deepEqual(statuses, [201, 201, 201, 429, 429]);
    assert.equal((await events(s2, 'rate_limited')).length, 2);
    assert.equal(await attempts(s2), 3, 'throttled submissions store nothing');
    assert.equal((await submit(s3, adv({ stars: 1 }))).status, 201, 'other accounts are unaffected');
  } finally { process.env.ATTEMPTS_PER_MINUTE = previous; }
  await source.query('DELETE FROM auth_rate_limits WHERE bucket=$1', ['attempt:' + s2.user.id]);
  ok(await submit(s2, adv({ stars: 1 })), 201);

  // Events are append-only and visible to admins only.
  await assert.rejects(() => source.query('DELETE FROM suspicious_events WHERE student_id=$1', [s1.user.id]), e => (e.driverError?.code ?? e.code) === '23000');
  await assert.rejects(() => source.query("UPDATE suspicious_events SET reason='x' WHERE student_id=$1", [s1.user.id]), e => (e.driverError?.code ?? e.code) === '23000');
  const listed = ok(await call('/admin/suspicious-events?studentId=' + s1.user.id, 'GET', undefined, admin.accessToken));
  assert.ok(listed.length >= 8);
  assert.ok(listed.every(e => e.studentId === s1.user.id));
  assert.deepEqual(Object.keys(listed[0]).sort(), ['assignmentId', 'attemptId', 'contentId', 'context', 'createdAt', 'details', 'id', 'reason', 'studentId']);
  assert.equal(ok(await call('/admin/suspicious-events?reason=rate_limited&studentId=' + s2.user.id, 'GET', undefined, admin.accessToken)).length, 2);
  assert.equal(ok(await call('/admin/suspicious-events?studentId=' + s1.user.id + '&limit=2', 'GET', undefined, admin.accessToken)).length, 2);
  for (const user of [s1, teacher]) assert.equal((await call('/admin/suspicious-events', 'GET', undefined, user.accessToken)).status, 403);
  assert.equal((await request('/admin/suspicious-events')).status, 401);
  assert.equal((await call('/admin/suspicious-events?limit=0', 'GET', undefined, admin.accessToken)).status, 400);
  console.log('PASS BE-18 attempt validity: rejections traced, implausible durations flagged, per-account rate limit, append-only review log');
};
