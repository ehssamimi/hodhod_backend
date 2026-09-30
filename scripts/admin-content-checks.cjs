const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const student = await login('admin-content-student@example.com');
  const tag = randomUUID().slice(0, 8);
  const call = (path, method = 'GET', body, token = admin.accessToken) => request(path, { method, body, token });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
  const rejectsDb = async (sql, params = []) => {
    await assert.rejects(() => source.query(sql, params), error => (error.driverError?.code ?? error.code) === '23000');
  };

  // Access boundaries on every route family.
  for (const [path, method] of [['/admin/content', 'GET'], ['/admin/content', 'POST'], ['/admin/adventure/path', 'GET'], ['/admin/adventure/path', 'PUT'],
    ['/admin/rules', 'GET'], ['/admin/rules', 'POST'], ['/admin/rules/effective', 'GET']]) {
    assert.equal((await request(path, { method })).status, 401, path);
    for (const user of [student, teacher]) assert.equal((await call(path, method, method === 'GET' ? undefined : {}, user.accessToken)).status, 403, path);
  }

  // Create: draft with unreleased version 1; clients cannot see it yet.
  const unity1 = 'admin.' + tag + '.v1';
  for (const body of [{}, { title: '', subject: 'S', kind: 'both', unityId: unity1 }, { title: 'T', subject: 'S', kind: 'other', unityId: unity1 },
    { title: 'T', subject: 'S', kind: 'both', unityId: 'bad id!' }, { title: 'T', subject: 'S', kind: 'both', unityId: unity1, status: 'published' },
    { title: 'T', subject: 'S', kind: 'both', unityId: unity1, grade: 0 }, { title: 'T', subject: 'S', kind: 'both', unityId: unity1, configuration: [] },
    { title: 'T', subject: 'S', kind: 'both', unityId: unity1, configuration: { big: 'x'.repeat(17000) } }]) {
    assert.equal((await call('/admin/content', 'POST', body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
  const created = ok(await call('/admin/content', 'POST', { title: ' Admin ' + tag, subject: 'Subj-' + tag, kind: 'both', unityId: unity1, configuration: { scene: 'A' } }), 201);
  const id = created.id;
  assert.equal(created.title, 'Admin ' + tag);
  assert.deepEqual([created.status, created.grade, created.latestVersion, created.currentVersion], ['draft', 3, 1, null]);
  assert.deepEqual([created.versions[0].unityId, created.versions[0].publishedAt, created.versions[0].configuration], [unity1, null, { scene: 'A' }]);
  assert.equal((await call('/content/' + id, 'GET', undefined, student.accessToken)).status, 404);
  assert.equal((await call('/admin/content/' + randomUUID())).status, 404);
  assert.equal((await call('/admin/content/invalid')).status, 400);

  // A Unity ID maps to a single content item.
  assert.equal((await call('/admin/content', 'POST', { title: 'Dup', subject: 'S', kind: 'practice', unityId: unity1 })).status, 409);
  assert.equal((await source.query("SELECT 1 FROM content_items WHERE title='Dup'")).length, 0);

  // Publish: server-side release time, item becomes visible with that Unity ID; repeat keeps the time.
  assert.equal((await call(`/admin/content/${id}/versions/9/publish`, 'POST')).status, 404);
  const published = ok(await call(`/admin/content/${id}/versions/1/publish`, 'POST'));
  assert.equal(published.status, 'published');
  assert.equal(published.currentVersion, 1);
  const releasedAt = published.versions[0].publishedAt;
  assert.ok(releasedAt);
  assert.equal((await call('/content/' + id, 'GET', undefined, student.accessToken)).data.unityId, unity1);
  assert.equal(ok(await call(`/admin/content/${id}/versions/1/publish`, 'POST')).versions[0].publishedAt, releasedAt);

  // Released versions are immutable; new work becomes a new unreleased version, invisible until released.
  assert.equal((await call(`/admin/content/${id}/versions/1`, 'PATCH', { unityId: 'admin.' + tag + '.fix' })).status, 409);
  await rejectsDb("UPDATE content_versions SET unity_id='x' WHERE content_id=$1 AND version=1", [id]);
  await rejectsDb('DELETE FROM content_versions WHERE content_id=$1 AND version=1', [id]);
  const unity2 = 'admin.' + tag + '.v2';
  const withV2 = ok(await call(`/admin/content/${id}/versions`, 'POST', { unityId: unity2, configuration: { scene: 'B' } }), 201);
  assert.deepEqual([withV2.latestVersion, withV2.currentVersion], [2, 1]);
  assert.equal((await call('/content/' + id, 'GET', undefined, student.accessToken)).data.unityId, unity1);
  assert.equal((await call(`/admin/content/${id}/versions/2`, 'PATCH', {})).status, 400);
  const fixed = ok(await call(`/admin/content/${id}/versions/2`, 'PATCH', { unityId: unity2 + '-fixed' }));
  assert.equal(fixed.versions[1].unityId, unity2 + '-fixed');
  ok(await call(`/admin/content/${id}/versions/2/publish`, 'POST'));
  const now = await call('/content/' + id, 'GET', undefined, student.accessToken);
  assert.deepEqual([now.data.unityId, now.data.version, now.data.id], [unity2 + '-fixed', 2, id]);
  ok(await call(`/admin/content/${id}/versions`, 'POST', { unityId: 'admin.' + tag + '.v3' }), 201);
  ok(await call(`/admin/content/${id}/versions/3/publish`, 'POST'));
  assert.equal(ok(await call(`/admin/content/${id}/versions/2/publish`, 'POST')).currentVersion, 3);
  // Publishing an older, still-unreleased version after a newer release is refused.
  ok(await call(`/admin/content/${id}/versions`, 'POST', { unityId: 'admin.' + tag + '.v4' }), 201);
  ok(await call(`/admin/content/${id}/versions`, 'POST', { unityId: 'admin.' + tag + '.v5' }), 201);
  ok(await call(`/admin/content/${id}/versions/5/publish`, 'POST'));
  assert.equal((await call(`/admin/content/${id}/versions/4/publish`, 'POST')).status, 409);

  // Metadata edits, listing and status transitions.
  assert.equal((await call('/admin/content/' + id, 'PATCH', {})).status, 400);
  assert.equal((await call('/admin/content/' + id, 'PATCH', { unityId: 'x' })).status, 400);
  assert.equal(ok(await call('/admin/content/' + id, 'PATCH', { title: 'Renamed ' + tag })).title, 'Renamed ' + tag);
  const listed = ok(await call('/admin/content?subject=' + encodeURIComponent('Subj-' + tag)));
  assert.deepEqual(listed.map(x => x.id), [id]);
  assert.equal(listed[0].versions, undefined);
  assert.equal(ok(await call('/admin/content?status=draft&subject=' + encodeURIComponent('Subj-' + tag))).length, 0);
  assert.equal((await call('/admin/content?status=gone')).status, 400);
  assert.equal(ok(await call(`/admin/content/${id}/unpublish`, 'POST')).status, 'draft');
  assert.equal((await call('/content/' + id, 'GET', undefined, student.accessToken)).status, 404);
  assert.equal(ok(await call(`/admin/content/${id}/archive`, 'POST')).status, 'archived');
  ok(await call(`/admin/content/${id}/versions/5/publish`, 'POST'));
  assert.equal((await call('/content/' + id, 'GET', undefined, student.accessToken)).status, 200);

  // Adventure path: order, prerequisites and stars are stored; the student map follows.
  const mk = async (name, kind) => ok(await call('/admin/content', 'POST', { title: name + tag, subject: 'Path-' + tag, kind, unityId: 'path.' + name + '.' + tag }), 201).id;
  const [s1, s2, s3, onlyPractice] = [await mk('S1', 'adventure'), await mk('S2', 'both'), await mk('S3', 'adventure'), await mk('PR', 'practice')];
  for (const sid of [s1, s2, s3]) ok(await call(`/admin/content/${sid}/versions/1/publish`, 'POST'));
  const existing = ok(await call('/admin/adventure/path')).stages
    .filter(x => x.kind !== 'practice')
    .map(x => ({ contentId: x.contentId, prerequisiteContentId: x.prerequisiteContentId, unlockStars: x.unlockStars }));
  const put = stages => call('/admin/adventure/path', 'PUT', { stages });
  const chain = [{ contentId: s1 }, { contentId: s2, prerequisiteContentId: s1 }, { contentId: s3, prerequisiteContentId: s2, unlockStars: 4 }];
  assert.equal((await put([...existing, ...chain, chain[0]])).status, 400);
  assert.equal((await put([...existing, { contentId: s2, prerequisiteContentId: s1 }, chain[0]])).status, 400);
  assert.equal((await put([...existing, { contentId: s1, prerequisiteContentId: s1 }])).status, 400);
  assert.equal((await put([...existing, { contentId: onlyPractice }])).status, 400);
  assert.equal((await put([...existing, { contentId: randomUUID() }])).status, 400);
  assert.equal((await put([...existing, chain[0], { contentId: s2, prerequisiteContentId: s1, unlockStars: 6 }])).status, 400);
  assert.equal((await put([...existing, chain[0], { contentId: s2, prerequisiteContentId: s1, unlockStars: 11 }])).status, 400);
  assert.equal((await call('/admin/adventure/path', 'PUT', { stages: [{ contentId: s1, position: 1 }] })).status, 400);
  const before = ok(await call('/admin/adventure/path')).stages.map(x => x.contentId);
  assert.ok(!before.includes(s1), 'rejected requests changed nothing');
  const path = ok(await put([...existing, ...chain])).stages;
  assert.deepEqual(path.map(x => x.position), path.map((_, i) => i + 1));
  const tail = path.slice(-3);
  assert.deepEqual(tail.map(x => x.contentId), [s1, s2, s3]);
  assert.deepEqual(tail.map(x => [x.prerequisiteContentId, x.unlockStars]), [[null, 3], [s1, 3], [s2, 4]]);
  const map = (await call('/adventure/map', 'GET', undefined, student.accessToken)).data.stages.filter(x => [s1, s2, s3].includes(x.contentId));
  assert.deepEqual(map.map(x => [x.contentId, x.status]), [[s1, 'unlocked'], [s2, 'locked'], [s3, 'locked']]);
  // Reordering rewrites positions without tripping the unique index; progress-free stages may be dropped.
  const reordered = ok(await put([...existing, chain[0], { contentId: s3, prerequisiteContentId: s1, unlockStars: 3 }, { contentId: s2, prerequisiteContentId: s3 }])).stages.slice(-3);
  assert.deepEqual(reordered.map(x => x.contentId), [s1, s3, s2]);
  assert.deepEqual(ok(await put([...existing, chain[0]])).stages.slice(-1).map(x => x.contentId), [s1]);
  ok(await put([...existing, ...chain]));
  // Progress protects a stage from removal, and nothing changes on refusal.
  await source.query('INSERT INTO adventure_progress(student_id,content_id,best_stars,attempt_count) VALUES ($1,$2,1,1)', [student.user.id, s2]);
  const refused = await put([...existing, chain[0]]);
  assert.equal(refused.status, 409, JSON.stringify(refused.data));
  assert.deepEqual(ok(await call('/admin/adventure/path')).stages.slice(-3).map(x => x.contentId), [s1, s2, s3]);
  // Changing a staged item to practice-only is refused; publish/hide does not touch the path.
  assert.equal((await call('/admin/content/' + s2, 'PATCH', { kind: 'practice' })).status, 409);
  assert.equal(ok(await call('/admin/content/' + s2, 'PATCH', { kind: 'adventure' })).kind, 'adventure');

  // Scoring rules: append-only versions, effective resolution, past points untouched.
  const rules0 = ok(await call('/admin/rules?scope=global'));
  const globalVersion = rules0.length ? Math.max(...rules0.map(r => r.version)) : 0;
  for (const body of [{}, { maxStars: 0, passStars: 0 }, { maxStars: 11, passStars: 3 }, { maxStars: 5, passStars: 6 }, { maxStars: 5, passStars: -1 },
    { maxStars: 5, passStars: 3, definition: [] }, { maxStars: 5, passStars: 3, version: 9 }, { maxStars: 5, passStars: 3, contentId: 'x' }]) {
    assert.equal((await call('/admin/rules', 'POST', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await call('/admin/rules', 'POST', { maxStars: 5, passStars: 3, contentId: randomUUID() })).status, 404);
  const ledgerBefore = await source.query('SELECT * FROM point_ledger ORDER BY id');
  const rulesBefore = await source.query('SELECT * FROM scoring_rules ORDER BY id');
  assert.ok(ledgerBefore.length > 0 && rulesBefore.length > 0);
  const eff0 = ok(await call('/admin/rules/effective?contentId=' + s1));
  const g = ok(await call('/admin/rules', 'POST', { maxStars: 5, passStars: 3, definition: { starPoints: { 3: 20 } } }), 201);
  assert.deepEqual([g.contentId, g.version, g.maxStars, g.passStars], [null, globalVersion + 1, 5, 3]);
  assert.deepEqual(g.definition, { starPoints: { 3: 20 } });
  const c1 = ok(await call('/admin/rules', 'POST', { contentId: s1, maxStars: 6, passStars: 4 }), 201);
  const c2 = ok(await call('/admin/rules', 'POST', { contentId: s1, maxStars: 4, passStars: 2 }), 201);
  assert.deepEqual([c1.version, c2.version], [1, 2]);
  const effective = ok(await call('/admin/rules/effective?contentId=' + s1));
  assert.deepEqual([effective.source, effective.maxStars, effective.passStars, effective.rule.id], ['content', 4, 2, c2.id]);
  const other = ok(await call('/admin/rules/effective?contentId=' + s3));
  assert.deepEqual([other.source, other.rule.id], ['global', g.id]);
  assert.equal(ok(await call('/admin/rules/effective')).rule.id, g.id);
  assert.ok(eff0.source);
  assert.deepEqual(ok(await call('/admin/rules?contentId=' + s1)).map(r => r.version), [2, 1]);
  assert.deepEqual(ok(await call('/admin/rules/' + c1.id)), c1);
  assert.equal((await call('/admin/rules/' + randomUUID())).status, 404);
  assert.equal((await call('/admin/rules/effective?contentId=' + randomUUID())).status, 404);
  // The stage map follows the newest content rule; earlier rows and the ledger are unchanged.
  const stage1 = (await call('/adventure/map', 'GET', undefined, student.accessToken)).data.stages.find(x => x.contentId === s1);
  assert.deepEqual([stage1.maxStars, stage1.passStars], [4, 2]);
  assert.deepEqual(await source.query('SELECT * FROM point_ledger ORDER BY id'), ledgerBefore);
  for (const row of rulesBefore) assert.deepEqual((await source.query('SELECT * FROM scoring_rules WHERE id=$1', [row.id]))[0], row);
  // The database itself refuses rewrites of rules and ledger entries.
  await rejectsDb('UPDATE scoring_rules SET pass_stars=0 WHERE id=$1', [c1.id]);
  await rejectsDb('DELETE FROM scoring_rules WHERE id=$1', [c1.id]);
  await rejectsDb('UPDATE point_ledger SET delta=delta+1 WHERE id=$1', [ledgerBefore[0].id]);
  await rejectsDb('DELETE FROM point_ledger WHERE id=$1', [ledgerBefore[0].id]);

  // Sessions issued before a role change stop working, and a demoted admin is refused.
  const late = await login('admin-content-late@example.com');
  await source.query("UPDATE users SET role='admin' WHERE id=$1", [late.user.id]);
  await source.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [late.user.id]);
  assert.equal((await call('/admin/content', 'GET', undefined, late.accessToken)).status, 401);
  const relogged = await login('admin-content-late@example.com');
  assert.equal((await call('/admin/content', 'GET', undefined, relogged.accessToken)).status, 200);
  await source.query("UPDATE users SET role='student' WHERE id=$1", [late.user.id]);
  assert.equal((await call('/admin/rules', 'POST', { maxStars: 5, passStars: 3 }, relogged.accessToken)).status, 403);
  console.log('PASS BE-09 admin content/version/Unity/publish, Adventure path, append-only scoring rules and immutable history');
};
