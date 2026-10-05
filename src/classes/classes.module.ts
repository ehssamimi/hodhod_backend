import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/security';
import { User } from '../users/user.entity';
import { ClassDto, CreateClassDto } from './classes.dto';
import { ClassesService } from './classes.service';
import { ClassMemberDto } from './memberships.dto';
import { MembershipsService } from './memberships.service';

@ApiTags('Teacher / Classes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Teacher role required' })
@ApiBadRequestResponse({ description: 'Invalid name, UUID or unexpected property' })
@ApiNotFoundResponse({ description: 'Class missing or owned by another teacher' })
@Roles('teacher')
@Controller('teacher/classes')
export class ClassesController {
  constructor(private readonly classes: ClassesService, private readonly memberships: MembershipsService) {}

  @Get(':id/members')
  @ApiOperation({ summary: 'List current members of your class; archived classes return an empty list' })
  @ApiOkResponse({ type: [ClassMemberDto] })
  members(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.memberships.members(user, id); }

  @Delete(':id/members/:studentId')
  @ApiOperation({ summary: 'End a membership in your class, preserving its history', description: 'Returns removed=false if already absent. Cannot remove a membership in another class.' })
  @ApiOkResponse({ schema: { type: 'object', required: ['removed'], properties: { removed: { type: 'boolean', example: true } } } })
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.memberships.remove(user, id, studentId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a class with a random unique join code' })
  @ApiCreatedResponse({ type: ClassDto })
  create(@CurrentUser() user: User, @Body() input: CreateClassDto) { return this.classes.create(user, input.name); }

  @Get()
  @ApiOperation({ summary: 'List your active and archived classes' })
  @ApiOkResponse({ type: [ClassDto] })
  list(@CurrentUser() user: User) { return this.classes.list(user); }

  @Get(':id')
  @ApiOperation({ summary: 'Get your class and its active join code' })
  @ApiOkResponse({ type: ClassDto })
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.classes.get(user, id); }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive your class; repeated requests preserve the original archive time' })
  @ApiCreatedResponse({ type: ClassDto })
  archive(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.classes.archive(user, id); }

  @Post(':id/join-code/rotate')
  @ApiOperation({ summary: 'Replace the join code of your active class; old code is removed' })
  @ApiCreatedResponse({ type: ClassDto })
  @ApiConflictResponse({ description: 'Class archived or code allocation needs retry' })
  rotate(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.classes.rotateCode(user, id); }
}

@Module({ controllers: [ClassesController], providers: [ClassesService, MembershipsService] })
export class ClassesModule {}
