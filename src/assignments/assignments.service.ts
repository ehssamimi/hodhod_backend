import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/user.entity';
import { AssignmentDetailDto, AssignmentDto, AssignmentProgressDto, CreateAssignmentDto, ExtendAssignmentDto, ListAssignmentsDto } from './assignments.dto';

const MAX_WINDOW_MS = 366 * 24 * 3600 * 1000;

export const phase = `CASE WHEN a.status='cancelled' THEN 'cancelled' WHEN a.status='archived' THEN 'ended'
  WHEN clock_timestamp() < a.starts_at THEN 'upcoming' WHEN clock_timestamp() < a.ends_at THEN 'active' ELSE 'ended' END`;
const projection = `SELECT a.id, a.class_id AS "classId", cl.name AS "className", a.content_id AS "contentId", c.title AS "contentTitle",
    a.audience, a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.status, ${phase} AS phase,
    (SELECT count(*) FROM assignment_recipients r WHERE r.assignment_id=a.id)::int AS "recipientCount", a.created_at AS "createdAt"
  FROM assignments a JOIN classes cl ON cl.id=a.class_id JOIN content_items c ON c.id=a.content_id`;

@Injectable()
export class AssignmentsService {
  constructor(private readonly source: DataSource) {}

  private authorized<T>(actor: User, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction(async manager => {
      const user = await manager.getRepository(User).findOne({ where: { id: actor.id }, lock: { mode: 'pessimistic_read' } });
      if (!user || user.authVersion !== actor.authVersion) throw new UnauthorizedException('Session revoked');
      if (user.role !== 'teacher') throw new ForbiddenException('Teacher role required');
      return work(manager);
    });
  }

  private async detail(manager: EntityManager | DataSource, teacherId: string, id: string): Promise<AssignmentDetailDto> {
    const rows = await manager.query(projection + ' WHERE a.id=$1 AND a.teacher_id=$2', [id, teacherId]);
    if (!rows.length) throw new NotFoundException('Assignment not found');
    const recipients = await manager.query(`SELECT r.student_id AS "studentId", u.display_name AS "displayName"
      FROM assignment_recipients r JOIN users u ON u.id=r.student_id
      JOIN class_memberships m ON m.class_id=$2 AND m.student_id=r.student_id AND m.ended_at IS NULL
      WHERE r.assignment_id=$1 ORDER BY u.display_name NULLS LAST, r.student_id`, [id, rows[0].classId]);
    return { ...rows[0], recipients };
  }

  create(actor: User, input: CreateAssignmentDto): Promise<AssignmentDetailDto> {
    const ends = Date.parse(input.endsAt);
    const starts = input.startsAt === undefined ? undefined : Date.parse(input.startsAt);
    if (Number.isNaN(ends) || (starts !== undefined && Number.isNaN(starts))) throw new BadRequestException('Invalid date');
    if (input.audience === 'selected' && !input.studentIds) throw new BadRequestException('studentIds is required for a selected audience');
    if (input.audience === 'whole_class' && input.studentIds) throw new BadRequestException('studentIds is not allowed for a whole_class audience');
    return this.authorized(actor, async manager => {
      // The database clock decides "now", never the teacher's device or the app host.
      const clock = (await manager.query('SELECT clock_timestamp() AS now'))[0].now.getTime();
      const startsAt = new Date(starts ?? clock);
      const endsAt = new Date(ends);
      if (endsAt.getTime() <= startsAt.getTime()) throw new BadRequestException('endsAt must be after startsAt');
      if (endsAt.getTime() <= clock) throw new BadRequestException('endsAt must be in the future');
      if (endsAt.getTime() - startsAt.getTime() > MAX_WINDOW_MS) throw new BadRequestException('The window can be at most 366 days');

      // Share-lock the class so it cannot be archived mid-way; ownership hides other teachers' classes.
      const classes = await manager.query('SELECT status FROM classes WHERE id=$1 AND teacher_id=$2 FOR SHARE', [input.classId, actor.id]);
      if (!classes.length) throw new NotFoundException('Class not found');
      if (classes[0].status !== 'active') throw new ConflictException('Class is archived');

      // Share-lock content so it cannot be unpublished between the check and the insert.
      const content = await manager.query(`SELECT c.id FROM content_items c WHERE c.id=$1 AND c.status='published' AND c.kind IN ('practice','both')
        AND EXISTS (SELECT 1 FROM content_versions v WHERE v.content_id=c.id AND v.published_at IS NOT NULL AND v.published_at<=now()) FOR SHARE OF c`, [input.contentId]);
      if (!content.length) throw new NotFoundException('Published practice content not found');

      // Locking the membership rows makes the recipient list match the class at commit time.
      const members: Array<{ student_id: string }> = await manager.query(
        'SELECT student_id FROM class_memberships WHERE class_id=$1 AND ended_at IS NULL ORDER BY student_id FOR SHARE', [input.classId]);
      const active = new Set(members.map(member => member.student_id));
      let recipients: string[];
      if (input.audience === 'selected') {
        recipients = input.studentIds!.map(id => id.toLowerCase());
        if (recipients.some(id => !active.has(id))) throw new BadRequestException('Every selected student must be a current member of the class');
      } else {
        recipients = [...active];
        if (!recipients.length) throw new ConflictException('The class has no students to assign to');
      }

      const created = await manager.query(`INSERT INTO assignments(teacher_id,class_id,content_id,audience,starts_at,ends_at)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [actor.id, input.classId, input.contentId, input.audience, startsAt, endsAt]);
      await manager.query('INSERT INTO assignment_recipients(assignment_id,student_id) SELECT $1, unnest($2::uuid[])', [created[0].id, recipients]);
      return this.detail(manager, actor.id, created[0].id);
    });
  }

  list(actor: User, query: ListAssignmentsDto): Promise<AssignmentDto[]> {
    return this.authorized(actor, manager => {
      const params: unknown[] = [actor.id];
      let sql = projection + ' WHERE a.teacher_id=$1';
      if (query.classId) { params.push(query.classId); sql += ` AND a.class_id=$${params.length}`; }
      if (query.phase) { params.push(query.phase); sql += ` AND ${phase}=$${params.length}`; }
      params.push(query.limit ?? 50, query.offset ?? 0);
      return manager.query(`${sql} ORDER BY a.starts_at DESC, a.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    });
  }

  get(actor: User, id: string): Promise<AssignmentDetailDto> {
    return this.authorized(actor, manager => this.detail(manager, actor.id, id));
  }

  // One turn = one assignment ID. Only rows keyed by this ID are read, so results from
  // Adventure or from an earlier assignment of the same content can never appear here.
  // Students who left the class are no longer visible to the teacher.
  progress(actor: User, id: string): Promise<AssignmentProgressDto> {
    return this.authorized(actor, async manager => {
      const found = await manager.query(`SELECT a.class_id, ${phase} AS phase FROM assignments a WHERE a.id=$1 AND a.teacher_id=$2`, [id, actor.id]);
      if (!found.length) throw new NotFoundException('Assignment not found');
      const students = await manager.query(`SELECT r.student_id AS "studentId", u.display_name AS "displayName",
          CASE WHEN p.first_passed_at IS NOT NULL THEN 'passed' WHEN COALESCE(p.attempt_count,0) > 0 THEN 'in_progress' ELSE 'not_started' END AS status,
          COALESCE(p.best_stars,0) AS "bestStars", COALESCE(p.attempt_count,0) AS "attemptCount",
          COALESCE((SELECT sum(l.delta) FROM point_ledger l WHERE l.assignment_id=r.assignment_id AND l.student_id=r.student_id),0)::int AS points,
          p.first_passed_at AS "firstPassedAt", p.last_attempt_at AS "lastAttemptAt"
        FROM assignment_recipients r
        JOIN users u ON u.id=r.student_id
        JOIN class_memberships m ON m.class_id=$2 AND m.student_id=r.student_id AND m.ended_at IS NULL
        LEFT JOIN assignment_progress p ON p.assignment_id=r.assignment_id AND p.student_id=r.student_id
        WHERE r.assignment_id=$1 ORDER BY u.display_name NULLS LAST, r.student_id`, [id, found[0].class_id]);
      return { assignmentId: id, phase: found[0].phase, students };
    });
  }

  extend(actor: User, id: string, input: ExtendAssignmentDto): Promise<AssignmentDetailDto> {
    const parsed = Date.parse(input.endsAt);
    if (Number.isNaN(parsed)) throw new BadRequestException('Invalid date');
    const endsAt = new Date(parsed);
    return this.authorized(actor, async manager => {
      const rows = await manager.query(`SELECT status, class_id, audience, starts_at, ends_at,
          clock_timestamp() AS now
        FROM assignments WHERE id=$1 AND teacher_id=$2 FOR UPDATE`, [id, actor.id]);
      if (!rows.length) throw new NotFoundException('Assignment not found');
      const assignment = rows[0];
      if (assignment.status !== 'scheduled') throw new ConflictException('Cancelled or archived assignments cannot be extended');
      if (endsAt.getTime() <= assignment.ends_at.getTime()) throw new ConflictException('The new deadline must be later than the current deadline');
      if (endsAt.getTime() <= assignment.now.getTime()) throw new BadRequestException('endsAt must be in the future');
      if (endsAt.getTime() - assignment.starts_at.getTime() > MAX_WINDOW_MS) throw new BadRequestException('The window can be at most 366 days');
      await manager.query('UPDATE assignments SET ends_at=$2 WHERE id=$1', [id, endsAt]);
      if (assignment.audience === 'whole_class') {
        await manager.query(`INSERT INTO assignment_recipients(assignment_id,student_id)
          SELECT $1,m.student_id FROM class_memberships m
          WHERE m.class_id=$2 AND m.ended_at IS NULL
          ON CONFLICT DO NOTHING`, [id, assignment.class_id]);
      }
      return this.detail(manager, actor.id, id);
    });
  }

  // Cancelling keeps every record; it only stops the allocation from being open.
  cancel(actor: User, id: string): Promise<AssignmentDetailDto> {
    return this.authorized(actor, async manager => {
      const rows = await manager.query('SELECT status, ends_at FROM assignments WHERE id=$1 AND teacher_id=$2 FOR UPDATE', [id, actor.id]);
      if (!rows.length) throw new NotFoundException('Assignment not found');
      if (rows[0].status === 'scheduled') {
        if ((await manager.query('SELECT $1::timestamptz <= clock_timestamp() AS over', [rows[0].ends_at]))[0].over) {
          throw new ConflictException('The assignment window has already ended');
        }
        await manager.query("UPDATE assignments SET status='cancelled' WHERE id=$1", [id]);
      }
      return this.detail(manager, actor.id, id);
    });
  }
}
