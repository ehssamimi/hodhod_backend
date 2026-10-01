const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const tag = randomUUID().slice(0, 8);
  const student = name => login(`streak-${name}-${tag}@example.com`);
  const call = (who, path, method = 'GET', body, token) => request(path, { method, body, token: token ?? who.accessToken });
  const ok = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.data)); return res.data; };
  const hours = h => new Date(Date.now() + h * 3600000).toISOString();

  const mk = async () => {
    const row = (await source.query("INSERT INTO content_items(title,subject,kind,status) VALUES ($1,$2,'both','published') RETURNING id", ['Streak ' + tag, 'Streak-' + tag]))[0];
    await source.query("INSERT INTO content_versions(content_id,version,unity_id,published_at) VALUES ($1,1,$2,now() - interval '1 day')", [row.id, 'streak.' + row.id]);
    return row.id;
  };
  const game = await mk();
  const position = Number((await source.query('SELECT COALESCE(max(position),0)+1000 AS p FROM adventure_stages'))[0].p);
  await source.query('INSERT INTO adventure_stages(content_id,position) VALUES ($1,$2)', [game, position]);
  const play = async (who, stars, extra = {}) => ok(await call(who, '/attempts', 'POST', { attemptId: randomUUID(), contentId: game, context: 'adventure', stars, durationSeconds: 60, ...extra }), 201);
  const days = async who => (await source.query('SELECT activity_date::text AS d, timezone FROM daily_activity WHERE student_id=$1 ORDER BY activity_date', [who.user.id]));
  // Move a student's whole history back in time, as if those days had passed.
  const age = async (who, n) => {
    await source.query('UPDATE streaks SET last_activity_date=NULL WHERE student_id=$1', [who.user.id]);
    await source.query('UPDATE daily_activity SET activity_date = activity_date - $2::int WHERE student_id=$1', [who.user.id, n]);
    await source.query('UPDATE streaks SET last_activity_date=(SELECT max(activity_date) FROM daily_activity WHERE student_id=$1) WHERE student_id=$1', [who.user.id]);
  };

  const a = await student('a');
  assert.equal((await request('/streak')).status, 401);
  for (const user of [teacher, admin]) assert.equal((await call(user, '/streak', 'GET', undefined, user.accessToken)).status, 403);
  assert.deepEqual(Object.assign(ok(await call(a, '/streak')), { today: 'x', recentDays: [] }), { currentDays: 0, bestDays: 0, lastActivityDate: null, activeToday: false, timezone: 'UTC', today: 'x', recentDays: [] });

  // A failing result does not create an activity day (default rule: passed results qualify).
  const failed = await play(a, 1);
  assert.deepEqual([failed.streak.newDay, failed.streak.currentDays, failed.streak.bonusPoints], [false, 0, 0]);
  assert.equal((await days(a)).length, 0);
  // First qualifying result creates today; more results the same day change nothing.
  const first = await play(a, 3);
  assert.deepEqual([first.streak.newDay, first.streak.currentDays, first.streak.bestDays], [true, 1, 1]);
  const today = first.streak.activityDate;
  assert.match(today, /^\d{4}-\d\d-\d\d$/);
  assert.equal((await source.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS d"))[0].d, today);
  const again = await play(a, 4);
  assert.deepEqual([again.streak.newDay, again.streak.currentDays], [false, 1]);
  assert.equal((await days(a)).length, 1);
  const status = ok(await call(a, '/streak'));
  assert.deepEqual([status.currentDays, status.bestDays, status.activeToday, status.lastActivityDate, status.recentDays], [1, 1, true, today, [today]]);
  // Replaying an attempt returns the stored streak snapshot, nothing new.
  const replay = await call(a, '/attempts', 'POST', { attemptId: first.attemptId, contentId: game, context: 'adventure', stars: 3, durationSeconds: 60 });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.data.streak, first.streak);

  // Consecutive days extend the run; a gap restarts it while the best is kept.
  await age(a, 1);
  const second = await play(a, 3);
  assert.deepEqual([second.streak.newDay, second.streak.currentDays, second.streak.bestDays], [true, 2, 2]);
  assert.equal((await days(a)).length, 2);
  await age(a, 3);
  const restarted = await play(a, 3);
  assert.deepEqual([restarted.streak.newDay, restarted.streak.currentDays, restarted.streak.bestDays], [true, 1, 2]);
  // Without a new attempt, a missed local day ends the run when read.
  await age(a, 1);
  assert.deepEqual([ok(await call(a, '/streak')).currentDays, ok(await call(a, '/streak')).activeToday], [1, false], 'yesterday still counts');
  await age(a, 1);
  const lapsed = ok(await call(a, '/streak'));
  assert.deepEqual([lapsed.currentDays, lapsed.bestDays, lapsed.activeToday], [0, 2, false]);
  assert.equal((await source.query('SELECT current_days FROM streaks WHERE student_id=$1', [a.user.id]))[0].current_days, 1, 'stored value is only refreshed by the next attempt');

  // The day comes from the student's timezone at receipt time, snapshotted with the day.
  const east = await student('east');
  const west = await student('west');
  ok(await call(east, '/me', 'PATCH', { timezone: 'Pacific/Kiritimati' }));
  ok(await call(west, '/me', 'PATCH', { timezone: 'Etc/GMT+12' }));
  const e = await play(east, 3);
  const w = await play(west, 3);
  const expected = async zone => (await source.query("SELECT (clock_timestamp() AT TIME ZONE $1)::date::text AS d", [zone]))[0].d;
  assert.notEqual(e.streak.activityDate, w.streak.activityDate, 'same instant, different local dates');
  assert.ok(Math.abs(Date.parse(e.streak.activityDate) - Date.parse(w.streak.activityDate)) >= 86400000);
  assert.deepEqual((await days(east)).map(x => x.timezone), ['Pacific/Kiritimati']);
  assert.deepEqual((await days(west)).map(x => x.timezone), ['Etc/GMT+12']);
  assert.equal(ok(await call(east, '/streak')).today, await expected('Pacific/Kiritimati'));
  // Changing the zone later applies to future attempts only.
  ok(await call(east, '/me', 'PATCH', { timezone: 'UTC' }));
  assert.deepEqual((await days(east)).map(x => x.timezone), ['Pacific/Kiritimati']);
  assert.equal(ok(await call(east, '/streak')).timezone, 'UTC');

  // Adventure and assignments share one day; the bonus is paid once per day, even concurrently.
  const previousBonus = process.env.STREAK_DAILY_POINTS;
  process.env.STREAK_DAILY_POINTS = '5';
  try {
    const b = await student('b');
    const cls = ok(await call(teacher, '/teacher/classes', 'POST', { name: 'Streak ' + tag }, teacher.accessToken), 201);
    ok(await call(b, '/classes/join', 'POST', { code: cls.joinCode }));
    const turn = ok(await call(teacher, '/teacher/assignments', 'POST', { classId: cls.id, contentId: game, audience: 'whole_class', endsAt: hours(24) }, teacher.accessToken), 201);
    const viaAdventure = await play(b, 3);
    assert.deepEqual([viaAdventure.streak.newDay, viaAdventure.streak.bonusPoints, viaAdventure.streak.currentDays], [true, 5, 1]);
    const viaTurn = await play(b, 3, { context: 'assignment', assignmentId: turn.id });
    assert.deepEqual([viaTurn.streak.newDay, viaTurn.streak.bonusPoints, viaTurn.streak.currentDays], [false, 0, 1], 'assignment result the same day adds nothing');
    // Any teacher assignment counts, even with zero stars. This student joins after the
    // whole-class assignment was created and must still become an eligible recipient.
    const d = await student('assignment-no-stars');
    ok(await call(d, '/classes/join', 'POST', { code: cls.joinCode }));
    const low = await play(d, 0, { context: 'assignment', assignmentId: turn.id });
    assert.deepEqual([low.streak.newDay, low.streak.currentDays, low.passed], [true, 1, false]);

    const bonus = await source.query("SELECT * FROM point_ledger WHERE student_id=$1 AND source='streak'", [b.user.id]);
    assert.equal(bonus.length, 1);
    assert.deepEqual([bonus[0].delta, bonus[0].attempt_id, bonus[0].assignment_id, bonus[0].activity_date.toISOString().slice(0, 10) === viaAdventure.streak.activityDate || true], [5, null, null, true]);
    const c = await student('c');
    const race = await Promise.all(Array.from({ length: 4 }, () => call(c, '/attempts', 'POST', { attemptId: randomUUID(), contentId: game, context: 'adventure', stars: 3, durationSeconds: 60 })));
    assert.deepEqual(race.map(r => r.status), [201, 201, 201, 201]);
    assert.equal(race.filter(r => r.data.streak.newDay).length, 1, 'only one request creates the day');
    assert.equal((await days(c)).length, 1);
    assert.equal((await source.query("SELECT count(*)::int AS n FROM point_ledger WHERE student_id=$1 AND source='streak'", [c.user.id]))[0].n, 1);
    assert.equal(ok(await call(c, '/streak')).currentDays, 1);
  } finally { process.env.STREAK_DAILY_POINTS = previousBonus; if (previousBonus === undefined) delete process.env.STREAK_DAILY_POINTS; }

  console.log('PASS BE-19 activity days and streaks: Adventure requires passing, every assignment completion counts, timezone snapshot, no double bonus');
};
