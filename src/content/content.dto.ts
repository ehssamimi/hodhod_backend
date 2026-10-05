import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class ListContentDto {
  @ApiPropertyOptional({ example: 'ضرب', maxLength: 120, description: 'Exact subject match' })
  @IsOptional() @Transform(trim) @IsString() @Length(1, 120)
  subject?: string;

  @ApiPropertyOptional({ example: 'جمع', maxLength: 100, description: 'Case-insensitive title search' })
  @IsOptional() @Transform(trim) @IsString() @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class ListStudentContentDto extends ListContentDto {
  @ApiPropertyOptional({ enum: ['adventure', 'practice'], description: 'Items of kind "both" match either value' })
  @IsOptional() @IsIn(['adventure', 'practice'])
  kind?: 'adventure' | 'practice';
}

export class ContentDto {
  @ApiProperty({ format: 'uuid', description: 'Stable backend content ID; progress and reports always refer to this' })
  id!: string;
  @ApiProperty({ example: 'ضرب اعداد دو رقمی' }) title!: string;
  @ApiProperty({ example: 'ضرب' }) subject!: string;
  @ApiProperty({ example: 3 }) grade!: number;
  @ApiProperty({ enum: ['adventure', 'practice', 'both'] }) kind!: string;
  @ApiProperty({ example: 'math3.multiply.two-digit', description: 'Unity identifier of the current published version; may change between versions' })
  unityId!: string;
  @ApiProperty({ example: 1, description: 'Current published version number' }) version!: number;
  @ApiProperty({ format: 'date-time' }) publishedAt!: Date;
  @ApiProperty({ example: 5, description: 'Stars available under the effective scoring rule (content rule, else global, else default)' }) maxStars!: number;
  @ApiProperty({ example: 3, description: 'Best stars needed to pass under the effective scoring rule' }) passStars!: number;
}
