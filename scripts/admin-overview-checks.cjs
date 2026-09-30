const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const tag = randomUUID().slice(0, 8);
  const student = await login(`ov-student-${tag}@example.com`);
  const call = (path, method = 'GET', body, token = admin.accessToken) => request(path, { method, body, token });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };

  // Access.
  for (const path of ['/admin/overview', '/admin/audit']) {
    assert.equal((await request(path)).status, 401);
    for (const user of [student, teacher]) assert.equal((await call(path, 'GET', undefined, user.accessToken)).status, 403);
  }
  assert.equal((await call('/admin/audit?limit=0')).status, 400);
  assert.equal((await call('/admin/audit?actorId=x')).status, 400);
  assert.equal((await call('/admin/audit?other=1')).status, 400);

  // Every sensitive admin action is recorded with actor and server time.
  const content = ok(await call('/admin/content', 'POST', { title: 'Audit ' + tag, subject: 'Audit-' + tag, kind: 'practice', unityId: 'audit.' + tag }), 201);
  const id = content.id;
  ok(await call('/admin/content/' + id, 'PATCH', { title: 'Audit renamed ' + tag }));
  ok(await call(`/admin/content/${id}/versions`, 'POST', { unityId: 'audit.' + tag + '.v2' }), 201);
  ok(await call(`/admin/content/${id}/versions/2`, 'PATCH', { unityId: 'audit.' + tag + '.v2b' }));
  ok(await call(`/admin/content/${id}/versions/1/publish`, 'POST'));
  ok(await call(`/admin/content/${id}/versions/1/publish`, 'POST'));   // repeat: nothing changed, nothing recorded
  ok(await call(`/admin/content/${id}/unpublish`, 'POST'));
  ok(await call(`/admin/content/${id}/unpublish`, 'POST'));            // repeat
  ok(await call(`/admin/content/${id}/archive`, 'POST'));
  const rule = ok(await call('/admin/rules', 'POST', { contentId: id, maxStars: 5, passStars: 3 }), 201);
  const path = ok(await call('/admin/adventure/path')).stages.map(s => ({ contentId: s.contentId, prerequisiteContentId: s.prerequisiteContentId, unlockStars: s.unlockStars }));
  ok(await call('/admin/adventure/path', 'PUT', { stages: path }));
  const forContent = ok(await call(`/admin/audit?entityId=${id}&limit=100`));
  assert.deepEqual(forContent.map(e => e.action).reverse(), ['content.create', 'content.update', 'content.version.add', 'content.version.update', 'content.publish', 'content.unpublish', 'content.archive']);
  assert.ok(forContent.every(e => e.actorId === admin.user.id && e.entityType === 'content' && e.entityId === id && e.createdAt));
  assert.deepEqual(forContent.find(e => e.action === 'content.publish').details, { version: 1, releasedNow: true, previousStatus: 'draft' });
  assert.deepEqual(forContent.find(e => e.action === 'content.unpublish').details, { previousStatus: 'published' });
  assert.equal(forContent.find(e => e.action === 'content.update').details.changes.title, 'Audit renamed ' + tag);
  const ruleEntry = ok(await call(`/admin/audit?entityId=${rule.id}`));
  assert.deepEqual([ruleEntry.length, ruleEntry[0].action, ruleEntry[0].entityType, ruleEntry[0].details.version, ruleEntry[0].details.contentId], [1, 'rule.create', 'rule', 1, id]);
  const pathEntry = ok(await call('/admin/audit?action=adventure.path.replace&limit=1'));
  assert.deepEqual([pathEntry[0].entityId, pathEntry[0].entityType, pathEntry[0].details.stages], [null, 'adventure_path', path.length]);
  assert.equal(ok(await call('/admin/audit?actorId=' + admin.user.id + '&entityType=rule')).every(e => e.entityType === 'rule'), true);
  assert.equal(ok(await call('/admin/audit?actorId=' + randomUUID())).length, 0);
  assert.equal(ok(await call('/admin/audit?limit=2')).length, 2);
  // Failed changes leave no record and no change.
  const before = ok(await call('/admin/audit?limit=100')).length;
  assert.equal((await call(`/admin/content/${id}/versions/1`, 'PATCH', { unityId: 'x.y' })).status, 409);
  assert.equal((await call('/admin/rules', 'POST', { maxStars: 5, passStars: 9 })).status, 400);
  assert.equal(ok(await call('/admin/audit?limit=100')).length, before);
  // The record cannot be edited or removed, even with database access through the app.
  for (const sql of ['UPDATE admin_audit SET action=\'x\'', 'DELETE FROM admin_audit']) {
    await assert.rejects(() => source.query(sql), e => (e.driverError?.code ?? e.code) === '23000');
  }

  // Overview: counts, publication state, aggregated feedback without identities.
  const play = await login(`ov-player-${tag}@example.com`);
  const cls = ok(await call('/teacher/classes', 'POST', { name: 'Overview ' + tag }, teacher.accessToken), 201);
  ok(await call('/classes/join', 'POST', { code: cls.joinCode }, play.accessToken));
  const game = ok(await call('/admin/content', 'POST', { title: 'Overview game ' + tag, subject: 'Ov-' + tag, kind: 'practice', unityId: 'ov.' + tag }), 201).id;
  ok(await call(`/admin/content/${game}/versions/1/publish`, 'POST'));
  const turn = ok(await call('/teacher/assignments', 'POST', { classId: cls.id, contentId: game, audience: 'whole_class', endsAt: new Date(Date.now() + 86400000).toISOString() }, teacher.accessToken), 201);
  ok(await call('/attempts', 'POST', { attemptId: randomUUID(), contentId: game, context: 'assignment', assignmentId: turn.id, stars: 3, durationSeconds: 30 }, play.accessToken), 201);
  ok(await call('/feedback', 'POST', { contentId: game, rating: 4 }, play.accessToken), 201);
  const overview = ok(await call('/admin/overview'));
  const total = async sql => (await source.query(sql))[0].n;
  assert.equal(overview.usersByRole.student, await total("SELECT count(*)::int AS n FROM users WHERE role='student'"));
  assert.equal(overview.usersByRole.admin, await total("SELECT count(*)::int AS n FROM users WHERE role='admin'"));
  assert.equal(overview.classesByStatus.active, await total("SELECT count(*)::int AS n FROM classes WHERE status='active'"));
  assert.equal(overview.contentByStatus.published, await total("SELECT count(*)::int AS n FROM content_items WHERE status='published'"));
  assert.equal(overview.contentByStatus.archived, await total("SELECT count(*)::int AS n FROM content_items WHERE status='archived'"));
  assert.equal(overview.attemptsTotal, await total('SELECT count(*)::int AS n FROM game_attempts'));
  assert.ok(overview.attemptsLast7Days >= 1);
  assert.ok(overview.assignmentsByPhase.active >= 1);
  assert.equal(overview.suspiciousLast7Days, await total("SELECT count(*)::int AS n FROM suspicious_events WHERE created_at > now() - interval '7 days'"));
  const summary = overview.games.find(g => g.contentId === game);
  assert.deepEqual([summary.title, summary.status, summary.kind, summary.currentVersion, summary.attempts, summary.feedbackCount, summary.feedbackAverage, summary.feedbackDistribution],
    ['Overview game ' + tag, 'published', 'practice', 1, 1, 1, 4, { 1: 0, 2: 0, 3: 0, 4: 1 }]);
  const archived = overview.games.find(g => g.contentId === id);
  assert.deepEqual([archived.status, archived.feedbackCount, archived.feedbackAverage, archived.currentVersion], ['archived', 0, null, 1]);
  assert.equal(JSON.stringify(overview.games).includes(play.user.id), false, 'no student identities');
  assert.equal(JSON.stringify(overview).includes('@'), false, 'no emails');
  assert.deepEqual(overview.games.map(g => g.attempts), [...overview.games.map(g => g.attempts)].sort((a, b) => b - a));
  console.log('PASS BE-21 admin overview and audit: aggregated feedback, publication state, every content/rule/path change recorded with actor and time');
};
