const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const tag = randomUUID().slice(0, 8);
  const [s1, s2, s3] = [await login(`assign-s1-${tag}@example.com`), await login(`assign-s2-${tag}@example.com`), await login(`assign-s3-${tag}@example.com`)];
  let other = await login(`assign-other-${tag}@example.com`);
  await source.query("UPDATE users SET role='teacher',auth_version=auth_version+1 WHERE id=$1", [other.user.id]);
  other = await login(`assign-other-${tag}@example.com`);
  const call = (path, method = 'GET', body, token = teacher.accessToken) => request(path, { method, body, token });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
  const make = async (name, owner = teacher) => ok(await call('/teacher/classes', 'POST', { name: name + tag }, owner.accessToken), 201);
  const join = (student, cls) => call('/classes/join', 'POST', { code: cls.joinCode }, student.accessToken).then(r => ok(r));
  const content = async (kind, status = 'published', released = true) => {
    const row = (await source.query('INSERT INTO content_items(title,subject,kind,status) VALUES ($1,$2,$3,$4) RETURNING id', ['Assign ' + kind + ' ' + tag, 'Assign-' + tag, kind, status]))[0];
    await source.query('INSERT INTO content_versions(content_id,version,unity_id,published_at) VALUES ($1,1,$2,$3)', [row.id, 'assign.' + row.id, released ? new Date(Date.now() - 86400000) : null]);
    return row.id;
  };
  const hours = h => new Date(Date.now() + h * 3600000).toISOString();

  const cls = await make('Assign class ');
  const empty = await make('Assign empty ');
  const foreign = await make('Assign foreign ', other);
  for (const s of [s1, s2]) await join(s, cls);
  const practice = await content('practice');
  const both = await content('both');
  const adventureOnly = await content('adventure');
  const draft = await content('practice', 'draft');
  const unreleased = await content('practice', 'published', false);
  const base = { classId: cls.id, contentId: practice, audience: 'whole_class', endsAt: hours(24) };
  const post = (body, token) => call('/teacher/assignments', 'POST', body, token);

  // Access and validation.
  assert.equal((await request('/teacher/assignments')).status, 401);
  for (const user of [s1, admin]) {
    assert.equal((await call('/teacher/assignments', 'GET', undefined, user.accessToken)).status, 403);
    assert.equal((await post(base, user.accessToken)).status, 403);
  }
  for (const [why, body] of [
    ['empty', {}], ['bad audience', { ...base, audience: 'group' }], ['selected without ids', { ...base, audience: 'selected' }],
    ['ids with whole_class', { ...base, studentIds: [s1.user.id] }], ['empty ids', { ...base, audience: 'selected', studentIds: [] }],
    ['duplicate ids', { ...base, audience: 'selected', studentIds: [s1.user.id, s1.user.id] }], ['bad id', { ...base, audience: 'selected', studentIds: ['x'] }],
    ['no offset', { ...base, endsAt: '2099-01-01T00:00:00' }], ['not a date', { ...base, endsAt: 'tomorrow' }],
    ['ends in past', { ...base, endsAt: hours(-1) }], ['ends before start', { ...base, startsAt: hours(5), endsAt: hours(2) }],
    ['ends equals start', { ...base, startsAt: hours(5), endsAt: hours(5) }], ['window too long', { ...base, endsAt: hours(24 * 400) }],
    ['extra teacherId', { ...base, teacherId: other.user.id }], ['extra status', { ...base, status: 'cancelled' }],
  ]) assert.equal((await post(body)).status, 400, why);

  // Ownership, class state and content availability.
  assert.equal((await post({ ...base, classId: foreign.id })).status, 404);
  assert.equal((await post({ ...base, classId: randomUUID() })).status, 404);
  assert.equal((await post({ ...base, classId: empty.id })).status, 409);
  for (const bad of [adventureOnly, draft, unreleased, randomUUID()]) assert.equal((await post({ ...base, contentId: bad })).status, 404);
  assert.equal((await post({ ...base, audience: 'selected', studentIds: [s3.user.id] })).status, 400);
  assert.equal((await post({ ...base, audience: 'selected', studentIds: [s1.user.id, randomUUID()] })).status, 400);
  const scratch = await make('Assign scratch ');
  await call(`/teacher/classes/${scratch.id}/archive`, 'POST');
  assert.equal((await post({ ...base, classId: scratch.id })).status, 409);
  assert.equal((await source.query('SELECT 1 FROM assignments WHERE class_id = ANY($1)', [[foreign.id, empty.id, scratch.id]])).length, 0);

  // Whole class starts with current members and grows when students join; selected stays fixed.
  const whole = ok(await post(base), 201);
  assert.deepEqual([whole.audience, whole.status, whole.phase, whole.recipientCount, whole.classId, whole.contentId], ['whole_class', 'scheduled', 'active', 2, cls.id, practice]);
  assert.deepEqual(whole.recipients.map(r => r.studentId).sort(), [s1.user.id, s2.user.id].sort());
  assert.deepEqual(Object.keys(whole.recipients[0]).sort(), ['displayName', 'studentId']);
  assert.equal(whole.className, 'Assign class ' + tag);
  const selected = ok(await post({ classId: cls.id, contentId: both, audience: 'selected', studentIds: [s2.user.id], startsAt: hours(48), endsAt: hours(72) }), 201);
  assert.deepEqual([selected.phase, selected.recipientCount, selected.recipients[0].studentId], ['upcoming', 1, s2.user.id]);
  // Assigning the same content again is a fresh, independent allocation.
  const again = ok(await post(base), 201);
  assert.notEqual(again.id, whole.id);
  assert.equal((await source.query('SELECT count(*)::int AS n FROM assignments WHERE class_id=$1 AND content_id=$2', [cls.id, practice]))[0].n, 2);
  await join(s3, cls);
  const expanded = ok(await call('/teacher/assignments/' + whole.id));
  assert.equal(expanded.recipientCount, 3);
  assert.deepEqual(expanded.recipients.map(r => r.studentId).sort(), [s1.user.id, s2.user.id, s3.user.id].sort());
  assert.equal(ok(await call('/teacher/assignments/' + selected.id)).recipientCount, 1, 'selected recipients stay fixed');
  assert.equal(ok(await post(base), 201).recipientCount, 3);
  // Concurrent creation makes independent rows.
  const race = await Promise.all([post(base), post(base), post(base)]);
  assert.deepEqual(race.map(r => r.status), [201, 201, 201]);
  assert.equal(new Set(race.map(r => r.data.id)).size, 3);

  // Reading is scoped to the owning teacher.
  assert.deepEqual(ok(await call('/teacher/assignments/' + selected.id)), selected);
  assert.equal((await call('/teacher/assignments/' + whole.id, 'GET', undefined, other.accessToken)).status, 404);
  assert.equal((await call('/teacher/assignments/' + whole.id + '/cancel', 'POST', undefined, other.accessToken)).status, 404);
  assert.equal((await call('/teacher/assignments/invalid')).status, 400);
  assert.equal((await call('/teacher/assignments/' + randomUUID())).status, 404);
  assert.deepEqual(ok(await call('/teacher/assignments', 'GET', undefined, other.accessToken)), []);
  const all = ok(await call('/teacher/assignments?classId=' + cls.id));
  assert.equal(all.length, 7);
  assert.ok(all.every(a => a.classId === cls.id && a.recipients === undefined));
  assert.deepEqual(ok(await call('/teacher/assignments?classId=' + cls.id + '&phase=upcoming')).map(a => a.id), [selected.id]);
  assert.equal(ok(await call('/teacher/assignments?classId=' + cls.id + '&limit=2&offset=1')).length, 2);
  for (const q of ['?phase=late', '?limit=0', '?classId=x', '?owner=1']) assert.equal((await call('/teacher/assignments' + q)).status, 400, q);

  // Cancel keeps records, is idempotent, and is refused once the window ended.
  const cancelled = ok(await call(`/teacher/assignments/${whole.id}/cancel`, 'POST'));
  assert.deepEqual([cancelled.status, cancelled.phase, cancelled.recipientCount], ['cancelled', 'cancelled', 3]);
  assert.deepEqual(ok(await call(`/teacher/assignments/${whole.id}/cancel`, 'POST')), cancelled);
  assert.deepEqual(ok(await call('/teacher/assignments?classId=' + cls.id + '&phase=cancelled')).map(a => a.id), [whole.id]);
  await source.query("UPDATE assignments SET starts_at=now()-interval '2 days', ends_at=now()-interval '1 day' WHERE id=$1", [again.id]);
  assert.equal(ok(await call('/teacher/assignments/' + again.id)).phase, 'ended');
  assert.equal((await call(`/teacher/assignments/${again.id}/cancel`, 'POST')).status, 409);

  // Ended assignments can be extended; cancelled assignments cannot be reopened.
  const extend = (assignment, endsAt, token = teacher.accessToken) => call(`/teacher/assignments/${assignment.id}/extend`, 'POST', { endsAt }, token);
  assert.equal((await extend(again, hours(48), other.accessToken)).status, 404);
  assert.equal((await call(`/teacher/assignments/${again.id}/extend`, 'POST', { endsAt: 'tomorrow' })).status, 400);
  assert.equal((await extend(again, hours(-48))).status, 409, 'deadline only moves later');
  assert.equal((await extend(again, hours(24 * 400))).status, 400, 'maximum total window still applies');
  const reopened = ok(await extend(again, hours(48)));
  assert.equal(reopened.phase, 'active');
  assert.equal(reopened.recipientCount, 3);
  assert.ok(new Date(reopened.endsAt) > new Date());
  assert.equal((await extend(cancelled, hours(72))).status, 409, 'cancelled assignment stays cancelled');
  assert.equal((await call(`/teacher/assignments/${randomUUID()}/extend`, 'POST', { endsAt: hours(48) })).status, 404);

  await source.query("UPDATE users SET role='student',auth_version=auth_version+1 WHERE id=$1", [other.user.id]);
  assert.equal((await post({ ...base, classId: foreign.id }, other.accessToken)).status, 401);
  // A stale teacher session or demoted teacher cannot create assignments.
  console.log('PASS BE-10 teacher assignments: dynamic whole-class recipients, selected students, extension, windows, independent allocations and ownership');
};
