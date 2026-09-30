import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength, ValidateBy, ValidateIf } from 'class-validator';

export function isNamedTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64 ||
      !/^[A-Za-z][A-Za-z0-9._+-]*(\/[A-Za-z0-9._+-]+)*$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; }
  catch { return false; }
}

export class ProfileSettingsDto {
  @ApiPropertyOptional({ type: String, nullable: true, minLength: 1, maxLength: 120, example: 'سارا' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Matches(/^[^\u0000-\u001F\u007F]+$/u)
  displayName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 128, example: 'owl_blue',
    description: 'Avatar catalog identifier; letters, digits, underscore and hyphen. Null clears selection.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  avatarId?: string | null;

  @ApiPropertyOptional({ example: 'Asia/Tehran', maxLength: 64, description: 'Named IANA timezone; numeric UTC offsets are not accepted' })
  @ValidateIf((_object, value) => value !== undefined)
  @ValidateBy({ name: 'isNamedTimezone', validator: {
    validate: isNamedTimezone,
    defaultMessage: () => 'timezone must be a valid named IANA timezone',
  } })
  timezone?: string;
}
