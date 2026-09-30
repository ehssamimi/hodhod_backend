import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class JoinClassDto {
  @ApiProperty({ example: 'A123B456C789D012', minLength: 1, maxLength: 32, description: 'Case-sensitive class code; surrounding whitespace is trimmed' })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 32)
  code!: string;
}

export class MembershipDto {
  @ApiProperty({ format: 'uuid', example: '11111111-1111-4111-8111-111111111111' }) id!: string;
  @ApiProperty({ format: 'uuid', example: '22222222-2222-4222-8222-222222222222' }) classId!: string;
  @ApiProperty({ example: 'Third grade A' }) className!: string;
  @ApiProperty({ format: 'uuid', example: '33333333-3333-4333-8333-333333333333' }) studentId!: string;
  @ApiProperty({ format: 'date-time', example: '2026-09-30T10:00:00.000Z' }) joinedAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null }) endedAt!: Date | null;
}

export class CurrentMembershipDto {
  @ApiProperty({ type: MembershipDto, nullable: true, description: 'Null is a valid student without a class' })
  membership!: MembershipDto | null;
}
