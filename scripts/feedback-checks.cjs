const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const tag = randomUUID().slice(0, 8);
  const [s1, s2, s3] = [await login(`fb-s1-${tag}@example.com`), await login(`fb-s2-${tag}@example.com`), await login(`fb-s3-${tag}@example.com`)];
  let other = await login(`fb-other-${tag}@example.com`);
  await source.query("UPDATE users SET role='teacher',auth_version=auth_version+1 WHERE id=$1", [other.user.id]);
  other = await login(`fb-other-${tag}@example.com`);
  const call = (path, method = 'GET', body, token = s1.accessToken) => request(path, { method, body, token });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
  const cls = ok(await call('/teacher/classes', 'POST', { name: 'Fb ' + tag }, teacher.accessToken), 201);
  for (const s of [s1, s2]) ok(await call('/classes/join', 'POST', { code: cls.joinCode }, s.accessToken));

  const mk = async name => {
    const row = (await source.query("INSERT INTO content_items(title,subject,kind,status) VALUES ($1,$2,'practice','published') RETURNING id", [name + tag, 'Fb-' + tag]))[0];
    await source.query("INSERT INTO content_versions(content_id,version,unity_id,published_at) VALUES ($1,1,$2,now() - interval '1 day')", [row.id, 'fb.' + row.id]);
    return row.id;
  };
  const game = await mk('Rated ');
  const unplayed = await mk('Unplayed ');
  const turn = ok(await call('/teacher/assignments', 'POST', { classId: cls.id, contentId: game, audience: 'whole_class', endsAt: new Date(Date.now() + 86400000).toISOString() }, teacher.accessToken), 201);
  const play = async (who, stars) => ok(await call('/attempts', 'POST', { attemptId: randomUUID(), contentId: game, context: 'assignment', assignmentId: turn.id, stars, durationSeconds: 10 }, who.accessToken), 201);
  const rate = (who, body) => call('/feedback', 'POST', body, who.accessToken);

  // Access and validation.
  assert.equal((await request('/feedback', { method: 'POST', body: { contentId: game, rating: 3 } })).status, 401);
  for (const user of [teacher, admin]) assert.equal((await call('/feedback/' + game, 'GET', undefined, user.accessToken)).status, 403);
  assert.equal((await call('/teacher/feedback', 'GET', undefined, s1.accessToken)).status, 403);
  assert.equal((await call('/admin/feedback', 'GET', undefined, teacher.accessToken)).status, 403);
  for (const body of [{}, { contentId: game }, { contentId: game, rating: 0 }, { contentId: game, rating: 5 }, { contentId: game, rating: 2.5 }, { contentId: game, rating: '3' },
    { contentId: 'x', rating: 3 }, { contentId: game, rating: 3, studentId: s2.user.id }, { contentId: game, rating: 3, stars: 5 }]) {
    assert.equal((await rate(s1, body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(ok(await call('/feedback/' + game)), { contentId: game, rating: null, createdAt: null });
  assert.equal((await call('/feedback/invalid')).status, 400);
  assert.equal((await rate(s1, { contentId: game, rating: 3 })).status, 404, 'must have played the game');
  assert.equal((await rate(s1, { contentId: randomUUID(), rating: 3 })).status, 404);

  // Ratings are independent of performance: record scores first, then compare after rating.
  await play(s1, 2);
  await play(s2, 5);
  const performance = async () => JSON.stringify([
    await source.query('SELECT student_id, delta, source FROM point_ledger WHERE student_id = ANY($1) ORDER BY id', [[s1.user.id, s2.user.id]]),
    await source.query('SELECT student_id, best_stars, attempt_count FROM assignment_progress WHERE assignment_id=$1 ORDER BY student_id', [turn.id]),
  ]);
  const before = await performance();
  const first = ok(await rate(s1, { contentId: game, rating: 3 }), 201);
  assert.deepEqual([first.contentId, first.rating], [game, 3]);
  assert.ok(first.createdAt);
  assert.equal(await performance(), before, 'feedback does not touch stars, progress or points');
  // One current rating per game: later optional ratings may replace it.
  const again = await rate(s1, { contentId: game, rating: 3 });
  assert.equal(again.status, 200);
  assert.deepEqual(again.data, first);
  const changed = await rate(s1, { contentId: game, rating: 4 });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.rating, 4);
  assert.equal(changed.data.createdAt, first.createdAt, 'editing preserves the first-rating time');
  assert.equal(ok(await call('/feedback/' + game)).rating, 4);
  const race = await Promise.all([rate(s2, { contentId: game, rating: 4 }), rate(s2, { contentId: game, rating: 4 }), rate(s2, { contentId: game, rating: 1 })]);
  assert.equal(race.filter(r => r.status === 201).length, 1);
  assert.equal(race.filter(r => r.status === 200).length, 2);
  ok(await rate(s2, { contentId: game, rating: 4 }));
  assert.equal((await source.query('SELECT count(*)::int AS n FROM game_feedback WHERE student_id=$1 AND content_id=$2', [s2.user.id, game]))[0].n, 1);
  assert.equal(ok(await call('/feedback/' + game, 'GET', undefined, s3.accessToken)).rating, null, 'ratings are private per student');
  assert.equal((await source.query('SELECT rating FROM game_feedback WHERE student_id=$1', [s1.user.id]))[0].rating, 4);
  await assert.rejects(() => source.query('INSERT INTO game_feedback(student_id,content_id,rating) VALUES ($1,$2,5)', [s3.user.id, game]), e => (e.driverError?.code ?? e.code) === '23514');

  // Teacher: only current students of their own active classes; no emails.
  const view = ok(await call('/teacher/feedback?contentId=' + game, 'GET', undefined, teacher.accessToken));
  assert.equal(view.summary.count, 2);
  assert.ok(view.summary.average > 0);
  assert.deepEqual(view.items.map(i => i.studentId).sort(), [s1.user.id, s2.user.id].sort());
  assert.deepEqual(Object.keys(view.items[0]).sort(), ['contentId', 'createdAt', 'displayName', 'rating', 'studentId', 'title']);
  assert.equal(ok(await call('/teacher/feedback?contentId=' + game + '&classId=' + cls.id, 'GET', undefined, teacher.accessToken)).items.length, 2);
  assert.equal(ok(await call('/teacher/feedback?contentId=' + game + '&classId=' + randomUUID(), 'GET', undefined, teacher.accessToken)).items.length, 0);
  assert.equal(ok(await call('/teacher/feedback?contentId=' + game, 'GET', undefined, other.accessToken)).summary.count, 0, 'another teacher sees nothing');
  assert.equal(ok(await call('/teacher/feedback?contentId=' + game + '&limit=1', 'GET', undefined, teacher.accessToken)).items.length, 1);
  for (const q of ['?limit=0', '?classId=x', '?owner=1']) assert.equal((await call('/teacher/feedback' + q, 'GET', undefined, teacher.accessToken)).status, 400, q);
  ok(await call('/classes/leave', 'POST', undefined, s2.accessToken));
  assert.deepEqual(ok(await call('/teacher/feedback?contentId=' + game, 'GET', undefined, teacher.accessToken)).items.map(i => i.studentId), [s1.user.id]);

  // Admin: aggregate plus items.
  const adminView = ok(await call('/admin/feedback?contentId=' + game, 'GET', undefined, admin.accessToken));
  assert.deepEqual([adminView.summary.count, adminView.summary.distribution[3], adminView.summary.distribution[4]], [2, 0, 2]);
  assert.equal(adminView.summary.average, 4);
  assert.equal(adminView.items.length, 2);
  assert.equal(ok(await call('/admin/feedback?contentId=' + unplayed, 'GET', undefined, admin.accessToken)).summary.average, null);
  console.log('PASS BE-17 feedback 1-4: one editable current rating per game, independent of scoring, visible to the right teacher and admin');
};
