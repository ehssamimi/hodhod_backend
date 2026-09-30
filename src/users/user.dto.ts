import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
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
