const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const student = await login('adventure-student@example.com');
  const rival = await login('adventure-rival@example.com');
  const tag = randomUUID().slice(0, 8);
  let position = Number((await source.query('SELECT COALESCE(max(position),0)+1000 AS p FROM adventure_stages'))[0].p);
  const stage = async (title, kind, status, prerequisite = null, unlockStars = 3, released = true) => {
    const c = (await source.query('INSERT INTO content_items(title,subject,kind,status) VALUES ($1,$2,$3,$4) RETURNING id',
      [title + ' ' + tag, 'Adventure-' + tag, kind, status]))[0];
    await source.query('INSERT INTO content_versions(content_id,version,unity_id,published_at) VALUES ($1,1,$2,$3)',
      [c.id, 'unity.' + title + '.' + tag, released ? new Date(Date.now() - 86400000) : null]);
    await source.query('INSERT INTO adventure_stages(content_id,position,prerequisite_content_id,unlock_stars) VALUES ($1,$2,$3,$4)',
      [c.id, position++, prerequisite, unlockStars]);
    return c.id;
  };
  const a = await stage('A', 'adventure', 'published');
  const b = await stage('B', 'both', 'published', a);
  const c = await stage('C', 'adventure', 'published', b, 4);
  // Not on the map: practice-only, draft, and an unreleased version.
  const hidden = [await stage('P', 'practice', 'published'), await stage('D', 'adventure', 'draft'),
    await stage('U', 'adventure', 'published', null, 3, false)];
  const progress = (who, id, stars) => source.query(`INSERT INTO adventure_progress(student_id,content_id,best_stars,attempt_count,first_passed_at)
    VALUES ($1,$2,$3,1,${stars >= 3 ? 'now()' : 'NULL'}) ON CONFLICT (student_id,content_id)
    DO UPDATE SET best_stars=EXCLUDED.best_stars, attempt_count=adventure_progress.attempt_count+1, first_passed_at=COALESCE(adventure_progress.first_passed_at, EXCLUDED.first_passed_at)`, [who.user.id, id, stars]);
  const map = async (who = student) => {
    const res = await request('/adventure/map', { token: who.accessToken });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const mine = res.data.stages.filter(s => [a, b, c, ...hidden].includes(s.contentId));
    return { ...res.data, mine, by: Object.fromEntries(mine.map(s => [s.contentId, s])) };
  };

  assert.equal((await request('/adventure/map')).status, 401);
  for (const user of [teacher, admin]) assert.equal((await request('/adventure/map', { token: user.accessToken })).status, 403);

  // Fresh student: only the entry stage is open; order, prerequisites and hidden stages are respected.
  let m = await map();
  assert.deepEqual(m.mine.map(s => s.contentId), [a, b, c]);
  assert.deepEqual(m.mine.map(s => s.position), [...m.mine.map(s => s.position)].sort((x, y) => x - y));
  assert.deepEqual(m.mine.map(s => s.status), ['unlocked', 'locked', 'locked']);
  assert.equal(m.by[a].prerequisiteContentId, null);
  assert.equal(m.by[b].prerequisiteContentId, a);
  assert.equal(m.by[c].unlockStars, 4);
  assert.deepEqual([m.by[a].bestStars, m.by[a].attemptCount, m.by[a].maxStars, m.by[a].passStars, m.by[a].passed], [0, 0, 5, 3, false]);
  assert.equal(m.by[a].unityId, 'unity.A.' + tag);
  assert.deepEqual(Object.keys(m.by[a]).sort(), ['attemptCount', 'bestStars', 'contentId', 'firstPassedAt', 'lastAttemptAt', 'maxStars', 'passStars', 'passed',
    'position', 'prerequisiteContentId', 'status', 'subject', 'title', 'unityId', 'unlockStars', 'version']);
  assert.equal(m.stages[0].position <= m.stages[m.stages.length - 1].position, true);

  // Below the threshold keeps the next stage locked; the threshold itself opens it.
  await progress(student, a, 2);
  m = await map();
  assert.deepEqual(m.mine.map(s => s.status), ['unlocked', 'locked', 'locked']);
  assert.equal(m.by[a].passed, false);
  assert.equal(m.nextContentId, m.stages.find(s => s.status === 'unlocked' && !s.passed).contentId);
  await progress(student, a, 3);
  m = await map();
  assert.deepEqual(m.mine.map(s => s.status), ['unlocked', 'unlocked', 'locked']);
  assert.equal(m.by[a].passed, true);
  assert.equal(m.by[a].attemptCount, 2);
  assert.ok(m.by[a].firstPassedAt);
  assert.equal(m.nextContentId === b || m.stages.findIndex(s => s.contentId === m.nextContentId) < m.stages.findIndex(s => s.contentId === b), true);

  // A stage-specific threshold (4) is honored: 3 stars on B is not enough for C.
  await progress(student, b, 3);
  assert.equal((await map()).by[c].status, 'locked');
  await progress(student, b, 4);
  assert.equal((await map()).by[c].status, 'unlocked');

  // Another student is unaffected and teacher assignment results never unlock anything.
  m = await map(rival);
  assert.deepEqual(m.mine.map(s => s.status), ['unlocked', 'locked', 'locked']);
  assert.equal(m.by[a].bestStars, 0);
  const cls = (await request('/teacher/classes', { method: 'POST', body: { name: 'Adv ' + tag }, token: teacher.accessToken })).data;
  const assignment = (await source.query(`INSERT INTO assignments(teacher_id,class_id,content_id,audience,starts_at,ends_at)
    VALUES ($1,$2,$3,'selected',now(),now()+interval '7 days') RETURNING id`, [teacher.user.id, cls.id, a]))[0];
  await source.query('INSERT INTO assignment_recipients(assignment_id,student_id) VALUES ($1,$2)', [assignment.id, rival.user.id]);
  await source.query('INSERT INTO assignment_progress(assignment_id,student_id,best_stars,attempt_count) VALUES ($1,$2,5,1)', [assignment.id, rival.user.id]);
  m = await map(rival);
  assert.deepEqual(m.mine.map(s => s.status), ['unlocked', 'locked', 'locked']);
  assert.equal(m.by[a].bestStars, 0);

  // Earned progress is never re-locked, even if the prerequisite record later reads lower.
  await source.query('UPDATE adventure_progress SET best_stars=0 WHERE student_id=$1 AND content_id=$2', [student.user.id, a]);
  assert.equal((await map()).by[b].status, 'unlocked');
  await source.query('UPDATE adventure_progress SET best_stars=4 WHERE student_id=$1 AND content_id=$2', [student.user.id, a]);

  // A content-specific scoring rule changes the pass line and star ceiling for that stage only.
  await source.query("INSERT INTO scoring_rules(content_id,version,max_stars,pass_stars,definition) VALUES ($1,1,6,5,'{}')", [c]);
  m = await map();
  assert.deepEqual([m.by[c].maxStars, m.by[c].passStars], [6, 5]);
  assert.deepEqual([m.by[a].maxStars, m.by[a].passStars], [5, 3]);

  // Everything passed leaves nothing to play among these stages; publication changes take effect at once.
  await source.query("UPDATE content_items SET status='archived' WHERE id=$1", [b]);
  m = await map();
  assert.deepEqual(m.mine.map(s => s.contentId), [a, c]);
  await source.query("UPDATE content_items SET status='published' WHERE id=$1", [b]);
  console.log('PASS BE-08 ordered Adventure map, prerequisite stars, per-student lock state and hidden stages');
};
