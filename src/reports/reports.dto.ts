import { ApiProperty } from '@nestjs/swagger';

const statuses = ['not_started', 'in_progress', 'passed'];

export class ReportRowDto {
  @ApiProperty({ format: 'uuid' }) studentId!: string;
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null;
  @ApiProperty({ enum: statuses, description: 'Status in this turn only' }) status!: string;
  @ApiProperty({ example: 3 }) attemptCount!: number;
  @ApiProperty({ example: 4 }) bestStars!: number;
  @ApiProperty({ example: 4 }) passStars!: number;
  @ApiProperty({ example: 30 }) points!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) firstAttemptAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastAttemptAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) firstPassedAt!: Date | null;
  @ApiProperty({ example: 240, description: 'Total play time over all attempts in this turn, seconds' }) totalDurationSeconds!: number;
  @ApiProperty({ type: Number, nullable: true, example: 3, description: 'The student\'s 1-4 interest rating for this game, if given. Independent of stars.' }) feedbackRating!: number | null;
}

export class AssignmentReportDto {
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ format: 'uuid' }) classId!: string;
  @ApiProperty() className!: string;
  @ApiProperty({ format: 'uuid' }) contentId!: string;
  @ApiProperty() contentTitle!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: Date;
  @ApiProperty({ format: 'date-time' }) endsAt!: Date;
  @ApiProperty({ enum: ['upcoming', 'active', 'ended', 'cancelled'] }) phase!: string;
  @ApiProperty({ type: [ReportRowDto], description: 'Recipients who are still active members of the class; students who left are omitted' }) students!: ReportRowDto[];
}

export class AttemptRowDto {
  @ApiProperty({ format: 'uuid' }) attemptId!: string;
  @ApiProperty({ example: 4 }) stars!: number;
  @ApiProperty({ example: 5 }) maxStars!: number;
  @ApiProperty({ example: 1 }) contentVersion!: number;
  @ApiProperty({ format: 'date-time', description: 'Server receipt time' }) receivedAt!: Date;
  @ApiProperty({ example: 95, description: 'Play time in seconds' }) durationSeconds!: number;
}

export class StudentAssignmentReportDto extends ReportRowDto {
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ type: [AttemptRowDto], description: 'Every attempt in this turn, oldest first' }) attempts!: AttemptRowDto[];
}

export class StudentTurnDto {
  @ApiProperty({ format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ format: 'uuid' }) contentId!: string;
  @ApiProperty() contentTitle!: string;
  @ApiProperty({ format: 'date-time' }) startsAt!: Date;
  @ApiProperty({ format: 'date-time' }) endsAt!: Date;
  @ApiProperty({ enum: ['upcoming', 'active', 'ended', 'cancelled'] }) phase!: string;
  @ApiProperty({ enum: statuses }) status!: string;
  @ApiProperty() attemptCount!: number;
  @ApiProperty() bestStars!: number;
  @ApiProperty() points!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastAttemptAt!: Date | null;
  @ApiProperty({ type: Number, nullable: true }) feedbackRating!: number | null;
}

export class StudentReportDto {
  @ApiProperty({ format: 'uuid' }) studentId!: string;
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null;
  @ApiProperty({ format: 'uuid' }) classId!: string;
  @ApiProperty() className!: string;
  @ApiProperty({ type: [StudentTurnDto], description: 'Only your own assignments in the class the student is in now, newest window first' }) turns!: StudentTurnDto[];
}
