import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../auth/security';
import { hasPassword, MeDto, profileOf } from './user.dto';
import { User } from './user.entity';

@ApiTags('Shared / Profile')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
@Controller('me')
export class ProfileController {
  constructor(private readonly source: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Get your account: role, display name, avatar, timezone and password status' })
  @ApiOkResponse({ type: MeDto, description: 'Current account only; identity comes from the verified token' })
  async getProfile(@CurrentUser() user: User): Promise<MeDto> {
    return { ...profileOf(user), hasPassword: await hasPassword(this.source, user.id) };
  }
}

@Module({ controllers: [ProfileController] })
export class ProfileModule {}
