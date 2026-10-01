const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const tag = randomUUID().slice(0, 8);
  const s1 = await login(`mine-s1-${tag}@example.com`);
  const s2 = await login(`mine-s2-${tag}@example.com`);
  const s3 = await login(`mine-s3-${tag}@example.com`);
  const s4 = await login(`mine-s4-${tag}@example.com`);
  const call = (path, method = 'GET', body, token = s1.accessToken) => request(path, { method, body, token });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
  const make = async name => ok(await call('/teacher/classes', 'POST', { name: name + tag }, teacher.accessToken), 201);
  const join = async (student, cls) => ok(await request('/classes/join', { method: 'POST', body: { code: cls.joinCode }, token: student.accessToken }));
  const clsA = await make('Mine A ');
  const clsB = await make('Mine B ');
  for (const s of [s1, s2]) await join(s, clsA);
  await join(s3, clsB);
  const content = async (title, kind = 'practice') => {
    const row = (await source.query("INSERT INTO content_items(title,subject,kind,status) VALUES ($1,$2,$3,'published') RETURNING id", [title + ' ' + tag, 'Mine-' + tag, kind]))[0];
    await source.query("INSERT INTO content_versions(content_id,version,unity_id,published_at) VALUES ($1,1,$2,now() - interval '1 day')", [row.id, 'mine.' + row.id]);
    return row.id;
  };
  const game = await content('Game');
  const other = await content('Other', 'both');
  const hours = h => new Date(Date.now() + h * 3600000).toISOString();
  const assign = async (body, token = teacher.accessToken) => ok(await request('/teacher/assignments', { method: 'POST', body, token }), 201);
  const active = await assign({ classId: clsA.id, contentId: game, audience: 'whole_class', endsAt: hours(48) });
  const soon = await assign({ classId: clsA.id, contentId: other, audience: 'whole_class', endsAt: hours(5) });
  const upcoming = await assign({ classId: clsA.id, contentId: game, audience: 'whole_class', startsAt: hours(24), endsAt: hours(72) });
  const onlyS2 = await assign({ classId: clsA.id, contentId: game, audience: 'selected', studentIds: [s2.user.id], endsAt: hours(48) });
  const cancelled = await assign({ classId: clsA.id, contentId: game, audience: 'whole_class', endsAt: hours(48) });
  ok(await request(`/teacher/assignments/${cancelled.id}/cancel`, { method: 'POST', token: teacher.accessToken }));
  const ended = await assign({ classId: clsA.id, contentId: game, audience: 'whole_class', endsAt: hours(48) });
  await source.query("UPDATE assignments SET starts_at=now()-interval '3 days', ends_at=now()-interval '1 day' WHERE id=$1", [ended.id]);
  const bAssignment = await assign({ classId: clsB.id, contentId: game, audience: 'whole_class', endsAt: hours(48) });

  // Access.
  assert.equal((await request('/assignments/mine')).status, 401);
  for (const user of [teacher, admin]) assert.equal((await call('/assignments/mine', 'GET', undefined, user.accessToken)).status, 403);

  // s1 sees only turns addressed to them: open first (soonest deadline), then upcoming, then ended; cancelled/selected-for-others hidden.
  let list = ok(await call('/assignments/mine'));
  assert.deepEqual(list.map(a => [a.assignmentId, a.phase]), [[soon.id, 'active'], [active.id, 'active'], [upcoming.id, 'upcoming'], [ended.id, 'ended']]);
  assert.ok(list.every(a => a.classId === clsA.id));
  const first = list[1];
  assert.deepEqual([first.title, first.className, first.contentId, first.available, first.version, first.unityId],
    ['Game ' + tag, 'Mine A ' + tag, game, true, 1, 'mine.' + game]);
  assert.deepEqual([first.status, first.bestStars, first.attemptCount, first.points, first.maxStars, first.passStars, first.firstPassedAt, first.lastAttemptAt],
    ['not_started', 0, 0, 0, 5, 3, null, null]);
  assert.ok(new Date(first.startsAt) < new Date(first.endsAt));
  assert.deepEqual(Object.keys(first).sort(), ['assignmentId', 'attemptCount', 'available', 'bestStars', 'classId', 'className', 'contentId', 'endsAt', 'firstPassedAt', 'lastAttemptAt',
    'maxStars', 'passStars', 'phase', 'points', 'startsAt', 'status', 'subject', 'title', 'unityId', 'version']);
  // s2 additionally sees the assignment selected for them; s3 sees only class B; s4 has no class.
  assert.deepEqual(ok(await call('/assignments/mine', 'GET', undefined, s2.accessToken)).map(a => a.assignmentId).sort(),
    [soon.id, active.id, upcoming.id, onlyS2.id, ended.id].sort());
  assert.deepEqual(ok(await call('/assignments/mine', 'GET', undefined, s3.accessToken)).map(a => a.assignmentId), [bAssignment.id]);
  assert.deepEqual(ok(await call('/assignments/mine', 'GET', undefined, s4.accessToken)), []);

  // Filters and paging.
  assert.deepEqual(ok(await call('/assignments/mine?phase=upcoming')).map(a => a.assignmentId), [upcoming.id]);
  assert.deepEqual(ok(await call('/assignments/mine?phase=ended')).map(a => a.assignmentId), [ended.id]);
  assert.equal(ok(await call('/assignments/mine?phase=active')).length, 2);
  assert.deepEqual(ok(await call('/assignments/mine?limit=2&offset=1')).map(a => a.assignmentId), [active.id, upcoming.id]);
  for (const q of ['?phase=cancelled', '?phase=late', '?limit=0', '?limit=101', '?offset=-1', '?studentId=' + s2.user.id]) assert.equal((await call('/assignments/mine' + q)).status, 400, q);

  // Status per turn is independent: Adventure and another turn of the same game do not complete this one.
  const rule = (await source.query('SELECT id, max_stars FROM scoring_rules WHERE content_id IS NULL ORDER BY version DESC LIMIT 1'))[0];
  const position = Number((await source.query('SELECT COALESCE(max(position),0)+1000 AS p FROM adventure_stages'))[0].p);
  await source.query('INSERT INTO adventure_stages(content_id,position) VALUES ($1,$2)', [other, position]);
  await source.query('INSERT INTO adventure_progress(student_id,content_id,best_stars,attempt_count,first_passed_at,last_attempt_at) VALUES ($1,$2,5,2,now(),now())', [s1.user.id, other]);
  const attempt = async (student, assignmentId, stars, contentId) => (await source.query(`INSERT INTO game_attempts(student_id,content_id,content_version,context,assignment_id,
      scoring_rule_id,stars,max_stars,started_at,completed_at) VALUES ($1,$2,1,'assignment',$3,$4,$5,$6,now(),now()) RETURNING id`,
    [student.user.id, contentId, assignmentId, rule.id, stars, rule.max_stars]))[0].id;
  const a1 = await attempt(s1, active.id, 3, game);
  await source.query('INSERT INTO assignment_progress(assignment_id,student_id,best_stars,attempt_count,first_passed_at,last_attempt_at) VALUES ($1,$2,3,2,now(),now())', [active.id, s1.user.id]);
  await source.query(`INSERT INTO point_ledger(student_id,delta,reason,source,assignment_id,attempt_id,scoring_rule_id,idempotency_key) VALUES ($1,20,'fixture','assignment',$2,$3,$4,$5)`,
    [s1.user.id, active.id, a1, rule.id, randomUUID()]);
  const a2 = await attempt(s1, ended.id, 1, game);
  await source.query('INSERT INTO assignment_progress(assignment_id,student_id,best_stars,attempt_count,last_attempt_at) VALUES ($1,$2,1,1,now())', [ended.id, s1.user.id]);
  list = ok(await call('/assignments/mine'));
  const byId = Object.fromEntries(list.map(a => [a.assignmentId, a]));
  assert.deepEqual([byId[active.id].status, byId[active.id].bestStars, byId[active.id].attemptCount, byId[active.id].points], ['passed', 3, 2, 20]);
  assert.ok(byId[active.id].firstPassedAt);
  assert.deepEqual([byId[ended.id].status, byId[ended.id].bestStars, byId[ended.id].points, byId[ended.id].phase], ['in_progress', 1, 0, 'ended']);
  assert.deepEqual([byId[upcoming.id].status, byId[upcoming.id].points], ['not_started', 0], 'same game, different turn: untouched');
  assert.deepEqual([byId[soon.id].status, byId[soon.id].bestStars], ['not_started', 0], 'Adventure 5 stars does not complete the assignment');
  assert.equal(ok(await call('/assignments/mine', 'GET', undefined, s2.accessToken)).find(a => a.assignmentId === active.id).status, 'not_started');
  assert.ok(a2);

  // Detail is limited to your own visible turns.
  assert.deepEqual(ok(await call('/assignments/mine/' + active.id)), byId[active.id]);
  for (const id of [onlyS2.id, cancelled.id, bAssignment.id, randomUUID()]) assert.equal((await call('/assignments/mine/' + id)).status, 404);
  assert.equal((await call('/assignments/mine/invalid')).status, 400);
  assert.equal((await call('/assignments/mine/' + onlyS2.id, 'GET', undefined, s2.accessToken)).status, 200);

  // Content that is unpublished later stays listed but is not available and hides its Unity mapping.
  await source.query("UPDATE content_items SET status='draft' WHERE id=$1", [other]);
  const gone = ok(await call('/assignments/mine/' + soon.id));
  assert.deepEqual([gone.available, gone.unityId, gone.version, gone.phase], [false, null, null, 'active']);
  await source.query("UPDATE content_items SET status='published' WHERE id=$1", [other]);

  // Changing class moves the list with the student; records remain in the database.
  ok(await call('/classes/leave', 'POST'));
  assert.deepEqual(ok(await call('/assignments/mine')), []);
  await join(s1, clsB);
  // Joining a class adds the student to whole-class turns whose deadlines have not passed.
  assert.deepEqual(ok(await call('/assignments/mine')).map(a => a.assignmentId), [bAssignment.id]);
  const newer = await assign({ classId: clsB.id, contentId: game, audience: 'whole_class', endsAt: hours(48) });
  const classBTurns = ok(await call('/assignments/mine')).map(a => a.assignmentId);
  assert.deepEqual(new Set(classBTurns), new Set([newer.id, bAssignment.id]));
  assert.equal((await source.query('SELECT count(*)::int AS n FROM assignment_progress WHERE student_id=$1', [s1.user.id]))[0].n, 2);
  console.log('PASS BE-12 student assignment list: own turns only, window/phase, per-turn status, independent of Adventure and class changes');
};
