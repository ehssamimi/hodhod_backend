import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { Roles } from '../auth/security';

export class ListSuspiciousDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  studentId?: string;
  @ApiPropertyOptional({ example: 'stage_locked' }) @IsOptional() @IsString() @Length(1, 40)
  reason?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
  @ApiPropertyOptional({ minimum: 0, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class SuspiciousEventDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) studentId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Set only when the attempt was accepted and stored (implausible_duration)' }) attemptId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) contentId!: string | null;
  @ApiProperty({ type: String, nullable: true }) context!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) assignmentId!: string | null;
  @ApiProperty({
    example: 'stage_locked',
    description: 'stars_above_max, not_on_adventure_map, stage_locked, assignment_not_addressed, content_mismatch, assignment_cancelled, assignment_not_started, window_closed, content_unavailable, attempt_id_other_student, attempt_id_data_mismatch, rate_limited, implausible_duration',
  }) reason!: string;
  @ApiProperty({ type: Object }) details!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

@Injectable()
export class SuspiciousService {
  constructor(private readonly source: DataSource) {}

  list(query: ListSuspiciousDto): Promise<SuspiciousEventDto[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.studentId) { params.push(query.studentId); where.push(`student_id=$${params.length}`); }
    if (query.reason) { params.push(query.reason); where.push(`reason=$${params.length}`); }
    params.push(query.limit ?? 50, query.offset ?? 0);
    return this.source.query(`SELECT id, student_id AS "studentId", attempt_id AS "attemptId", content_id AS "contentId", context, assignment_id AS "assignmentId",
        reason, details, created_at AS "createdAt" FROM suspicious_events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC, id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  }
}

@ApiTags('Admin / Attempt review')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Admin role required' })
@ApiBadRequestResponse({ description: 'Invalid filter or unexpected property' })
@Roles('admin')
@Controller('admin/suspicious-events')
export class AdminSuspiciousController {
  constructor(private readonly events: SuspiciousService) {}

  @Get()
  @ApiOperation({
    summary: 'List rejected or implausible attempt submissions, newest first',
    description: 'Traces only; the server cannot prove that a star result really came from playing the game in Unity. Rejections do not store an attempt; implausible_duration events belong to an accepted attempt.',
  })
  @ApiOkResponse({ type: [SuspiciousEventDto] })
  list(@Query() query: ListSuspiciousDto) { return this.events.list(query); }
}

@Module({ controllers: [AdminSuspiciousController], providers: [SuspiciousService] })
export class AdminSuspiciousModule {}
