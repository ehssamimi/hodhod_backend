import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class SubmitFeedbackDto {
  @ApiProperty({ format: 'uuid', description: 'Stable content ID of a game you have played' }) @IsUUID()
  contentId!: string;
  @ApiProperty({ example: 4, minimum: 1, maximum: 4, description: 'Interest rating, 1 to 4. Unrelated to stars and points.' }) @IsInt() @Min(1) @Max(4)
  rating!: number;
}

export class FeedbackDto {
  @ApiProperty({ format: 'uuid' }) contentId!: string;
  @ApiProperty({ type: Number, nullable: true, example: 4, description: 'null when you have not rated this game' }) rating!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: Date | null;
}

export class ListFeedbackDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID()
  contentId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
  @ApiPropertyOptional({ minimum: 0, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class TeacherFeedbackQueryDto extends ListFeedbackDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only students currently in this class of yours' }) @IsOptional() @IsUUID()
  classId?: string;
}

export class FeedbackItemDto {
  @ApiProperty({ format: 'uuid' }) contentId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'uuid' }) studentId!: string;
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null;
  @ApiProperty({ example: 4 }) rating!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class FeedbackSummaryDto {
  @ApiProperty({ example: 12 }) count!: number;
  @ApiProperty({ type: Number, nullable: true, example: 3.25 }) average!: number | null;
  @ApiProperty({ example: { 1: 0, 2: 1, 3: 4, 4: 7 }, description: 'Number of ratings per value 1 to 4' }) distribution!: Record<string, number>;
}

export class FeedbackListDto {
  @ApiProperty({ type: FeedbackSummaryDto, description: 'Over all matching ratings, not just this page' }) summary!: FeedbackSummaryDto;
  @ApiProperty({ type: [FeedbackItemDto], description: 'Newest first. Never contains email addresses.' }) items!: FeedbackItemDto[];
}
