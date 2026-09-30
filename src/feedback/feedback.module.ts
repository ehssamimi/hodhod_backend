import { Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser, Roles } from '../auth/security';
import { User } from '../users/user.entity';
import { FeedbackDto, FeedbackListDto, ListFeedbackDto, SubmitFeedbackDto, TeacherFeedbackQueryDto } from './feedback.dto';

const item = `SELECT f.content_id AS "contentId", c.title, f.student_id AS "studentId", u.display_name AS "displayName", f.rating, f.created_at AS "createdAt"
  FROM game_feedback f JOIN content_items c ON c.id=f.content_id JOIN users u ON u.id=f.student_id`;

@Injectable()
export class FeedbackService {
  constructor(private readonly source: DataSource) {}

  // The rating is one row per (student, game), shared by every context, and is never edited.
  // It lives in its own table and is never read by scoring, progress or ranking code.
  submit(actor: User, contentId: string, rating: number): Promise<{ created: boolean; feedback: FeedbackDto }> {
    return this.source.transaction(async manager => {
      const user = await manager.getRepository(User).findOne({ where: { id: actor.id }, lock: { mode: 'pessimistic_read' } });
      if (!user || user.authVersion !== actor.authVersion) throw new UnauthorizedException('Session revoked');
      if (user.role !== 'student') throw new ForbiddenException('Student role required');
      const played = await manager.query('SELECT 1 FROM game_attempts WHERE student_id=$1 AND content_id=$2 LIMIT 1', [actor.id, contentId]);
      if (!played.length) throw new NotFoundException('Play this game before rating it');
      const inserted = await manager.query(`INSERT INTO game_feedback(student_id,content_id,rating) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING
        RETURNING content_id AS "contentId", rating, created_at AS "createdAt"`, [actor.id, contentId, rating]);
      if (inserted.length) return { created: true, feedback: inserted[0] };
      const current = (await manager.query('SELECT content_id AS "contentId", rating, created_at AS "createdAt" FROM game_feedback WHERE student_id=$1 AND content_id=$2', [actor.id, contentId]))[0];
      if (current.rating !== rating) throw new ConflictException('You already rated this game; the rating cannot be changed');
      return { created: false, feedback: current };
    });
  }

  async mine(studentId: string, contentId: string): Promise<FeedbackDto> {
    const rows = await this.source.query('SELECT content_id AS "contentId", rating, created_at AS "createdAt" FROM game_feedback WHERE student_id=$1 AND content_id=$2', [studentId, contentId]);
    return rows[0] ?? { contentId, rating: null, createdAt: null };
  }

  private async list(from: string, where: string[], params: unknown[], query: ListFeedbackDto): Promise<FeedbackListDto> {
    if (query.contentId) { params.push(query.contentId); where.push(`f.content_id=$${params.length}`); }
    const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const stats = (await this.source.query(`SELECT count(*)::int AS count, avg(f.rating)::float AS average,
        count(*) FILTER (WHERE f.rating=1)::int AS r1, count(*) FILTER (WHERE f.rating=2)::int AS r2,
        count(*) FILTER (WHERE f.rating=3)::int AS r3, count(*) FILTER (WHERE f.rating=4)::int AS r4 ${from} ${clause}`, params))[0];
    const page = [...params, query.limit ?? 50, query.offset ?? 0];
    const items = await this.source.query(`${item} ${from.replace(/^FROM game_feedback f/, '')} ${clause} ORDER BY f.created_at DESC, f.student_id LIMIT $${page.length - 1} OFFSET $${page.length}`, page);
    return { summary: { count: stats.count, average: stats.average, distribution: { 1: stats.r1, 2: stats.r2, 3: stats.r3, 4: stats.r4 } }, items };
  }

  forAdmin(query: ListFeedbackDto) { return this.list('FROM game_feedback f', [], [], query); }

  // A teacher sees ratings only from students who are in one of their active classes right now.
  forTeacher(teacherId: string, query: TeacherFeedbackQueryDto) {
    const params: unknown[] = [teacherId];
    const where = ['f.student_id IN (SELECT m.student_id FROM class_memberships m JOIN classes k ON k.id=m.class_id WHERE m.ended_at IS NULL AND k.status=\'active\' AND k.teacher_id=$1' ];
    if (query.classId) { params.push(query.classId); where[0] += ` AND k.id=$${params.length}`; }
    where[0] += ')';
    return this.list('FROM game_feedback f', where, params, query);
  }
}

@ApiTags('Student / Feedback')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Student role required' })
@Roles('student')
@Controller('feedback')
export class StudentFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Rate a game you played, 1 to 4, once', description: 'One rating per game for the whole account (Adventure and assignments share it). It cannot be changed afterwards; resending the same rating returns 200. It never affects stars, points or ranking.' })
  @ApiCreatedResponse({ type: FeedbackDto })
  @ApiOkResponse({ type: FeedbackDto, description: 'Same rating already recorded' })
  @ApiBadRequestResponse({ description: 'Rating outside 1 to 4, invalid UUID or unexpected property' })
  @ApiNotFoundResponse({ description: 'You have not played this game' })
  @ApiConflictResponse({ description: 'A different rating already exists' })
  async submit(@CurrentUser() user: User, @Body() input: SubmitFeedbackDto, @Res({ passthrough: true }) response: { status(code: number): unknown }) {
    const result = await this.feedback.submit(user, input.contentId, input.rating);
    if (!result.created) response.status(200);
    return result.feedback;
  }

  @Get(':contentId')
  @ApiOperation({ summary: 'Get your rating for a game (rating is null when you have not rated it)' })
  @ApiOkResponse({ type: FeedbackDto })
  @ApiBadRequestResponse({ description: 'Invalid UUID' })
  mine(@CurrentUser() user: User, @Param('contentId', ParseUUIDPipe) contentId: string) { return this.feedback.mine(user.id, contentId); }
}

@ApiTags('Teacher / Feedback')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Teacher role required' })
@ApiBadRequestResponse({ description: 'Invalid filter, UUID or unexpected property' })
@Roles('teacher')
@Controller('teacher/feedback')
export class TeacherFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  @ApiOperation({ summary: 'Game ratings from students currently in your active classes', description: 'Summary covers all matches; items are newest first. Students who left your class are not shown.' })
  @ApiOkResponse({ type: FeedbackListDto })
  list(@CurrentUser() user: User, @Query() query: TeacherFeedbackQueryDto) { return this.feedback.forTeacher(user.id, query); }
}

@ApiTags('Admin / Feedback')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Admin role required' })
@ApiBadRequestResponse({ description: 'Invalid filter, UUID or unexpected property' })
@Roles('admin')
@Controller('admin/feedback')
export class AdminFeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  @ApiOperation({ summary: 'All game ratings with an aggregate summary; filter by contentId' })
  @ApiOkResponse({ type: FeedbackListDto })
  list(@Query() query: ListFeedbackDto) { return this.feedback.forAdmin(query); }
}

@Module({ controllers: [StudentFeedbackController], providers: [FeedbackService] })
export class StudentFeedbackModule {}
@Module({ controllers: [TeacherFeedbackController], providers: [FeedbackService] })
export class TeacherFeedbackModule {}
@Module({ controllers: [AdminFeedbackController], providers: [FeedbackService] })
export class AdminFeedbackModule {}
