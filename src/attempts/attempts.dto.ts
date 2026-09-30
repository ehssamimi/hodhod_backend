import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class SubmitAttemptDto {
  @ApiProperty({ format: 'uuid', example: '5f0c2f4e-6b3a-4a52-9b1e-0d5f6b7a8c90', description: 'Client-generated unique ID of this attempt; resending the same ID never creates a second attempt' })
  @IsUUID()
  attemptId!: string;
  @ApiProperty({ format: 'uuid', description: 'Stable content ID' }) @IsUUID()
  contentId!: string;
  @ApiProperty({ enum: ['adventure', 'assignment'] }) @IsIn(['adventure', 'assignment'])
  context!: 'adventure' | 'assignment';
  @ApiPropertyOptional({ format: 'uuid', description: 'Required for the assignment context (the turn being played); not allowed for adventure' }) @IsOptional() @IsUUID()
  assignmentId?: string;
  @ApiProperty({ example: 4, minimum: 0, description: 'Stars earned; must not exceed the rule ceiling' }) @IsInt() @Min(0) @Max(10)
  stars!: number;
  @ApiProperty({ example: 95, minimum: 0, maximum: 21600, description: 'Play time in seconds. The server stamps receipt time itself and derives the start from this duration.' }) @IsInt() @Min(0) @Max(21600)
  durationSeconds!: number;
}

export class AttemptProgressDto {
  @ApiProperty({ example: 4 }) bestStars!: number;
  @ApiProperty({ example: 2 }) attemptCount!: number;
  @ApiProperty({ description: 'This context has been passed at least once' }) passed!: boolean;
  @ApiProperty({ description: 'This attempt raised the best stars of the context' }) improved!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) firstPassedAt!: Date | null;
}

export class AttemptStreakDto {
  @ApiProperty({ example: '2026-10-02', description: 'Calendar date in your timezone at the time the server received the attempt' }) activityDate!: string;
  @ApiProperty({ description: 'This attempt created the activity day (a day counts once; only a qualifying result creates it)' }) newDay!: boolean;
  @ApiProperty({ example: 3, description: 'Consecutive activity days ending today or yesterday; 0 when the run is over' }) currentDays!: number;
  @ApiProperty({ example: 7 }) bestDays!: number;
  @ApiProperty({ example: 0, description: 'Points for the new day from STREAK_DAILY_POINTS; 0 when none is configured or the day already counted' }) bonusPoints!: number;
}

export class AttemptResultDto {
  @ApiProperty({ format: 'uuid' }) attemptId!: string;
  @ApiProperty({ description: 'true when this is a replay of an already recorded attempt; the rest of the body is identical to the first response' }) duplicate!: boolean;
  @ApiProperty({ enum: ['adventure', 'assignment'] }) context!: string;
  @ApiProperty({ format: 'uuid' }) contentId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) assignmentId!: string | null;
  @ApiProperty({ example: 1, description: 'Content version that was played' }) contentVersion!: number;
  @ApiProperty({ format: 'uuid', description: 'Scoring rule version that applied' }) scoringRuleId!: string;
  @ApiProperty({ example: 4 }) stars!: number;
  @ApiProperty({ example: 5 }) maxStars!: number;
  @ApiProperty({ example: 3 }) passStars!: number;
  @ApiProperty({ description: 'stars reached passStars in this attempt' }) passed!: boolean;
  @ApiProperty({ format: 'date-time', description: 'Server receipt time' }) receivedAt!: Date;
  @ApiProperty({ type: AttemptProgressDto }) progress!: AttemptProgressDto;
  @ApiProperty({ example: 10, description: 'Points this attempt added (only the improvement over the previous best in the same context)' }) pointsAwarded!: number;
  @ApiProperty({ type: AttemptStreakDto, description: 'Activity day and streak after this attempt. Absent on results stored before streaks existed.' }) streak!: AttemptStreakDto;
}
