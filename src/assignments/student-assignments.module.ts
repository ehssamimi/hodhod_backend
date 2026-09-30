import { Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser, Roles } from '../auth/security';
import { User } from '../users/user.entity';
import { phase } from './assignments.service';
import { ListMyAssignmentsDto, MyAssignmentDto } from './student-assignments.dto';

// Only the student's own recipient rows, in the class they are currently in. Cancelled
// turns are hidden. Progress, points and status are read by this turn's ID alone.
const select = `SELECT a.id AS "assignmentId", a.class_id AS "classId", cl.name AS "className", a.content_id AS "contentId", c.title, c.subject,
    CASE WHEN c.status='published' AND c.kind IN ('practice','both') THEN v.unity_id END AS "unityId",
    CASE WHEN c.status='published' AND c.kind IN ('practice','both') THEN v.version END AS version,
    (c.status='published' AND c.kind IN ('practice','both') AND v.version IS NOT NULL) AS available,
    a.starts_at AS "startsAt", a.ends_at AS "endsAt", ${phase} AS phase,
    CASE WHEN p.first_passed_at IS NOT NULL THEN 'passed' WHEN COALESCE(p.attempt_count,0) > 0 THEN 'in_progress' ELSE 'not_started' END AS status,
    COALESCE(p.best_stars,0) AS "bestStars", COALESCE(p.attempt_count,0) AS "attemptCount",
    COALESCE(rule.max_stars,5) AS "maxStars", COALESCE(rule.pass_stars,3) AS "passStars",
    COALESCE((SELECT sum(l.delta) FROM point_ledger l WHERE l.assignment_id=a.id AND l.student_id=r.student_id),0)::int AS points,
    p.first_passed_at AS "firstPassedAt", p.last_attempt_at AS "lastAttemptAt"
  FROM assignment_recipients r
  JOIN assignments a ON a.id=r.assignment_id AND a.status <> 'cancelled'
  JOIN classes cl ON cl.id=a.class_id
  JOIN content_items c ON c.id=a.content_id
  JOIN class_memberships m ON m.class_id=a.class_id AND m.student_id=r.student_id AND m.ended_at IS NULL
  LEFT JOIN LATERAL (
    SELECT version, unity_id FROM content_versions
    WHERE content_id=a.content_id AND published_at IS NOT NULL AND published_at<=clock_timestamp() ORDER BY version DESC LIMIT 1
  ) v ON true
  LEFT JOIN assignment_progress p ON p.assignment_id=a.id AND p.student_id=r.student_id
  LEFT JOIN LATERAL (
    SELECT max_stars, pass_stars FROM scoring_rules WHERE content_id=a.content_id OR content_id IS NULL
    ORDER BY (content_id IS NULL), version DESC LIMIT 1
  ) rule ON true
  WHERE r.student_id=$1`;

@Injectable()
export class StudentAssignmentsService {
  constructor(private readonly source: DataSource) {}

  list(studentId: string, query: ListMyAssignmentsDto): Promise<MyAssignmentDto[]> {
    const params: unknown[] = [studentId];
    let sql = select;
    if (query.phase) { params.push(query.phase); sql += ` AND ${phase}=$${params.length}`; }
    params.push(query.limit ?? 50, query.offset ?? 0);
    // Open work first (soonest deadline), then upcoming, then finished (latest first).
    return this.source.query(`${sql} ORDER BY CASE ${phase} WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END,
      CASE WHEN ${phase}='ended' THEN NULL ELSE a.ends_at END ASC NULLS LAST, a.ends_at DESC, a.id
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  }

  async get(studentId: string, id: string): Promise<MyAssignmentDto> {
    const rows = await this.source.query(select + ' AND a.id=$2', [studentId, id]);
    if (!rows.length) throw new NotFoundException('Assignment not found');
    return rows[0];
  }
}

@ApiTags('Student / Assignments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Student role required' })
@ApiBadRequestResponse({ description: 'Invalid filter, UUID or unexpected property' })
@Roles('student')
@Controller('assignments/mine')
export class StudentAssignmentsController {
  constructor(private readonly assignments: StudentAssignmentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List your teacher assignments with window, phase and your status in each turn',
    description: 'Only assignments addressed to you in your current class. Each assignment ID is an independent turn: Adventure results and other turns of the same game never count. Cancelled assignments are hidden. Order: active, upcoming, ended.',
  })
  @ApiOkResponse({ type: [MyAssignmentDto] })
  list(@CurrentUser() user: User, @Query() query: ListMyAssignmentsDto) { return this.assignments.list(user.id, query); }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of your assignment turns' })
  @ApiOkResponse({ type: MyAssignmentDto })
  @ApiNotFoundResponse({ description: 'Not addressed to you, cancelled, or not in your current class' })
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.assignments.get(user.id, id); }
}

@Module({ controllers: [StudentAssignmentsController], providers: [StudentAssignmentsService] })
export class StudentAssignmentsModule {}
