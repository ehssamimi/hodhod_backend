import { Body, Controller, HttpCode, Ip, Post, Req } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOperation,
  ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './security';
import { User } from '../users/user.entity';
import { EmailDto, RequestCodeResponseDto, VerifyCodeDto, VerifyCodeResponseDto } from './auth.dto';

@ApiTags('Shared / Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('request-code')
  @ApiOperation({ summary: 'Request a time-limited email sign-in code' })
  @ApiCreatedResponse({ type: RequestCodeResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid email or unexpected fields' })
  @ApiTooManyRequestsResponse({ description: 'Email or IP request limit exceeded' })
  @ApiServiceUnavailableResponse({ description: 'SMTP unavailable or unconfigured' })
  requestCode(@Body() body: EmailDto, @Ip() ip: string) { return this.auth.requestCode(body.email,ip); }

  @Public()
  @Post('verify-code')
  @ApiOperation({ summary: 'Consume a one-time code and create a revocable session' })
  @ApiCreatedResponse({ type: VerifyCodeResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid email/code format or unexpected fields' })
  @ApiUnauthorizedResponse({ description: 'Incorrect, expired, consumed or locked verification code' })
  @ApiTooManyRequestsResponse({ description: 'Email or IP verification limit exceeded' })
  verifyCode(@Body() body: VerifyCodeDto, @Ip() ip: string) { return this.auth.verifyCode(body.email,body.code,ip); }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'Current session revoked' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
  logout(@CurrentUser() user: User, @Req() request: { sessionId: string }) { return this.auth.logout(user,request.sessionId); }

  @Post('logout-all')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'All sessions for the current account revoked' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
  logoutAll(@CurrentUser() user: User) { return this.auth.logoutAll(user); }
}
