import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
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

export class PasswordLoginDto extends EmailDto {
  @ApiProperty({ example: 'correct horse battery staple', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class SetPasswordDto {
  @ApiProperty({ example: 'correct horse battery staple', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class ChangePasswordDto extends SetPasswordDto {
  @ApiProperty({ example: 'previous correct horse battery staple', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword!: string;
}

export class ResetPasswordDto extends VerifyCodeDto {
  @ApiProperty({ example: 'new correct horse battery staple', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}

export class RequestCodeResponseDto {
  @ApiProperty({ example: 'If the account is eligible, a verification code will arrive shortly' })
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
