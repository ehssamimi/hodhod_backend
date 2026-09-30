import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, Matches } from 'class-validator';
import { ProfileDto } from '../users/user.dto';

export class EmailDto {
  @ApiProperty({ example: 'student@example.com' })
  @IsEmail()
  email!: string;
}

export class VerifyCodeDto extends EmailDto {
  @ApiProperty({ example: '083719', description: 'Six-digit emailed code; 11111 only in explicitly enabled development mode' })
  @Matches(/^(?:\d{6}|11111)$/)
  code!: string;
}

export class RequestCodeResponseDto {
  @ApiProperty({ example: 'If delivery succeeds, a sign-in code will arrive shortly' })
  message!: string;
}

export class AuthUserDto extends ProfileDto {}

export class VerifyCodeResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken!: string;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;

  @ApiProperty({ example: true })
  isNewUser!: boolean;
}
