import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { Roles } from '../auth/security';

export class GameSummaryDto {
  @ApiProperty({ format: 'uuid' }) contentId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['draft', 'published', 'archived'] }) status!: string;
  @ApiProperty({ enum: ['adventure', 'practice', 'both'] }) kind!: string;
  @ApiProperty({ type: Number, nullable: true, description: 'Highest released version' }) currentVersion!: number | null;
  @ApiProperty({ example: 40 }) attempts!: number;
  @ApiProperty({ example: 12 }) feedbackCount!: number;
  @ApiProperty({ type: Number, nullable: true, example: 3.25, description: '1-4 interest average; null when nobody rated the game' }) feedbackAverage!: number | null;
  @ApiProperty({ example: { 1: 0, 2: 1, 3: 4, 4: 7 } }) feedbackDistribution!: Record<string, number>;
}

export class OverviewDto {
  @ApiProperty({ example: { student: 120, teacher: 6, admin: 2 } }) usersByRole!: Record<string, number>;
  @ApiProperty({ example: { active: 8, archived: 1 } }) classesByStatus!: Record<string, number>;
  @ApiProperty({ example: { draft: 2, published: 30, archived: 1 } }) contentByStatus!: Record<string, number>;
  @ApiProperty({ example: { upcoming: 1, active: 3, ended: 10, cancelled: 0 } }) assignmentsByPhase!: Record<string, number>;
  @ApiProperty({ example: 500 }) attemptsTotal!: number;
  @ApiProperty({ example: 60, description: 'Attempts received in the last 7 days' }) attemptsLast7Days!: number;
  @ApiProperty({ example: 4, description: 'Suspicious events in the last 7 days (see /admin/suspicious-events)' }) suspiciousLast7Days!: number;
  @ApiProperty({ type: [GameSummaryDto], description: 'Every game with publication status and aggregated feedback, most attempted first (no student identities)' }) games!: GameSummaryDto[];
}

export class ListAuditDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  actorId?: string;
  @ApiPropertyOptional({ example: 'content' }) @IsOptional() @IsString() @Length(1, 30)
  entityType?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  entityId?: string;
  @ApiPropertyOptional({ example: 'content.publish' }) @IsOptional() @IsString() @Length(1, 40)
  action?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
  @ApiPropertyOptional({ minimum: 0, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class AuditEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) actorId!: string;
  @ApiProperty({ type: String, nullable: true }) actorName!: string | null;
  @ApiProperty({ example: 'content.publish', description: 'content.create, content.update, content.version.add, content.version.update, content.publish, content.unpublish, content.archive, adventure.path.replace, rule.create' }) action!: string;
  @ApiProperty({ example: 'content' }) entityType!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) entityId!: string | null;
  @ApiProperty({ type: Object }) details!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time', description: 'Server time' }) createdAt!: Date;
}

const counts = (rows: Array<{ k: string; n: number }>, keys: string[]) => Object.fromEntries(keys.map(k => [k, rows.find(r => r.k === k)?.n ?? 0]));

@Injectable()
export class AdminOverviewService {
  constructor(private readonly source: DataSource) {}

  async overview(): Promise<OverviewDto> {
    const q = (sql: string) => this.source.query(sql);
    const [users, classes, content, phases, attempts, suspicious, games] = await Promise.all([
      q('SELECT role AS k, count(*)::int AS n FROM users GROUP BY role'),
      q('SELECT status AS k, count(*)::int AS n FROM classes GROUP BY status'),
      q('SELECT status AS k, count(*)::int AS n FROM content_items GROUP BY status'),
      q(`SELECT CASE WHEN status='cancelled' THEN 'cancelled' WHEN status='archived' THEN 'ended' WHEN clock_timestamp() < starts_at THEN 'upcoming'
          WHEN clock_timestamp() < ends_at THEN 'active' ELSE 'ended' END AS k, count(*)::int AS n FROM assignments GROUP BY 1`),
      q("SELECT count(*)::int AS total, count(*) FILTER (WHERE received_at > now() - interval '7 days')::int AS recent FROM game_attempts"),
      q("SELECT count(*)::int AS n FROM suspicious_events WHERE created_at > now() - interval '7 days'"),
      q(`SELECT c.id AS "contentId", c.title, c.status, c.kind,
          (SELECT max(version) FROM content_versions v WHERE v.content_id=c.id AND v.published_at IS NOT NULL) AS "currentVersion",
          (SELECT count(*)::int FROM game_attempts g WHERE g.content_id=c.id) AS attempts,
          count(f.rating)::int AS "feedbackCount", avg(f.rating)::float AS "feedbackAverage",
          count(*) FILTER (WHERE f.rating=1)::int AS r1, count(*) FILTER (WHERE f.rating=2)::int AS r2,
          count(*) FILTER (WHERE f.rating=3)::int AS r3, count(*) FILTER (WHERE f.rating=4)::int AS r4
        FROM content_items c LEFT JOIN game_feedback f ON f.content_id=c.id GROUP BY c.id ORDER BY attempts DESC, c.title, c.id`),
    ]);
    return {
      usersByRole: counts(users, ['student', 'teacher', 'admin']),
      classesByStatus: counts(classes, ['active', 'archived']),
      contentByStatus: counts(content, ['draft', 'published', 'archived']),
      assignmentsByPhase: counts(phases, ['upcoming', 'active', 'ended', 'cancelled']),
      attemptsTotal: attempts[0].total, attemptsLast7Days: attempts[0].recent, suspiciousLast7Days: suspicious[0].n,
      games: games.map((g: Record<string, unknown>) => ({
        contentId: g.contentId, title: g.title, status: g.status, kind: g.kind, currentVersion: g.currentVersion, attempts: g.attempts,
        feedbackCount: g.feedbackCount, feedbackAverage: g.feedbackAverage, feedbackDistribution: { 1: g.r1, 2: g.r2, 3: g.r3, 4: g.r4 },
      })) as GameSummaryDto[],
    };
  }

  audit(query: ListAuditDto): Promise<AuditEntryDto[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    for (const [column, value] of [['a.actor_id', query.actorId], ['a.entity_type', query.entityType], ['a.entity_id', query.entityId], ['a.action', query.action]] as const) {
      if (value) { params.push(value); where.push(`${column}=$${params.length}`); }
    }
    params.push(query.limit ?? 50, query.offset ?? 0);
    return this.source.query(`SELECT a.id, a.actor_id AS "actorId", u.display_name AS "actorName", a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.details, a.created_at AS "createdAt"
      FROM admin_audit a JOIN users u ON u.id=a.actor_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.created_at DESC, a.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  }
}

@ApiTags('Admin / Overview')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Admin role required' })
@Roles('admin')
@Controller('admin')
export class AdminOverviewController {
  constructor(private readonly overview: AdminOverviewService) {}

  @Get('overview')
  @ApiOperation({ summary: 'System overview: users, classes, publication status, assignments, attempts and aggregated game feedback' })
  @ApiOkResponse({ type: OverviewDto })
  get() { return this.overview.overview(); }

  @Get('audit')
  @ApiOperation({ summary: 'History of sensitive content, Adventure path and scoring-rule changes with the acting admin and server time', description: 'Newest first, append-only. Role changes are recorded separately in role_change_audit.' })
  @ApiOkResponse({ type: [AuditEntryDto] })
  @ApiBadRequestResponse({ description: 'Invalid filter or unexpected property' })
  audit(@Query() query: ListAuditDto) { return this.overview.audit(query); }
}

@Module({ controllers: [AdminOverviewController], providers: [AdminOverviewService] })
export class AdminOverviewModule {}
