// BE-22: the whole journey through the public API only (fixtures are made with the admin API).
// independent student -> Adventure -> join class -> assignments -> duplicates and concurrency -> change class.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const tag = randomUUID().slice(0, 8);
  const call = (who, path, method = 'GET', body) => request(path, { method, body, token: who.accessToken });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
  const hours = h => new Date(Date.now() + h * 3600000).toISOString();
  let teacherB = await login(`scn-teacher-b-${tag}@example.com`);
  ok(await call(admin, `/admin/users/${teacherB.user.id}/role`, 'PATCH', { role: 'teacher', reason: 'scenario' }));
  teacherB = await login(`scn-teacher-b-${tag}@example.com`);
  const student = await login(`scn-student-${tag}@example.com`);
  const total = async () => (await source.query('SELECT COALESCE(sum(delta),0)::int AS n FROM point_ledger WHERE student_id=$1', [student.user.id]))[0].n;

  // --- Admin prepares content: two Adventure games and one practice game, each with points 0,0,0,20,30,40.
  const publish = async (title, kind) => {
    const created = ok(await call(admin, '/admin/content', 'POST', { title: `${title} ${tag}`, subject: 'Scenario-' + tag, kind, unityId: `scenario.${title}.${tag}` }), 201);
    ok(await call(admin, `/admin/content/${created.id}/versions/1/publish`, 'POST'));
    ok(await call(admin, '/admin/rules', 'POST', { contentId: created.id, maxStars: 5, passStars: 3, definition: { starPoints: [0, 0, 0, 20, 30, 40] } }), 201);
    return created.id;
  };
  const g1 = await publish('Adv1', 'adventure');
  const g2 = await publish('Adv2', 'both');
  const practice = await publish('Practice', 'practice');
  const kept = ok(await call(admin, '/admin/adventure/path')).stages.filter(s => s.kind !== 'practice')
    .map(s => ({ contentId: s.contentId, prerequisiteContentId: s.prerequisiteContentId, unlockStars: s.unlockStars }));
  ok(await call(admin, '/admin/adventure/path', 'PUT', { stages: [...kept, { contentId: g1 }, { contentId: g2, prerequisiteContentId: g1, unlockStars: 3 }] }));
  const attempt = (body, who = student) => call(who, '/attempts', 'POST', { attemptId: randomUUID(), durationSeconds: 45, ...body });
  const adventureAttempt = (contentId, stars) => attempt({ contentId, context: 'adventure', stars });

  // --- 1. An independent student (no class) plays Adventure.
  assert.deepEqual(ok(await call(student, '/classes/mine')), { membership: null });
  assert.deepEqual(ok(await call(student, '/assignments/mine')), []);
  const stage = id => call(student, '/adventure/map').then(r => r.data.stages.find(s => s.contentId === id));
  assert.equal((await stage(g2)).status, 'locked');
  assert.equal((await adventureAttempt(g2, 3)).status, 403, 'locked until the prerequisite is passed');
  assert.equal(ok(await adventureAttempt(g1, 3), 201).pointsAwarded, 20);
  assert.equal((await stage(g2)).status, 'unlocked');
  assert.equal(ok(await adventureAttempt(g2, 4), 201).pointsAwarded, 30);
  assert.equal(await total(), 50);
  assert.equal(ok(await call(student, '/streak')).activeToday, true);
  assert.equal((await call(student, '/leaderboards/class')).status, 404);

  // --- 2. Joins class A; the teacher assigns the same practice game twice (two independent turns).
  const classA = ok(await call(teacher, '/teacher/classes', 'POST', { name: 'Scenario A ' + tag }), 201);
  const classB = ok(await call(teacherB, '/teacher/classes', 'POST', { name: 'Scenario B ' + tag }), 201);
  ok(await call(student, '/classes/join', 'POST', { code: classA.joinCode }));
  const assign = async (owner, cls) => ok(await call(owner, '/teacher/assignments', 'POST', { classId: cls.id, contentId: practice, audience: 'whole_class', endsAt: hours(72) }), 201);
  const turn1 = await assign(teacher, classA);
  const turn2 = await assign(teacher, classA);
  assert.notEqual(turn1.id, turn2.id);
  let mine = ok(await call(student, '/assignments/mine'));
  assert.deepEqual(mine.map(a => a.assignmentId).sort(), [turn1.id, turn2.id].sort());
  assert.ok(mine.every(a => a.status === 'not_started' && a.points === 0 && a.phase === 'active'), 'Adventure history does not complete turns');

  // --- 3. Duplicate and concurrent submissions.
  const same = randomUUID();
  const dupes = await Promise.all(Array.from({ length: 6 }, () => call(student, '/attempts', 'POST', { attemptId: same, contentId: practice, context: 'assignment', assignmentId: turn1.id, stars: 4, durationSeconds: 60 })));
  assert.deepEqual(dupes.map(r => r.status).sort(), [200, 200, 200, 200, 200, 201]);
  for (const r of dupes) assert.deepEqual({ ...r.data, duplicate: false }, { ...dupes.find(x => x.status === 201).data, duplicate: false });
  assert.equal(dupes.find(x => x.status === 201).data.pointsAwarded, 30);
  assert.equal((await source.query('SELECT count(*)::int AS n FROM game_attempts WHERE id=$1', [same]))[0].n, 1);
  assert.equal(await total(), 80);
  // Distinct concurrent improvements in turn 2 pay the difference exactly once in total (40).
  const race = await Promise.all([3, 4, 5, 5, 4, 3].map(stars => attempt({ contentId: practice, context: 'assignment', assignmentId: turn2.id, stars })));
  assert.ok(race.every(r => r.status === 201));
  assert.equal(race.reduce((n, r) => n + r.data.pointsAwarded, 0), 40);
  const t2 = ok(await call(student, '/assignments/mine/' + turn2.id));
  assert.deepEqual([t2.bestStars, t2.attemptCount, t2.points, t2.status], [5, 6, 40, 'passed']);
  assert.equal(ok(await call(student, '/assignments/mine/' + turn1.id)).attemptCount, 1);
  assert.equal(await total(), 120);
  ok(await call(student, '/feedback', 'POST', { contentId: practice, rating: 3 }), 201);
  const seen = ok(await call(teacher, `/teacher/reports/assignments/${turn1.id}`));
  assert.deepEqual([seen.students.length, seen.students[0].attemptCount, seen.students[0].bestStars, seen.students[0].feedbackRating, seen.students[0].points], [1, 1, 4, 3, 30]);

  // --- 4. Changes class: personal points and progress stay, class-bound data moves.
  const board = async scope => ok(await call(student, '/leaderboards/' + scope));
  const before = { points: await total(), best: (await stage(g2)).bestStars };
  ok(await call(student, '/classes/join', 'POST', { code: classB.joinCode }));
  assert.equal(ok(await call(student, '/classes/mine')).membership.classId, classB.id);
  assert.equal(ok(await call(student, '/classes/history')).length, 2);
  assert.deepEqual(ok(await call(student, '/assignments/mine')), [], 'class A turns leave the list');
  assert.equal((await call(teacher, `/teacher/reports/students/${student.user.id}`)).status, 404, 'former teacher loses access');
  assert.equal((await call(teacher, `/teacher/reports/assignments/${turn1.id}/students/${student.user.id}`)).status, 404);
  assert.equal(await total(), before.points);
  assert.equal((await stage(g2)).bestStars, before.best);
  const classBoard = await board('class');
  const meB = classBoard.top.concat(classBoard.me ? [classBoard.me] : []).find(e => e.isMe);
  assert.deepEqual([classBoard.className, classBoard.participants, meB.points], ['Scenario B ' + tag, 1, before.points]);
  const turn3 = await assign(teacherB, classB);
  mine = ok(await call(student, '/assignments/mine'));
  assert.deepEqual(mine.map(a => [a.assignmentId, a.status, a.points]), [[turn3.id, 'not_started', 0]], 'new class, new turn, fresh start');
  assert.equal((await attempt({ contentId: practice, context: 'assignment', assignmentId: turn1.id, stars: 5 })).status, 404, 'old class turn is closed to the student');
  const p3 = ok(await attempt({ contentId: practice, context: 'assignment', assignmentId: turn3.id, stars: 5 }), 201);
  assert.deepEqual([p3.pointsAwarded, p3.progress.attemptCount], [40, 1]);
  assert.equal(ok(await call(teacherB, `/teacher/reports/students/${student.user.id}`)).turns.length, 1);
  assert.equal(await total(), before.points + 40);

  // --- 5. Leaves the class: Adventure still works, class features stop.
  ok(await call(student, '/classes/leave', 'POST'));
  assert.equal((await attempt({ contentId: practice, context: 'assignment', assignmentId: turn3.id, stars: 5 })).status, 404);
  assert.equal(ok(await adventureAttempt(g1, 5), 201).pointsAwarded, 20, '3 -> 5 stars pays 40 - 20');
  const global = await board('global');
  const meGlobal = global.top.concat(global.me ? [global.me] : []).find(e => e.isMe);
  assert.equal(meGlobal.points, await total());
  assert.equal(await total(), before.points + 40 + 20);
  console.log('PASS BE-22 end-to-end scenario: independent student -> class -> assignments -> duplicates/concurrency -> class change, points and progress preserved');
};
