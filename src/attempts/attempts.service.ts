import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { mapSql } from '../adventure/adventure.service';
import { effectiveRule, EffectiveRule, pointsForStars } from '../scoring/scoring';
import { User } from '../users/user.entity';
import { AttemptResultDto, SubmitAttemptDto } from './attempts.dto';

interface Target { contentVersion: number }

// A rejection that should leave a trace. The transaction rolls back, so the event is written afterwards.
function suspicious<T extends HttpException>(reason: string, error: T): T {
  return Object.assign(error, { suspicionReason: reason });
}

function setting(name: string, fallback: number, maximum: number): number {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) throw new Error('Invalid ' + name);
  return n;
}

@Injectable()
export class AttemptsService {
  constructor(private readonly source: DataSource) {}

  // One transaction per attempt: attempt row, progress, ledger and the stored replay
  // snapshot commit together. A per-student lock serializes concurrent submissions, so
  // two requests can never both see the same "previous best" and double-award points.
  async submit(actor: User, input: SubmitAttemptDto): Promise<AttemptResultDto> {
    if (input.context === 'assignment' && !input.assignmentId) throw new BadRequestException('assignmentId is required for the assignment context');
    if (input.context === 'adventure' && input.assignmentId) throw new BadRequestException('assignmentId is not allowed for the adventure context');
    try {
      await this.rateLimit(actor.id);
      return await this.handle(actor, input);
    } catch (error) {
      const reason = (error as { suspicionReason?: string }).suspicionReason;
      if (reason) await this.record(actor.id, reason, input, null, { message: (error as Error).message });
      throw error;
    }
  }

  // Fixed one-minute window per account, shared by every instance through the database and
  // committed on its own, so rejected submissions still use up the budget.
  private async rateLimit(studentId: string): Promise<void> {
    const maximum = setting('ATTEMPTS_PER_MINUTE', 30, 600);
    const rows: Array<{ hits: number }> = await this.source.query(`
      INSERT INTO auth_rate_limits(bucket) VALUES ($1)
      ON CONFLICT (bucket) DO UPDATE SET
        hits = CASE WHEN auth_rate_limits.window_start <= now() - interval '60 seconds' THEN 1 ELSE auth_rate_limits.hits + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start <= now() - interval '60 seconds' THEN now() ELSE auth_rate_limits.window_start END
      RETURNING hits`, ['attempt:' + studentId]);
    if (rows[0].hits > maximum) {
      throw suspicious('rate_limited', new HttpException('Too many attempt submissions; try again in a minute', HttpStatus.TOO_MANY_REQUESTS));
    }
  }

  private record(studentId: string, reason: string, input: SubmitAttemptDto, attemptId: string | null, details: Record<string, unknown>, manager?: EntityManager) {
    return (manager ?? this.source).query(`INSERT INTO suspicious_events(student_id,attempt_id,content_id,context,assignment_id,reason,details) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [studentId, attemptId, input.contentId, input.context, input.assignmentId ?? null, reason, JSON.stringify(details)]);
  }

  private handle(actor: User, input: SubmitAttemptDto): Promise<AttemptResultDto> {
    if (input.context === 'assignment' && !input.assignmentId) throw new BadRequestException('assignmentId is required for the assignment context');
    if (input.context === 'adventure' && input.assignmentId) throw new BadRequestException('assignmentId is not allowed for the adventure context');
    return this.source.transaction(async manager => {
      const user = await manager.getRepository(User).findOne({ where: { id: actor.id }, lock: { mode: 'pessimistic_read' } });
      if (!user || user.authVersion !== actor.authVersion) throw new UnauthorizedException('Session revoked');
      if (user.role !== 'student') throw new ForbiddenException('Student role required');
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1790553611))', [actor.id]);

      const existing = await manager.query('SELECT student_id, content_id, context, assignment_id, stars, result FROM game_attempts WHERE id=$1', [input.attemptId]);
      if (existing.length) return this.replay(actor, input, existing[0]);

      const target = input.context === 'adventure'
        ? await this.adventureTarget(manager, actor.id, input.contentId)
        : await this.assignmentTarget(manager, actor.id, input.assignmentId!, input.contentId);
      const rule = await effectiveRule(manager, input.contentId);
      if (input.stars > rule.maxStars) throw suspicious('stars_above_max', new BadRequestException('stars cannot exceed ' + rule.maxStars));

      // Receipt time is the database clock; the start is derived from the reported duration.
      const attempt = (await manager.query(`INSERT INTO game_attempts(id,student_id,content_id,content_version,context,assignment_id,scoring_rule_id,stars,max_stars,started_at,completed_at,received_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, clock_timestamp() - make_interval(secs => $10), clock_timestamp(), clock_timestamp()) RETURNING received_at AS "receivedAt"`,
        [input.attemptId, actor.id, input.contentId, target.contentVersion, input.context, input.assignmentId ?? null, rule.id, input.stars, rule.maxStars, input.durationSeconds]))[0];

      const progress = await this.updateProgress(manager, actor.id, input, rule, attempt.receivedAt);
      const pointsAwarded = await this.awardPoints(manager, actor.id, input, rule, progress);
      // Accepted but implausible: a passing result reported faster than any real play. Kept for review.
      const minimum = setting('ATTEMPT_MIN_PLAUSIBLE_SECONDS', 3, 600);
      if (input.stars >= rule.passStars && input.durationSeconds < minimum) {
        await this.record(actor.id, 'implausible_duration', input, input.attemptId, { durationSeconds: input.durationSeconds, minimum }, manager);
      }

      const result: AttemptResultDto = {
        attemptId: input.attemptId, duplicate: false, context: input.context, contentId: input.contentId, assignmentId: input.assignmentId ?? null,
        contentVersion: target.contentVersion, scoringRuleId: rule.id, stars: input.stars, maxStars: rule.maxStars, passStars: rule.passStars,
        passed: input.stars >= rule.passStars, receivedAt: attempt.receivedAt,
        progress: { bestStars: progress.bestStars, attemptCount: progress.attemptCount, passed: progress.firstPassedAt !== null, improved: progress.improved, firstPassedAt: progress.firstPassedAt },
        pointsAwarded,
      };
      await manager.query('UPDATE game_attempts SET result=$2 WHERE id=$1', [input.attemptId, JSON.stringify(result)]);
      return result;
    });
  }

  private replay(actor: User, input: SubmitAttemptDto, row: Record<string, unknown>): AttemptResultDto {
    // Never reveal or reuse another student's attempt ID.
    if (row.student_id !== actor.id) throw suspicious('attempt_id_other_student', new ConflictException('Attempt ID is already used'));
    if (row.content_id !== input.contentId.toLowerCase() || row.context !== input.context || (row.assignment_id ?? null) !== (input.assignmentId?.toLowerCase() ?? null) || row.stars !== input.stars) {
      throw suspicious('attempt_id_data_mismatch', new ConflictException('Attempt ID was already used with different data'));
    }
    return { ...(row.result as AttemptResultDto), duplicate: true };
  }

  private async adventureTarget(manager: EntityManager, studentId: string, contentId: string): Promise<Target> {
    const stages: Array<{ contentId: string; status: string; version: number }> = await manager.query(mapSql, [studentId]);
    const stage = stages.find(s => s.contentId === contentId);
    if (!stage) throw suspicious('not_on_adventure_map', new NotFoundException('Content is not on the Adventure map'));
    if (stage.status !== 'unlocked') throw suspicious('stage_locked', new ForbiddenException('Stage is locked'));
    return { contentVersion: stage.version };
  }

  // The turn must be addressed to this student, in their current class, scheduled and inside its window.
  private async assignmentTarget(manager: EntityManager, studentId: string, assignmentId: string, contentId: string): Promise<Target> {
    const rows = await manager.query(`SELECT a.content_id, a.status, a.starts_at <= clock_timestamp() AS started, a.ends_at > clock_timestamp() AS open
      FROM assignments a
      JOIN assignment_recipients r ON r.assignment_id=a.id AND r.student_id=$2
      JOIN class_memberships m ON m.class_id=a.class_id AND m.student_id=$2 AND m.ended_at IS NULL
      WHERE a.id=$1 FOR SHARE OF a`, [assignmentId, studentId]);
    if (!rows.length) throw suspicious('assignment_not_addressed', new NotFoundException('Assignment not found'));
    const a = rows[0];
    if (a.content_id !== contentId) throw suspicious('content_mismatch', new BadRequestException('contentId does not match the assignment'));
    if (a.status !== 'scheduled') throw suspicious('assignment_cancelled', new ConflictException('Assignment is not open'));
    if (!a.started) throw suspicious('assignment_not_started', new ConflictException('Assignment has not started'));
    if (!a.open) throw suspicious('window_closed', new ConflictException('Assignment window has closed'));
    const version = await manager.query(`SELECT v.version FROM content_items c JOIN LATERAL (
        SELECT version FROM content_versions WHERE content_id=c.id AND published_at IS NOT NULL AND published_at<=clock_timestamp() ORDER BY version DESC LIMIT 1
      ) v ON true WHERE c.id=$1 AND c.status='published' AND c.kind IN ('practice','both')`, [contentId]);
    if (!version.length) throw suspicious('content_unavailable', new ConflictException('Content is not available'));
    return { contentVersion: version[0].version };
  }

  private async updateProgress(manager: EntityManager, studentId: string, input: SubmitAttemptDto, rule: EffectiveRule, receivedAt: Date) {
    const adventure = input.context === 'adventure';
    const table = adventure ? 'adventure_progress' : 'assignment_progress';
    const key = adventure ? 'student_id=$1 AND content_id=$2' : 'student_id=$1 AND assignment_id=$2';
    const keyValues = [studentId, adventure ? input.contentId : input.assignmentId];
    await manager.query(adventure ? 'INSERT INTO adventure_progress(student_id,content_id) VALUES ($1,$2) ON CONFLICT DO NOTHING'
      : 'INSERT INTO assignment_progress(student_id,assignment_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', keyValues);
    const current = (await manager.query(`SELECT best_stars, attempt_count, first_passed_at FROM ${table} WHERE ${key} FOR UPDATE`, keyValues))[0];
    const improved = input.stars > current.best_stars;
    const bestStars = Math.max(current.best_stars, input.stars);
    const firstPassedAt: Date | null = current.first_passed_at ?? (input.stars >= rule.passStars ? receivedAt : null);
    await manager.query(`UPDATE ${table} SET best_stars=$3, attempt_count=attempt_count+1, first_passed_at=$4, last_attempt_at=$5 WHERE ${key}`,
      [...keyValues, bestStars, firstPassedAt, receivedAt]);
    return { bestStars, attemptCount: current.attempt_count + 1, improved, firstPassedAt };
  }

  // Ledger entries are append-only. An improvement earns only the difference between what this
  // context already paid and what the current rule pays for the new best; a worse or equal result
  // and a lower-valued newer rule earn nothing and never subtract.
  private async awardPoints(manager: EntityManager, studentId: string, input: SubmitAttemptDto, rule: EffectiveRule, progress: { bestStars: number; improved: boolean }): Promise<number> {
    if (!progress.improved) return 0;
    const adventure = input.context === 'adventure';
    const paid = (await manager.query(adventure
      ? `SELECT COALESCE(sum(l.delta),0)::int AS n FROM point_ledger l JOIN game_attempts g ON g.id=l.attempt_id WHERE l.student_id=$1 AND l.source='adventure' AND g.content_id=$2`
      : 'SELECT COALESCE(sum(delta),0)::int AS n FROM point_ledger WHERE student_id=$1 AND assignment_id=$2',
      [studentId, adventure ? input.contentId : input.assignmentId]))[0].n as number;
    const delta = pointsForStars(rule, progress.bestStars) - paid;
    if (delta <= 0) return 0;
    await manager.query(`INSERT INTO point_ledger(student_id,delta,reason,source,assignment_id,attempt_id,scoring_rule_id,idempotency_key)
      VALUES ($1,$2,'Star improvement',$3,$4,$5,$6,$7)`,
      [studentId, delta, input.context, input.assignmentId ?? null, input.attemptId, rule.id, 'attempt:' + input.attemptId]);
    return delta;
  }
}
