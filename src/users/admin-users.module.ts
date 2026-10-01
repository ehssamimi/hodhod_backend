import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiForbiddenResponse,
  ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/security';
import { ChangeRoleDto, ListUsersQueryDto, ProfileDto, UserListDto } from './user.dto';
import { User } from './user.entity';
import { RoleService } from './role.service';
import { AdminUsersService } from './admin-users.service';

@ApiTags('Admin / Users')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly roles: RoleService, private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List accounts for user administration', description: 'Newest first. Filter by active role or search email/display name; response never includes token or session data.' })
  @ApiOkResponse({ type: UserListDto })
  @ApiBadRequestResponse({ description: 'Invalid role, search or pagination value' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  list(@Query() query: ListUsersQueryDto) { return this.users.list(query); }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Change a user role, audit the change and revoke existing tokens' })
  @ApiOkResponse({ type: ProfileDto })
  @ApiBadRequestResponse({ description: 'Invalid UUID, role, reason or unexpected fields' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiConflictResponse({ description: 'The last admin cannot be demoted' })
  changeRole(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() input: ChangeRoleDto) {
    return this.roles.changeRole(actor, id, input);
  }
}

@Module({ controllers: [AdminUsersController], providers: [RoleService, AdminUsersService] })
export class AdminUsersModule {}
