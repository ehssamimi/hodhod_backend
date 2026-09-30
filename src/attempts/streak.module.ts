import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser, Roles } from '../auth/security';
import { User } from '../users/user.entity';
import { effectiveDays } from './streak';

export class StreakDto {
  @ApiProperty({ example: 3, description: 'Consecutive activity days ending today or yesterday; 0 once a whole local day was missed' }) currentDays!: number;
  @ApiProperty({ example: 7 }) bestDays!: number;
  @ApiProperty({ type: String, nullable: true, example: '2026-10-02', description: 'Most recent activity day' }) lastActivityDate!: string | null;
  @ApiProperty({ description: 'An activity day already exists for today in your timezone' }) activeToday!: boolean;
  @ApiProperty({ example: 'Asia/Tehran', description: 'Timezone currently used to decide the day of new attempts' }) timezone!: string;
  @ApiProperty({ example: '2026-10-02', description: 'Today in your timezone, from the server clock' }) today!: string;
  @ApiProperty({ type: [String], example: ['2026-10-02', '2026-10-01'], description: 'Your last 30 activity days, newest first' }) recentDays!: string[];
}

@Injectable()
export class StreakService {
  constructor(private readonly source: DataSource) {}

  async get(user: User): Promise<StreakDto> {
    const today: string = (await this.source.query('SELECT (clock_timestamp() AT TIME ZONE $1)::date::text AS d', [user.timezone]))[0].d;
    const row = (await this.source.query('SELECT current_days, best_days, last_activity_date::text AS last FROM streaks WHERE student_id=$1', [user.id]))[0];
    const days: Array<{ d: string }> = await this.source.query('SELECT activity_date::text AS d FROM daily_activity WHERE student_id=$1 ORDER BY activity_date DESC LIMIT 30', [user.id]);
    const currentDays = row ? await effectiveDays(this.source.manager, row.current_days, row.last, today) : 0;
    return { currentDays, bestDays: row?.best_days ?? 0, lastActivityDate: row?.last ?? null, activeToday: days[0]?.d === today, timezone: user.timezone, today, recentDays: days.map(day => day.d) };
  }
}

@ApiTags('Student / Streak')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Student role required' })
@Roles('student')
@Controller('streak')
export class StreakController {
  constructor(private readonly streak: StreakService) {}

  @Get()
  @ApiOperation({
    summary: 'Your activity days and streak',
    description: 'A day counts once, in your timezone, when the server receives a qualifying result from Adventure or from a teacher assignment. Which results qualify is a configuration (passed results by default).',
  })
  @ApiOkResponse({ type: StreakDto })
  get(@CurrentUser() user: User) { return this.streak.get(user); }
}

@Module({ controllers: [StreakController], providers: [StreakService] })
export class StudentStreakModule {}
