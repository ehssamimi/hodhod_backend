import { Body, Controller, HttpCode, Ip, Module, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse,
  ApiNoContentResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse } from '@nestjs/swagger';
import { User } from '../users/user.entity';
import { AuthService } from './auth.service';
import { ChangePasswordDto, EmailDto, PasswordLoginDto, RequestCodeResponseDto, ResetPasswordDto,
  SetPasswordDto, VerifyCodeDto, VerifyCodeResponseDto } from './auth.dto';
import { AuthModule } from './auth.module';
import { CurrentUser, Public, Roles } from './security';

const commonPublicErrors = () => <MethodDecorator>function (_target, _key, descriptor) {
  ApiBadRequestResponse({ description: 'Invalid input or unexpected fields' })(_target, _key, descriptor);
  ApiTooManyRequestsResponse({ description: 'Email or IP authentication limit exceeded' })(_target, _key, descriptor);
};

abstract class RoleAuthController {
  protected abstract readonly role: User['role'];
  constructor(protected readonly auth: AuthService) {}

  requestCode(body: EmailDto, ip: string) { return this.auth.requestRoleCode(body.email, ip, this.role); }
  verifyCode(body: VerifyCodeDto, ip: string) { return this.auth.verifyCodeForRole(body.email, body.code, ip, this.role); }
  login(body: PasswordLoginDto, ip: string) { return this.auth.loginWithPassword(body.email, body.password, ip, this.role); }
  set(user: User, body: SetPasswordDto) { return this.auth.setPassword(user, body.newPassword); }
  change(user: User, body: ChangePasswordDto) { return this.auth.changePassword(user, body.currentPassword, body.newPassword); }
  requestReset(body: EmailDto, ip: string) { return this.auth.requestPasswordReset(body.email, ip, this.role); }
  reset(body: ResetPasswordDto, ip: string) { return this.auth.resetPassword(body.email, body.code, body.newPassword, ip, this.role); }
}

function authControllerDecorators(tag: string, role: User['role']) {
  return function <T extends { new (...args: never[]): object }>(target: T): T {
    ApiTags(tag)(target);
    Roles(role)(target);
    return target;
  };
}

@authControllerDecorators('Student / Authentication', 'student')
@Controller('student/auth')
export class StudentAuthController extends RoleAuthController {
  protected readonly role = 'student' as const;
  constructor(auth: AuthService) { super(auth); }

  @Public() @Post('request-code')
  @ApiOperation({ summary: 'Request a student email sign-in code' })
  @ApiCreatedResponse({ type: RequestCodeResponseDto }) @commonPublicErrors()
  @ApiServiceUnavailableResponse({ description: 'SMTP unavailable or unconfigured' })
  requestCode(@Body() body: EmailDto, @Ip() ip: string) { return super.requestCode(body, ip); }

  @Public() @Post('verify-code')
  @ApiOperation({ summary: 'Sign in or register a student with an email code' })
  @ApiCreatedResponse({ type: VerifyCodeResponseDto }) @commonPublicErrors()
  @ApiUnauthorizedResponse({ description: 'Invalid, expired or consumed code, or wrong account role' })
  verifyCode(@Body() body: VerifyCodeDto, @Ip() ip: string) { return super.verifyCode(body, ip); }

  @Public() @Post('login/password')
  @ApiOperation({ summary: 'Sign in a student with email and password' })
  @ApiCreatedResponse({ type: VerifyCodeResponseDto }) @commonPublicErrors()
  @ApiUnauthorizedResponse({ description: 'Invalid email, password or account role' })
  login(@Body() body: PasswordLoginDto, @Ip() ip: string) { return super.login(body, ip); }

  @Post('password/set') @HttpCode(204) @ApiBearerAuth()
  @ApiOperation({ summary: 'Set the first password after verified email sign-in' })
  @ApiNoContentResponse({ description: 'Password set; all sessions revoked' })
  @ApiBadRequestResponse({ description: 'Invalid password or unexpected fields' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
  @ApiConflictResponse({ description: 'Password is already set' })
  set(@CurrentUser() user: User, @Body() body: SetPasswordDto) { return super.set(user, body); }

  @Post('password/change') @HttpCode(204) @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the current student password' })
  @ApiNoContentResponse({ description: 'Password changed; all sessions revoked' })
  @ApiBadRequestResponse({ description: 'Invalid password or unexpected fields' })
  @ApiUnauthorizedResponse({ description: 'Missing/revoked session or incorrect current password' })
  change(@CurrentUser() user: User, @Body() body: ChangePasswordDto) { return super.change(user, body); }

  @Public() @Post('password/reset/request-code')
  @ApiOperation({ summary: 'Request a student password-reset code' })
  @ApiCreatedResponse({ type: RequestCodeResponseDto }) @commonPublicErrors()
  @ApiServiceUnavailableResponse({ description: 'SMTP unavailable or unconfigured' })
  requestReset(@Body() body: EmailDto, @Ip() ip: string) { return super.requestReset(body, ip); }

  @Public() @Post('password/reset/confirm') @HttpCode(204)
  @ApiOperation({ summary: 'Reset a student password with an email code' })
  @ApiNoContentResponse({ description: 'Password reset; all sessions revoked' }) @commonPublicErrors()
  @ApiUnauthorizedResponse({ description: 'Invalid, expired or consumed code, or wrong account role' })
  reset(@Body() body: ResetPasswordDto, @Ip() ip: string) { return super.reset(body, ip); }
}

@authControllerDecorators('Teacher / Authentication', 'teacher')
@Controller('teacher/auth')
export class TeacherAuthController extends RoleAuthController {
  protected readonly role = 'teacher' as const;
  constructor(auth: AuthService) { super(auth); }

  @Public() @Post('request-code')
  @ApiOperation({ summary: 'Request a teacher email sign-in code' })
  @ApiCreatedResponse({ type: RequestCodeResponseDto }) @commonPublicErrors()
  @ApiServiceUnavailableResponse({ description: 'SMTP unavailable or unconfigured' })
  requestCode(@Body() body: EmailDto, @Ip() ip: string) { return super.requestCode(body, ip); }

  @Public() @Post('verify-code')
  @ApiOperation({ summary: 'Sign in a teacher with an email code' })
  @ApiCreatedResponse({ type: VerifyCodeResponseDto }) @commonPublicErrors()
  @ApiUnauthorizedResponse({ description: 'Invalid, expired or consumed code, or wrong account role' })
  verifyCode(@Body() body: VerifyCodeDto, @Ip() ip: string) { return super.verifyCode(body, ip); }

  @Public() @Post('login/password')
  @ApiOperation({ summary: 'Sign in a teacher with email and password' })
  @ApiCreatedResponse({ type: VerifyCodeResponseDto }) @commonPublicErrors()
  @ApiUnauthorizedResponse({ description: 'Invalid email, password or account role' })
  login(@Body() body: PasswordLoginDto, @Ip() ip: string) { return super.login(body, ip); }

  @Post('password/set') @HttpCode(204) @ApiBearerAuth()
  @ApiOperation({ summary: 'Set the first password after verified teacher email sign-in' })
  @ApiNoContentResponse({ description: 'Password set; all sessions revoked' })
  @ApiBadRequestResponse({ description: 'Invalid password or unexpected fields' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
  @ApiForbiddenResponse({ description: 'Teacher role required' })
  @ApiConflictResponse({ description: 'Password is already set' })
  set(@CurrentUser() user: User, @Body() body: SetPasswordDto) { return super.set(user, body); }

  @Post('password/change') @HttpCode(204) @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the current teacher password' })
  @ApiNoContentResponse({ description: 'Password changed; all sessions revoked' })
  @ApiBadRequestResponse({ description: 'Invalid password or unexpected fields' })
  @ApiUnauthorizedResponse({ description: 'Missing/revoked session or incorrect current password' })
  @ApiForbiddenResponse({ description: 'Teacher role required' })
  change(@CurrentUser() user: User, @Body() body: ChangePasswordDto) { return super.change(user, body); }

  @Public() @Post('password/reset/request-code')
  @ApiOperation({ summary: 'Request a teacher password-reset code' })
  @ApiCreatedResponse({ type: RequestCodeResponseDto }) @commonPublicErrors()
  @ApiServiceUnavailableResponse({ description: 'SMTP unavailable or unconfigured' })
  requestReset(@Body() body: EmailDto, @Ip() ip: string) { return super.requestReset(body, ip); }

  @Public() @Post('password/reset/confirm') @HttpCode(204)
  @ApiOperation({ summary: 'Reset a teacher password with an email code' })
  @ApiNoContentResponse({ description: 'Password reset; all sessions revoked' }) @commonPublicErrors()
  @ApiUnauthorizedResponse({ description: 'Invalid, expired or consumed code, or wrong account role' })
  reset(@Body() body: ResetPasswordDto, @Ip() ip: string) { return super.reset(body, ip); }
}

@authControllerDecorators('Admin / Authentication', 'admin')
@Controller('admin/auth')
export class AdminAuthController extends RoleAuthController {
  protected readonly role = 'admin' as const;
  constructor(auth: AuthService) { super(auth); }

  @Public() @Post('request-code')
  @ApiOperation({ summary: 'Request an admin email sign-in code' })
  @ApiCreatedResponse({ type: RequestCodeResponseDto }) @commonPublicErrors()
  @ApiServiceUnavailableResponse({ description: 'SMTP unavailable or unconfigured' })
  requestCode(@Body() body: EmailDto, @Ip() ip: string) { return super.requestCode(body, ip); }

  @Public() @Post('verify-code')
  @ApiOperation({ summary: 'Sign in an admin with an email code' })
  @ApiCreatedResponse({ type: VerifyCodeResponseDto }) @commonPublicErrors()
  @ApiUnauthorizedResponse({ description: 'Invalid, expired or consumed code, or wrong account role' })
  verifyCode(@Body() body: VerifyCodeDto, @Ip() ip: string) { return super.verifyCode(body, ip); }

  @Public() @Post('login/password')
  @ApiOperation({ summary: 'Sign in an admin with email and password' })
  @ApiCreatedResponse({ type: VerifyCodeResponseDto }) @commonPublicErrors()
  @ApiUnauthorizedResponse({ description: 'Invalid email, password or account role' })
  login(@Body() body: PasswordLoginDto, @Ip() ip: string) { return super.login(body, ip); }

  @Post('password/set') @HttpCode(204) @ApiBearerAuth()
  @ApiOperation({ summary: 'Set the first password after verified admin email sign-in' })
  @ApiNoContentResponse({ description: 'Password set; all sessions revoked' })
  @ApiBadRequestResponse({ description: 'Invalid password or unexpected fields' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiConflictResponse({ description: 'Password is already set' })
  set(@CurrentUser() user: User, @Body() body: SetPasswordDto) { return super.set(user, body); }

  @Post('password/change') @HttpCode(204) @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the current admin password' })
  @ApiNoContentResponse({ description: 'Password changed; all sessions revoked' })
  @ApiBadRequestResponse({ description: 'Invalid password or unexpected fields' })
  @ApiUnauthorizedResponse({ description: 'Missing/revoked session or incorrect current password' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  change(@CurrentUser() user: User, @Body() body: ChangePasswordDto) { return super.change(user, body); }

  @Public() @Post('password/reset/request-code')
  @ApiOperation({ summary: 'Request an admin password-reset code' })
  @ApiCreatedResponse({ type: RequestCodeResponseDto }) @commonPublicErrors()
  @ApiServiceUnavailableResponse({ description: 'SMTP unavailable or unconfigured' })
  requestReset(@Body() body: EmailDto, @Ip() ip: string) { return super.requestReset(body, ip); }

  @Public() @Post('password/reset/confirm') @HttpCode(204)
  @ApiOperation({ summary: 'Reset an admin password with an email code' })
  @ApiNoContentResponse({ description: 'Password reset; all sessions revoked' }) @commonPublicErrors()
  @ApiUnauthorizedResponse({ description: 'Invalid, expired or consumed code, or wrong account role' })
  reset(@Body() body: ResetPasswordDto, @Ip() ip: string) { return super.reset(body, ip); }
}

@Module({ imports: [AuthModule], controllers: [StudentAuthController] })
export class StudentAuthModule {}

@Module({ imports: [AuthModule], controllers: [TeacherAuthController] })
export class TeacherAuthModule {}

@Module({ imports: [AuthModule], controllers: [AdminAuthController] })
export class AdminAuthModule {}
