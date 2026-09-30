import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

// Offsets are required so a teacher's local clock is never silently guessed.
const isoWithOffset = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,6})?)?(Z|[+-]\d\d:\d\d)$/;
const phases = ['upcoming', 'active', 'ended', 'cancelled'] as const;

export class CreateAssignmentDto {
  @ApiProperty({ format: 'uuid', description: 'One of your active classes' }) @IsUUID()
  classId!: string;
  @ApiProperty({ format: 'uuid', description: 'Published practice content (kind practice or both)' }) @IsUUID()
  contentId!: string;
  @ApiProperty({ enum: ['whole_class', 'selected'], description: 'whole_class fixes the recipients to the current members; selected uses studentIds' }) @IsIn(['whole_class', 'selected'])
  audience!: 'whole_class' | 'selected';
  @ApiPropertyOptional({ type: [String], format: 'uuid', description: 'Required for selected, forbidden for whole_class. Must all be current members of the class.' })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ArrayUnique() @IsUUID('all', { each: true })
  studentIds?: string[];
  @ApiPropertyOptional({ example: '2026-10-01T08:00:00+03:30', description: 'ISO 8601 with UTC offset; defaults to the server time now' })
  @IsOptional() @Matches(isoWithOffset)
  startsAt?: string;
  @ApiProperty({ example: '2026-10-08T20:00:00+03:30', description: 'ISO 8601 with UTC offset; must be in the future, after startsAt, and at most 366 days after it' })
  @Matches(isoWithOffset)
  endsAt!: string;
}

export class ListAssignmentsDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  classId?: string;
  @ApiPropertyOptional({ enum: phases }) @IsOptional() @IsIn(phases)
  phase?: (typeof phases)[number];
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
  @ApiPropertyOptional({ minimum: 0, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class AssignmentDto {
  @ApiProperty({ format: 'uuid', description: 'Every allocation gets a new ID, even for the same content and class' }) id!: string;
  @ApiProperty({ format: 'uuid' }) classId!: string;
  @ApiProperty() className!: string;
  @ApiProperty({ format: 'uuid' }) contentId!: string;
  @ApiProperty() contentTitle!: string;
  @ApiProperty({ enum: ['whole_class', 'selected'] }) audience!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: Date;
  @ApiProperty({ format: 'date-time' }) endsAt!: Date;
  @ApiProperty({ enum: ['scheduled', 'cancelled', 'archived'] }) status!: string;
  @ApiProperty({ enum: phases, description: 'Computed from the server clock: upcoming, active, ended, or cancelled' }) phase!: string;
  @ApiProperty({ example: 25 }) recipientCount!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class RecipientDto {
  @ApiProperty({ format: 'uuid' }) studentId!: string;
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null;
}

export class AssignmentDetailDto extends AssignmentDto {
  @ApiProperty({ type: [RecipientDto], description: 'Explicit recipients fixed at creation who are still active members of the class; recipientCount is the original audience size' }) recipients!: RecipientDto[];
}

export class TurnProgressDto {
  @ApiProperty({ format: 'uuid' }) studentId!: string;
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null;
  @ApiProperty({ enum: ['not_started', 'in_progress', 'passed'], description: 'Status of this assignment turn only' }) status!: string;
  @ApiProperty({ example: 0, description: 'Best stars within this turn only' }) bestStars!: number;
  @ApiProperty({ example: 0, description: 'Attempts made in this turn only' }) attemptCount!: number;
  @ApiProperty({ example: 0, description: 'Points earned from this turn only (sum of its ledger entries)' }) points!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) firstPassedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastAttemptAt!: Date | null;
}

export class AssignmentProgressDto {
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ enum: ['upcoming', 'active', 'ended', 'cancelled'] }) phase!: string;
  @ApiProperty({ type: [TurnProgressDto], description: 'Recipients who are still active members of the class' }) students!: TurnProgressDto[];
}
