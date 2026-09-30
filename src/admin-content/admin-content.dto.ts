import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const noControl = /^[^\x00-\x1f\x7f]+$/u;
const unityPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const kinds = ['adventure', 'practice', 'both'] as const;

export class CreateContentDto {
  @ApiProperty({ example: 'ضرب اعداد دو رقمی', maxLength: 200 }) @Transform(trim) @IsString() @Length(1, 200) @Matches(noControl)
  title!: string;
  @ApiProperty({ example: 'ضرب', maxLength: 120 }) @Transform(trim) @IsString() @Length(1, 120) @Matches(noControl)
  subject!: string;
  @ApiPropertyOptional({ default: 3, minimum: 1, maximum: 12 }) @IsOptional() @IsInt() @Min(1) @Max(12)
  grade?: number;
  @ApiProperty({ enum: kinds }) @IsIn(kinds)
  kind!: (typeof kinds)[number];
  @ApiProperty({ example: 'math3.multiply.two-digit', maxLength: 200, description: 'Unity identifier for the first version; unique across content items' })
  @Transform(trim) @IsString() @Length(1, 200) @Matches(unityPattern)
  unityId!: string;
  @ApiPropertyOptional({ type: Object, example: { scene: 'Multiply2' }, description: 'JSON object, at most 16 KB' }) @IsOptional() @IsObject()
  configuration?: Record<string, unknown>;
}

export class UpdateContentDto {
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @Transform(trim) @IsString() @Length(1, 200) @Matches(noControl)
  title?: string;
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @Transform(trim) @IsString() @Length(1, 120) @Matches(noControl)
  subject?: string;
  @ApiPropertyOptional({ enum: kinds, description: 'Rejected while an Adventure stage or assignment needs the current kind' }) @IsOptional() @IsIn(kinds)
  kind?: (typeof kinds)[number];
}

export class CreateVersionDto {
  @ApiProperty({ example: 'math3.multiply.two-digit.v2', maxLength: 200 }) @Transform(trim) @IsString() @Length(1, 200) @Matches(unityPattern)
  unityId!: string;
  @ApiPropertyOptional({ type: Object, description: 'JSON object, at most 16 KB' }) @IsOptional() @IsObject()
  configuration?: Record<string, unknown>;
}

export class UpdateVersionDto {
  @ApiPropertyOptional({ maxLength: 200 }) @IsOptional() @Transform(trim) @IsString() @Length(1, 200) @Matches(unityPattern)
  unityId?: string;
  @ApiPropertyOptional({ type: Object, description: 'JSON object, at most 16 KB', example: { scene: 'Multiply2' } }) @IsOptional() @IsObject()
  configuration?: Record<string, unknown>;
}

export class ListAdminContentDto {
  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'] }) @IsOptional() @IsIn(['draft', 'published', 'archived'])
  status?: string;
  @ApiPropertyOptional({ enum: kinds }) @IsOptional() @IsIn(kinds)
  kind?: string;
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @Transform(trim) @IsString() @Length(1, 120)
  subject?: string;
  @ApiPropertyOptional({ maxLength: 100, description: 'Case-insensitive title search' }) @IsOptional() @Transform(trim) @IsString() @Length(1, 100)
  q?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
  @ApiPropertyOptional({ minimum: 0, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class ContentVersionDto {
  @ApiProperty({ example: 1 }) version!: number;
  @ApiProperty({ example: 'math3.multiply.two-digit' }) unityId!: string;
  @ApiProperty({ type: Object }) configuration!: Record<string, unknown>;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Server time of release; null while unreleased' }) publishedAt!: Date | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class AdminContentSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() subject!: string;
  @ApiProperty({ example: 3 }) grade!: number;
  @ApiProperty({ enum: kinds }) kind!: string;
  @ApiProperty({ enum: ['draft', 'published', 'archived'] }) status!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ example: 2, description: 'Highest version number' }) latestVersion!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Highest released version; students see this one when status is published' }) currentVersion!: number | null;
}

export class AdminContentDto extends AdminContentSummaryDto {
  @ApiProperty({ type: [ContentVersionDto], description: 'All versions, oldest first' }) versions!: ContentVersionDto[];
}

export class StageInputDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID()
  contentId!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Must appear earlier in the list' }) @IsOptional() @IsUUID()
  prerequisiteContentId?: string | null;
  @ApiPropertyOptional({ default: 3, minimum: 0, maximum: 10, description: 'Best stars needed on the prerequisite' }) @IsOptional() @IsInt() @Min(0) @Max(10)
  unlockStars?: number;
}

export class ReplacePathDto {
  @ApiProperty({ type: [StageInputDto], description: 'Complete path in play order; positions become 1..n' })
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => StageInputDto)
  stages!: StageInputDto[];
}

export class PathStageDto {
  @ApiProperty({ example: 1 }) position!: number;
  @ApiProperty({ format: 'uuid' }) contentId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: kinds }) kind!: string;
  @ApiProperty({ enum: ['draft', 'published', 'archived'] }) status!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) prerequisiteContentId!: string | null;
  @ApiProperty({ example: 3 }) unlockStars!: number;
}

export class AdventurePathDto {
  @ApiProperty({ type: [PathStageDto] }) stages!: PathStageDto[];
}

export class CreateRuleDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Omit or null for the global rule' }) @IsOptional() @IsUUID()
  contentId?: string | null;
  @ApiProperty({ example: 5, minimum: 1, maximum: 10 }) @IsInt() @Min(1) @Max(10)
  maxStars!: number;
  @ApiProperty({ example: 3, minimum: 0, maximum: 10, description: 'Must not exceed maxStars' }) @IsInt() @Min(0) @Max(10)
  passStars!: number;
  @ApiPropertyOptional({ type: Object, example: { starPoints: { '3': 20, '4': 30, '5': 40 } }, description: 'Rule snapshot used by scoring; JSON object, at most 16 KB. Point values are a product decision.' })
  @IsOptional() @IsObject()
  definition?: Record<string, unknown>;
}

export class ListRulesDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only rules for this content' }) @IsOptional() @IsUUID()
  contentId?: string;
  @ApiPropertyOptional({ enum: ['global'], description: 'global lists only the global rule history' }) @IsOptional() @IsIn(['global'])
  scope?: 'global';
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
  @ApiPropertyOptional({ minimum: 0, default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class EffectiveRuleQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Omit for the global rule' }) @IsOptional() @IsUUID()
  contentId?: string;
}

export class RuleDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) contentId!: string | null;
  @ApiProperty({ example: 1, description: 'Increases by one within the scope' }) version!: number;
  @ApiProperty({ example: 5 }) maxStars!: number;
  @ApiProperty({ example: 3 }) passStars!: number;
  @ApiProperty({ type: Object }) definition!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class EffectiveRuleDto {
  @ApiProperty({ enum: ['content', 'global', 'default'], description: 'default means no rule is stored: 5 max stars, 3 to pass' }) source!: string;
  @ApiProperty({ type: RuleDto, nullable: true }) rule!: RuleDto | null;
  @ApiProperty({ example: 5 }) maxStars!: number;
  @ApiProperty({ example: 3 }) passStars!: number;
}
