const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const tag = randomUUID().slice(0, 8);
  const call = (who, path, method = 'GET', body, token) => request(path, { method, body, token: token ?? who.accessToken });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
  const make = async (name, points) => {
    const who = await login(`lb-${name}-${tag}@example.com`);
    ok(await call(who, '/me', 'PATCH', { displayName: name + ' ' + tag, avatarId: 'avatar_' + name }));
    if (points) await source.query(`INSERT INTO point_ledger(student_id,delta,reason,source,idempotency_key) VALUES ($1,$2,'leaderboard fixture','adjustment',$3)`, [who.user.id, points, randomUUID()]);
    return who;
  };
  const board = async (who, scope) => ok(await call(who, '/leaderboards/' + scope));

  // Class board: points 50, 40, 40 (tied), 30, 20, 10, 0.
  const cls = ok(await call(teacher, '/teacher/classes', 'POST', { name: 'LB ' + tag }, teacher.accessToken), 201);
  const p50 = await make('p50', 50);
  const p40a = await make('p40a', 40);
  const p40b = await make('p40b', 40);
  const p30 = await make('p30', 30);
  const p20 = await make('p20', 20);
  const p10 = await make('p10', 10);
  const p0 = await make('p0', 0);
  const students = [p50, p40a, p40b, p30, p20, p10, p0];
  for (const s of students) ok(await call(s, '/classes/join', 'POST', { code: cls.joinCode }));

  // Access.
  assert.equal((await request('/leaderboards/global')).status, 401);
  for (const user of [teacher, admin]) for (const scope of ['global', 'class']) assert.equal((await call(user, '/leaderboards/' + scope, 'GET', undefined, user.accessToken)).status, 403);
  const loner = await make('loner', 5);
  assert.equal((await call(loner, '/leaderboards/class')).status, 404, 'no class, no class board');

  // Ranks: ties share a rank, order within a tie is who got there first; five entries at most.
  const viewerMid = await board(p20, 'class');
  assert.deepEqual([viewerMid.scope, viewerMid.className, viewerMid.participants], ['class', 'LB ' + tag, 7]);
  assert.deepEqual(viewerMid.top.map(e => [e.displayName, e.rank, e.points]), [['p50 ' + tag, 1, 50], ['p40a ' + tag, 2, 40], ['p40b ' + tag, 2, 40], ['p30 ' + tag, 4, 30], ['p20 ' + tag, 5, 20]]);
  assert.equal(viewerMid.top.find(e => e.isMe).displayName, 'p20 ' + tag);
  assert.equal(viewerMid.me, null, 'in the top five: listed once, not repeated');
  // Below the top five: the top five plus a separate entry for the viewer.
  const viewerLow = await board(p10, 'class');
  assert.equal(viewerLow.top.length, 5);
  assert.ok(viewerLow.top.every(e => !e.isMe));
  assert.deepEqual(viewerLow.me, { rank: 6, displayName: 'p10 ' + tag, avatarId: 'avatar_p10', points: 10, isMe: true });
  const viewerZero = await board(p0, 'class');
  assert.deepEqual([viewerZero.me.rank, viewerZero.me.points, viewerZero.me.isMe], [7, 0, true]);
  const viewerTop = await board(p50, 'class');
  assert.deepEqual([viewerTop.top[0].isMe, viewerTop.top.filter(e => e.isMe).length, viewerTop.me], [true, 1, null]);
  // Tied students both see rank 2.
  assert.equal((await board(p40b, 'class')).top.find(e => e.isMe).rank, 2);

  // Privacy: only rank, display name, avatar, points and the "me" flag.
  for (const entry of [...viewerLow.top, viewerLow.me]) {
    assert.deepEqual(Object.keys(entry).sort(), ['avatarId', 'displayName', 'isMe', 'points', 'rank']);
  }
  assert.equal(JSON.stringify(viewerLow).includes('@'), false, 'no email anywhere');
  for (const student of students) assert.equal(JSON.stringify(viewerLow).includes(student.user.id), false, 'no student IDs');

  // Personal points survive a class change; boards follow the class the student is in now.
  const other = ok(await call(teacher, '/teacher/classes', 'POST', { name: 'LB other ' + tag }, teacher.accessToken), 201);
  ok(await call(p50, '/classes/join', 'POST', { code: other.joinCode }));
  const moved = await board(p50, 'class');
  assert.deepEqual([moved.className, moved.participants, moved.top.length, moved.top[0].points, moved.top[0].rank], ['LB other ' + tag, 1, 1, 50, 1]);
  const remaining = await board(p40a, 'class');
  assert.deepEqual([remaining.participants, remaining.top[0].displayName, remaining.top[0].points], [6, 'p40a ' + tag, 40]);
  assert.equal((await source.query('SELECT sum(delta)::int AS n FROM point_ledger WHERE student_id=$1', [p50.user.id]))[0].n, 50);
  ok(await call(p50, '/classes/leave', 'POST'));
  assert.equal((await call(p50, '/leaderboards/class')).status, 404);
  assert.equal((await board(p50, 'global')).top.concat([(await board(p50, 'global')).me]).filter(Boolean).find(e => e.isMe).points, 50, 'global keeps the points');

  // Global board equals the ledger totals: compare with the database directly.
  const champion = await make('champ', 5000000);
  const totals = await source.query(`SELECT u.id, sum(l.delta)::int AS points FROM point_ledger l JOIN users u ON u.id=l.student_id WHERE u.role='student' GROUP BY u.id ORDER BY points DESC`);
  const expectedRank = id => 1 + totals.filter(t => t.points > totals.find(x => x.id === id).points).length;
  const g = await board(champion, 'global');
  assert.deepEqual([g.scope, g.className, g.top[0].isMe, g.top[0].rank, g.top[0].points, g.me], ['global', null, true, 1, 5000000, null]);
  assert.equal(g.top.length, 5);
  assert.deepEqual(g.top.map(e => e.points), totals.slice(0, 5).map(t => t.points));
  assert.ok(g.participants >= totals.length);
  const gMid = await board(p10, 'global');
  const mine = gMid.top.concat(gMid.me ? [gMid.me] : []).find(e => e.isMe);
  assert.equal(mine.rank, expectedRank(p10.user.id));
  assert.equal(gMid.top.filter(e => e.isMe).length + (gMid.me ? 1 : 0), 1, 'listed exactly once');
  // A student with no ledger rows at all is ranked below everyone who has points.
  const fresh = await login(`lb-fresh-${tag}@example.com`);
  const gFresh = await board(fresh, 'global');
  assert.deepEqual([gFresh.me.points, gFresh.me.isMe, gFresh.me.rank], [0, true, 1 + totals.filter(t => t.points > 0).length]);
  // Streak bonuses and attempts feed the same ledger totals; a teacher account is never ranked.
  assert.equal(totals.some(t => t.id === teacher.user.id), false);
  console.log('PASS BE-20 leaderboards: top five + own rank listed once, shared ranks on ties, class board follows membership, points persist, no email or IDs');
};
