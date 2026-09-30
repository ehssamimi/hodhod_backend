import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/security';
import { User } from '../users/user.entity';
import { CurrentMembershipDto, JoinClassDto, MembershipDto } from './memberships.dto';
import { MembershipsService } from './memberships.service';

@ApiTags('Student / Classes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Student role required' })
@Roles('student')
@Controller('classes')
export class StudentClassesController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Get your active membership; null when you have no class' })
  @ApiOkResponse({ type: CurrentMembershipDto })
  mine(@CurrentUser() user: User) { return this.memberships.mine(user); }

  @Get('history')
  @ApiOperation({ summary: 'Get your membership history, newest first' })
  @ApiOkResponse({ type: [MembershipDto] })
  history(@CurrentUser() user: User) { return this.memberships.history(user); }

  @Post('join')
  @HttpCode(200)
  @ApiOperation({ summary: 'Join by code or atomically transfer from your current class', description: 'Joining your current class is a no-op. Transfer ends the previous membership and retains all personal progress and points.' })
  @ApiOkResponse({ type: CurrentMembershipDto })
  @ApiBadRequestResponse({ description: 'Invalid code or unexpected property' })
  @ApiNotFoundResponse({ description: 'Code missing, rotated or class archived; current membership is unchanged' })
  join(@CurrentUser() user: User, @Body() input: JoinClassDto) { return this.memberships.join(user, input.code); }

  @Post('leave')
  @HttpCode(200)
  @ApiOperation({ summary: 'End your current membership; repeated requests are a no-op' })
  @ApiOkResponse({ type: CurrentMembershipDto })
  leave(@CurrentUser() user: User) { return this.memberships.leave(user); }
}

@Module({ controllers: [StudentClassesController], providers: [MembershipsService] })
export class StudentClassesModule {}
