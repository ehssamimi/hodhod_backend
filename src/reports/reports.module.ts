import { Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { phase } from '../assignments/assignments.service';
import { CurrentUser, Roles } from '../auth/security';
import { User } from '../users/user.entity';
import { AssignmentReportDto, StudentAssignmentReportDto, StudentReportDto } from './reports.dto';

// Every report row is limited to students who are members of the assignment's class right now,
// and to assignments this teacher created. Moving a student to another class therefore cuts the
// former teacher's future access; nothing is deleted. Statistics read the turn's own rows only.
const rowSql = `SELECT r.student_id AS "studentId", u.display_name AS "displayName",
    CASE WHEN p.first_passed_at IS NOT NULL THEN 'passed' WHEN COALESCE(p.attempt_count,0) > 0 THEN 'in_progress' ELSE 'not_started' END AS status,
    COALESCE(p.attempt_count,0) AS "attemptCount", COALESCE(p.best_stars,0) AS "bestStars",
    COALESCE(rule.pass_stars,3) AS "passStars",
    COALESCE((SELECT sum(l.delta) FROM point_ledger l WHERE l.assignment_id=a.id AND l.student_id=r.student_id),0)::int AS points,
    (SELECT min(g.received_at) FROM game_attempts g WHERE g.assignment_id=a.id AND g.student_id=r.student_id) AS "firstAttemptAt",
    p.last_attempt_at AS "lastAttemptAt", p.first_passed_at AS "firstPassedAt",
    COALESCE((SELECT sum(extract(epoch FROM g.completed_at - g.started_at)) FROM game_attempts g WHERE g.assignment_id=a.id AND g.student_id=r.student_id),0)::int AS "totalDurationSeconds",
    f.rating AS "feedbackRating"
  FROM assignments a
  JOIN assignment_recipients r ON r.assignment_id=a.id
  JOIN users u ON u.id=r.student_id
  JOIN class_memberships m ON m.class_id=a.class_id AND m.student_id=r.student_id AND m.ended_at IS NULL
  LEFT JOIN assignment_progress p ON p.assignment_id=a.id AND p.student_id=r.student_id
  LEFT JOIN game_feedback f ON f.student_id=r.student_id AND f.content_id=a.content_id
  LEFT JOIN LATERAL (
    SELECT pass_stars FROM scoring_rules WHERE content_id=a.content_id OR content_id IS NULL ORDER BY (content_id IS NULL), version DESC LIMIT 1
  ) rule ON true`;

@Injectable()
export class ReportsService {
  constructor(private readonly source: DataSource) {}

  async assignment(teacherId: string, id: string): Promise<AssignmentReportDto> {
    const head = await this.source.query(`SELECT a.id AS "assignmentId", a.class_id AS "classId", cl.name AS "className", a.content_id AS "contentId", c.title AS "contentTitle",
        a.starts_at AS "startsAt", a.ends_at AS "endsAt", ${phase} AS phase
      FROM assignments a JOIN classes cl ON cl.id=a.class_id JOIN content_items c ON c.id=a.content_id WHERE a.id=$1 AND a.teacher_id=$2`, [id, teacherId]);
    if (!head.length) throw new NotFoundException('Assignment not found');
    const students = await this.source.query(`${rowSql} WHERE a.id=$1 ORDER BY u.display_name NULLS LAST, r.student_id`, [id]);
    return { ...head[0], students };
  }

  async studentInAssignment(teacherId: string, id: string, studentId: string): Promise<StudentAssignmentReportDto> {
    const rows = await this.source.query(`${rowSql} WHERE a.id=$1 AND a.teacher_id=$2 AND r.student_id=$3`, [id, teacherId, studentId]);
    if (!rows.length) throw new NotFoundException('Student not found in this assignment');
    const attempts = await this.source.query(`SELECT g.id AS "attemptId", g.stars, g.max_stars AS "maxStars", g.content_version AS "contentVersion", g.received_at AS "receivedAt",
        extract(epoch FROM g.completed_at - g.started_at)::int AS "durationSeconds"
      FROM game_attempts g WHERE g.assignment_id=$1 AND g.student_id=$2 ORDER BY g.received_at, g.id`, [id, studentId]);
    return { assignmentId: id, ...rows[0], attempts };
  }

  async student(teacherId: string, studentId: string): Promise<StudentReportDto> {
    const membership = await this.source.query(`SELECT u.display_name AS "displayName", k.id AS "classId", k.name AS "className"
      FROM class_memberships m JOIN classes k ON k.id=m.class_id AND k.status='active' AND k.teacher_id=$1 JOIN users u ON u.id=m.student_id
      WHERE m.student_id=$2 AND m.ended_at IS NULL`, [teacherId, studentId]);
    if (!membership.length) throw new NotFoundException('Student not found in your classes');
    const turns = await this.source.query(`SELECT a.id AS "assignmentId", a.content_id AS "contentId", c.title AS "contentTitle", a.starts_at AS "startsAt", a.ends_at AS "endsAt",
        ${phase} AS phase,
        CASE WHEN p.first_passed_at IS NOT NULL THEN 'passed' WHEN COALESCE(p.attempt_count,0) > 0 THEN 'in_progress' ELSE 'not_started' END AS status,
        COALESCE(p.attempt_count,0) AS "attemptCount", COALESCE(p.best_stars,0) AS "bestStars",
        COALESCE((SELECT sum(l.delta) FROM point_ledger l WHERE l.assignment_id=a.id AND l.student_id=r.student_id),0)::int AS points,
        p.last_attempt_at AS "lastAttemptAt", f.rating AS "feedbackRating"
      FROM assignments a
      JOIN assignment_recipients r ON r.assignment_id=a.id AND r.student_id=$2
      JOIN content_items c ON c.id=a.content_id
      LEFT JOIN assignment_progress p ON p.assignment_id=a.id AND p.student_id=r.student_id
      LEFT JOIN game_feedback f ON f.student_id=r.student_id AND f.content_id=a.content_id
      WHERE a.teacher_id=$1 AND a.class_id=$3 ORDER BY a.starts_at DESC, a.id`, [teacherId, studentId, membership[0].classId]);
    return { studentId, ...membership[0], turns };
  }
}

@ApiTags('Teacher / Reports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Teacher role required' })
@ApiBadRequestResponse({ description: 'Invalid UUID' })
@Roles('teacher')
@Controller('teacher/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('assignments/:id')
  @ApiOperation({
    summary: 'Report of one assignment turn: every current student with attempts, times, best stars, pass status and game feedback',
    description: 'Only your own assignment. Students who have left the class are omitted. Each turn is reported on its own.',
  })
  @ApiOkResponse({ type: AssignmentReportDto })
  @ApiNotFoundResponse({ description: 'Assignment missing or owned by another teacher' })
  assignment(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.reports.assignment(user.id, id); }

  @Get('assignments/:id/students/:studentId')
  @ApiOperation({ summary: 'Full attempt history of one student in one assignment turn' })
  @ApiOkResponse({ type: StudentAssignmentReportDto })
  @ApiNotFoundResponse({ description: 'Not your assignment, or the student is not a current member of its class' })
  studentInAssignment(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.reports.studentInAssignment(user.id, id, studentId);
  }

  @Get('students/:studentId')
  @ApiOperation({
    summary: 'A student of your class: status of each of your assignment turns',
    description: 'Only for a student currently in one of your active classes, and only your own assignments for that class. After the student moves to another class you no longer see their data.',
  })
  @ApiOkResponse({ type: StudentReportDto })
  @ApiNotFoundResponse({ description: 'The student is not currently in one of your classes' })
  student(@CurrentUser() user: User, @Param('studentId', ParseUUIDPipe) studentId: string) { return this.reports.student(user.id, studentId); }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class TeacherReportsModule {}
