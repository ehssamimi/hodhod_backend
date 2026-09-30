import { Controller, Get, Injectable, Module, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser, Roles } from '../auth/security';
import { User } from '../users/user.entity';

export class LeaderboardEntryDto {
  @ApiProperty({ example: 1, description: 'Equal points share a rank (1, 2, 2, 4, ...)' }) rank!: number;
  @ApiProperty({ type: String, nullable: true, example: 'سارا' }) displayName!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'avatar_3' }) avatarId!: string | null;
  @ApiProperty({ example: 120, description: 'Total points from the whole ledger (stars, streak, adjustments), independent of class changes' }) points!: number;
  @ApiProperty({ description: 'This entry is you' }) isMe!: boolean;
}

export class LeaderboardDto {
  @ApiProperty({ enum: ['global', 'class'] }) scope!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Your current class name for the class board' }) className!: string | null;
  @ApiProperty({ type: [LeaderboardEntryDto], description: 'Best five, in order. Contains you when you are among them.' }) top!: LeaderboardEntryDto[];
  @ApiProperty({ type: LeaderboardEntryDto, nullable: true, description: 'Your own position when you are not in top; null when you are already listed there' }) me!: LeaderboardEntryDto | null;
  @ApiProperty({ example: 42, description: 'Students ranked on this board' }) participants!: number;
}

interface Row { studentId: string; displayName: string | null; avatarId: string | null; points: number; rank: number; ord: number }

// Ranks come from the total of the whole point ledger per student. Ties share a rank (RANK); the
// order inside a tie is who reached the total first, then ID, so the top five is deterministic.
// Entries expose only display name, avatar and points: no email and no other students' IDs.
const ranked = (members: string) => `WITH totals AS (
    SELECT l.student_id, sum(l.delta)::int AS points, max(l.created_at) AS last_at FROM point_ledger l GROUP BY l.student_id
  ), board AS (
    SELECT u.id AS student_id, u.display_name, u.avatar_id, COALESCE(t.points,0) AS points, t.last_at
    FROM users u LEFT JOIN totals t ON t.student_id=u.id WHERE u.role='student' ${members}
  )
  SELECT b.student_id AS "studentId", b.display_name AS "displayName", b.avatar_id AS "avatarId", b.points,
    rank() OVER (ORDER BY b.points DESC)::int AS rank,
    row_number() OVER (ORDER BY b.points DESC, b.last_at ASC NULLS LAST, b.student_id)::int AS ord
  FROM board b`;

@Injectable()
export class LeaderboardsService {
  constructor(private readonly source: DataSource) {}

  private async build(scope: string, className: string | null, sql: string, params: unknown[], viewer: User): Promise<LeaderboardDto> {
    const all: Row[] = await this.source.query(`SELECT * FROM (${sql}) r WHERE r.ord <= 5 OR r."studentId"=$1 ORDER BY r.ord`, params);
    const participants: number = (await this.source.query(`SELECT count(*)::int AS n FROM (${sql}) r`))[0].n;
    const entry = (row: Row) => ({ rank: row.rank, displayName: row.displayName, avatarId: row.avatarId, points: row.points, isMe: row.studentId === viewer.id });
    const top = all.filter(row => row.ord <= 5).map(entry);
    const mine = all.find(row => row.studentId === viewer.id && row.ord > 5);
    return { scope, className, top, me: mine ? entry(mine) : null, participants };
  }

  global(viewer: User) {
    return this.build('global', null, ranked(''), [viewer.id], viewer);
  }

  async byClass(viewer: User) {
    const cls = (await this.source.query(`SELECT k.id, k.name FROM class_memberships m JOIN classes k ON k.id=m.class_id AND k.status='active'
      WHERE m.student_id=$1 AND m.ended_at IS NULL`, [viewer.id]))[0];
    if (!cls) throw new NotFoundException('You are not in a class');
    const members = `AND u.id IN (SELECT m.student_id FROM class_memberships m WHERE m.class_id='${cls.id}' AND m.ended_at IS NULL)`;
    return this.build('class', cls.name, ranked(members), [viewer.id], viewer);
  }
}

@ApiTags('Student / Leaderboards')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Student role required' })
@Roles('student')
@Controller('leaderboards')
export class LeaderboardsController {
  constructor(private readonly boards: LeaderboardsService) {}

  @Get('global')
  @ApiOperation({ summary: 'Top five students overall plus your own position', description: 'You appear once: inside top when you are in the first five, otherwise in me.' })
  @ApiOkResponse({ type: LeaderboardDto })
  global(@CurrentUser() user: User) { return this.boards.global(user); }

  @Get('class')
  @ApiOperation({ summary: 'Top five students of your current class plus your own position', description: 'Ranks the students who are in your class now, by their total personal points. Points you earned before joining or in a previous class count.' })
  @ApiOkResponse({ type: LeaderboardDto })
  @ApiNotFoundResponse({ description: 'You are not in a class' })
  byClass(@CurrentUser() user: User) { return this.boards.byClass(user); }
}

@Module({ controllers: [LeaderboardsController], providers: [LeaderboardsService] })
export class StudentLeaderboardsModule {}
