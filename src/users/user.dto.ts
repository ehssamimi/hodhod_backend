import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { User } from './user.entity';

export class ProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'student@example.com' })
  email!: string;

  @ApiProperty({ enum: ['student', 'teacher', 'admin'] })
  role!: User['role'];

  @ApiProperty({ type: String, nullable: true })
  displayName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  avatarId!: string | null;

  @ApiProperty({ example: 'Asia/Tehran' })
  timezone!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class MeDto extends ProfileDto {
  @ApiProperty({ example: false, description: 'Whether a password is set; choose password/set or password/change accordingly' })
  hasPassword!: boolean;
}

/** The password hash never leaves the database; only whether one exists. */
export async function hasPassword(runner: { query: (sql: string, params: unknown[]) => Promise<unknown> }, userId: string) {
  const rows = await runner.query('SELECT password_hash IS NOT NULL AS has_password FROM users WHERE id=$1', [userId]) as Array<{ has_password: boolean }>;
  return rows[0]?.has_password === true;
}

export function profileOf(user: User): ProfileDto {
  const { id, email, role, displayName, avatarId, timezone, createdAt } = user;
  return { id, email, role, displayName, avatarId, timezone, createdAt };
}

export class ChangeRoleDto {
  @ApiProperty({ enum: ['student', 'teacher', 'admin'] })
  @IsIn(['student', 'teacher', 'admin'])
  role!: User['role'];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListUsersQueryDto {
  @ApiPropertyOptional({ enum: ['student', 'teacher', 'admin'], description: 'Return only this active role' })
  @IsOptional()
  @IsIn(['student', 'teacher', 'admin'])
  role?: User['role'];

  @ApiPropertyOptional({ example: 'sara', minLength: 1, maxLength: 120, description: 'Case-insensitive match against email or display name' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Matches(/\S/, { message: 'search must contain a non-whitespace character' })
  search?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class UserListDto {
  @ApiProperty({ type: [ProfileDto] }) items!: ProfileDto[];
  @ApiProperty({ example: 42, description: 'All matching users before pagination' }) total!: number;
  @ApiProperty({ example: 50 }) limit!: number;
  @ApiProperty({ example: 0 }) offset!: number;
}
