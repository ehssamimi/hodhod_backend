import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const phases = ['upcoming', 'active', 'ended'] as const;

export class ListMyAssignmentsDto {
  @ApiPropertyOptional({ enum: phases }) @IsOptional() @IsIn(phases)
  phase?: (typeof phases)[number];
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
  @ApiPropertyOptional({ minimum: 0, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class MyAssignmentDto {
  @ApiProperty({ format: 'uuid', description: 'Identifies this turn; the same game assigned again has a different ID' }) assignmentId!: string;
  @ApiProperty({ format: 'uuid' }) classId!: string;
  @ApiProperty() className!: string;
  @ApiProperty({ format: 'uuid', description: 'Stable content ID' }) contentId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() subject!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Unity ID of the current released version; null when the content is no longer published' }) unityId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) version!: number | null;
  @ApiProperty({ description: 'The content is still published. An active turn is playable only when this is true.' }) available!: boolean;
  @ApiProperty({ format: 'date-time' }) startsAt!: Date;
  @ApiProperty({ format: 'date-time' }) endsAt!: Date;
  @ApiProperty({ enum: phases, description: 'From the server clock: upcoming (not started), active (open now), ended (window over)' }) phase!: string;
  @ApiProperty({ enum: ['not_started', 'in_progress', 'passed'], description: 'Your status in this turn only' }) status!: string;
  @ApiProperty({ example: 0 }) bestStars!: number;
  @ApiProperty({ example: 0 }) attemptCount!: number;
  @ApiProperty({ example: 5 }) maxStars!: number;
  @ApiProperty({ example: 3 }) passStars!: number;
  @ApiProperty({ example: 0, description: 'Points you earned in this turn only' }) points!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) firstPassedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastAttemptAt!: Date | null;
}
