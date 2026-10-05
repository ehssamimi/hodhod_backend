import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateClassDto {
  @ApiProperty({ example: 'پایه سوم الف', minLength: 1, maxLength: 120 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 120)
  @Matches(/^[^\x00-\x1f\x7f]+$/u)
  name!: string;
}

export class ClassDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) teacherId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['active', 'archived'] }) status!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Active join code; null for archived classes' }) joinCode!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt!: Date | null;
}
