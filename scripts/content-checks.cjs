const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const student = await login('content-student@example.com');
  const tag = randomUUID().slice(0, 8);
  const subject = 'Catalog-' + tag;
  const item = async (title, kind, status, versions, subj = subject) => {
    const row = (await source.query(
      'INSERT INTO content_items(title,subject,kind,status) VALUES ($1,$2,$3,$4) RETURNING id', [title, subj, kind, status]))[0];
    for (const [version, unity, published] of versions) {
      await source.query('INSERT INTO content_versions(content_id,version,unity_id,published_at) VALUES ($1,$2,$3,$4)',
        [row.id, version, unity, published]);
    }
    return row.id;
  };
  const past = "now() - interval '1 day'";
  const at = async sql => (await source.query('SELECT ' + sql + ' AS t'))[0].t;
  const released = await at(past);
  const future = await at("now() + interval '1 day'");

  const adventure = await item('Adventure ' + tag, 'adventure', 'published', [[1, 'unity.adv', released]]);
  const practice = await item('Practice ' + tag, 'practice', 'published', [[1, 'unity.old', released], [2, 'unity.new', released]]);
  const both = await item('Both ' + tag, 'both', 'published', [[1, 'unity.both', released]]);
  const partial = await item('Partial ' + tag, 'practice', 'published', [[1, 'unity.v1', released], [2, 'unity.v2', null], [3, 'unity.v3', future]]);
  const draft = await item('Draft ' + tag, 'practice', 'draft', [[1, 'unity.draft', released]]);
  const archived = await item('Archived ' + tag, 'both', 'archived', [[1, 'unity.archived', released]]);
  const unreleased = await item('Unreleased ' + tag, 'practice', 'published', [[1, 'unity.unreleased', null]]);
  const scheduled = await item('Scheduled ' + tag, 'both', 'published', [[1, 'unity.scheduled', future]]);
  const noVersion = await item('NoVersion ' + tag, 'both', 'published', []);
  const hidden = [draft, archived, unreleased, scheduled, noVersion];

  const s = (path, token = student.accessToken) => request('/content' + path, { token });
  const t = (path, token = teacher.accessToken) => request('/teacher/content' + path, { token });
  const ids = res => res.data.map(x => x.id);

  // Authentication and role boundaries.
  for (const path of ['/content', '/teacher/content']) assert.equal((await request(path)).status, 401);
  for (const user of [teacher, admin]) assert.equal((await s('', user.accessToken)).status, 403);
  for (const user of [student, admin]) assert.equal((await t('', user.accessToken)).status, 403);

  // Students see only released content of the published items, with the newest released Unity ID.
  const all = await s('?subject=' + encodeURIComponent(subject));
  assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.deepEqual(ids(all).sort(), [adventure, practice, both, partial].sort());
  const byId = Object.fromEntries(all.data.map(x => [x.id, x]));
  assert.equal(byId[practice].unityId, 'unity.new');
  assert.equal(byId[practice].version, 2);
  assert.equal(byId[partial].unityId, 'unity.v1');
  assert.equal(byId[partial].version, 1);
  assert.equal(byId[adventure].grade, 3);
  assert.deepEqual(Object.keys(byId[adventure]).sort(), ['grade', 'id', 'kind', 'publishedAt', 'subject', 'title', 'unityId', 'version']);
  assert.deepEqual(ids(await s('?subject=' + encodeURIComponent(subject) + '&kind=adventure')).sort(), [adventure, both].sort());
  assert.deepEqual(ids(await s('?subject=' + encodeURIComponent(subject) + '&kind=practice')).sort(), [practice, both, partial].sort());
  assert.deepEqual(ids(await s('?subject=' + encodeURIComponent(subject) + '&q=BOTH')), [both]);
  assert.deepEqual((await s('?subject=' + encodeURIComponent(subject) + '&q=%25')).data, []);
  const page = await s('?subject=' + encodeURIComponent(subject) + '&limit=2&offset=1');
  assert.deepEqual(ids(page), ids(all).slice(1, 3));
  for (const query of ['?kind=both', '?limit=0', '?limit=101', '?limit=x', '?offset=-1', '?subject=', '?extra=1', '?q=' + 'x'.repeat(101)]) {
    assert.equal((await s(query)).status, 400, query);
  }
  assert.equal((await s('/' + adventure)).status, 200);
  assert.equal((await s('/' + practice)).data.unityId, 'unity.new');
  for (const id of hidden) assert.equal((await s('/' + id)).status, 404);
  assert.equal((await s('/' + randomUUID())).status, 404);
  assert.equal((await s('/invalid')).status, 400);

  // Teachers get only published practice-capable content.
  const teacherList = await t('?subject=' + encodeURIComponent(subject));
  assert.equal(teacherList.status, 200, JSON.stringify(teacherList.data));
  assert.deepEqual(ids(teacherList).sort(), [practice, both, partial].sort());
  assert.equal((await t('/' + practice)).status, 200);
  assert.equal((await t('/' + adventure)).status, 404);
  for (const id of hidden) assert.equal((await t('/' + id)).status, 404);
  assert.equal((await t('?kind=adventure')).status, 400);

  // Publishing state changes are visible immediately and never expose drafts.
  await source.query("UPDATE content_items SET status='archived' WHERE id=$1", [practice]);
  assert.equal((await s('/' + practice)).status, 404);
  assert.equal((await t('/' + practice)).status, 404);
  await source.query("UPDATE content_items SET status='published' WHERE id=$1", [practice]);
  assert.equal((await s('/' + practice)).status, 200);
  console.log('PASS BE-07 published-only content catalog, stable IDs, Unity mapping, filters and role boundaries');
};
