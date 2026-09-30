import { EntityManager } from 'typeorm';

export interface StreakOutcome {
  activityDate: string;
  newDay: boolean;
  currentDays: number;
  bestDays: number;
  bonusPoints: number;
}

// STREAK_QUALIFY=passed (default) counts only results that reach the pass line;
// STREAK_QUALIFY=any counts every finished attempt. Product decision 4 is still open.
export function qualifies(stars: number, passStars: number): boolean {
  return process.env.STREAK_QUALIFY === 'any' ? true : stars >= passStars;
}

// Points for a newly earned activity day; unset means no streak reward (values are not decided).
function dailyBonus(): number {
  const raw = process.env.STREAK_DAILY_POINTS;
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 100000) throw new Error('Invalid STREAK_DAILY_POINTS');
  return value;
}

// The activity day is the calendar date in the student's timezone at the moment the server
// received the attempt (never a device clock). The zone in force is stored with the day, so a
// later timezone change does not rewrite history. Runs inside the attempt transaction, under
// the per-student lock, so one day can be created and rewarded at most once.
export async function recordActivity(manager: EntityManager, studentId: string, timezone: string, attemptId: string, ruleId: string, counts: boolean): Promise<StreakOutcome> {
  const today: string = (await manager.query('SELECT (clock_timestamp() AT TIME ZONE $1)::date::text AS d', [timezone]))[0].d;
  await manager.query('INSERT INTO streaks(student_id) VALUES ($1) ON CONFLICT DO NOTHING', [studentId]);
  const row = (await manager.query('SELECT current_days, best_days, last_activity_date::text AS last FROM streaks WHERE student_id=$1 FOR UPDATE', [studentId]))[0];
  let current: number = row.current_days;
  let best: number = row.best_days;
  if (!counts) return { activityDate: today, newDay: false, currentDays: await effectiveDays(manager, current, row.last, today), bestDays: best, bonusPoints: 0 };

  const created = await manager.query('INSERT INTO daily_activity(student_id,activity_date,timezone,qualifying_attempt_id) VALUES ($1,$2::date,$3,$4) ON CONFLICT DO NOTHING RETURNING 1',
    [studentId, today, timezone, attemptId]);
  if (!created.length) return { activityDate: today, newDay: false, currentDays: await effectiveDays(manager, current, row.last, today), bestDays: best, bonusPoints: 0 };

  // A day earlier than the last recorded one (zone moved west) is stored but cannot extend the run.
  if (!row.last || today > row.last) {
    const gap: number | null = row.last ? (await manager.query('SELECT ($1::date - $2::date) AS n', [today, row.last]))[0].n : null;
    current = gap === 1 ? current + 1 : 1;
    best = Math.max(best, current);
    await manager.query('UPDATE streaks SET current_days=$2, best_days=$3, last_activity_date=$4::date WHERE student_id=$1', [studentId, current, best, today]);
  } else {
    current = await effectiveDays(manager, current, row.last, today);
  }

  const bonus = dailyBonus();
  if (bonus > 0) {
    await manager.query(`INSERT INTO point_ledger(student_id,delta,reason,source,scoring_rule_id,activity_date,idempotency_key)
      VALUES ($1,$2,'Daily activity',$3,$4,$5::date,$6)`, [studentId, bonus, 'streak', ruleId, today, 'streak:' + today]);
  }
  return { activityDate: today, newDay: true, currentDays: current, bestDays: best, bonusPoints: bonus };
}

// A run that missed a whole local day is over even if nothing was written yet.
export async function effectiveDays(manager: EntityManager, current: number, last: string | null, today: string): Promise<number> {
  if (!last || current === 0) return 0;
  const gap: number = (await manager.query('SELECT ($1::date - $2::date) AS n', [today, last]))[0].n;
  return gap <= 1 ? current : 0;
}
