import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser } from '../auth/security';
import { ProfileDto, profileOf } from './user.dto';
import { User } from './user.entity';

@ApiTags('Shared / Profile')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
@Controller('me')
export class ProfileController {
  @Get()
  @ApiOperation({ summary: 'Get your account: role, display name, avatar and timezone' })
  @ApiOkResponse({ type: ProfileDto, description: 'Current account only; identity comes from the verified token' })
  getProfile(@CurrentUser() user: User): ProfileDto { return profileOf(user); }
}

@Module({ controllers: [ProfileController] })
export class ProfileModule {}
