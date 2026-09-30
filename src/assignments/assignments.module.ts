import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/security';
import { User } from '../users/user.entity';
import { AssignmentDetailDto, AssignmentDto, CreateAssignmentDto, ListAssignmentsDto } from './assignments.dto';
import { AssignmentsService } from './assignments.service';

@ApiTags('Teacher / Assignments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Teacher role required' })
@ApiBadRequestResponse({ description: 'Invalid field, window, audience or unexpected property' })
@Roles('teacher')
@Controller('teacher/assignments')
export class TeacherAssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Assign published practice content to a whole class or selected students for a time window',
    description: 'Each call creates a new independent allocation (new ID), even for the same content and class. Recipients are stored explicitly and fixed at creation: whole_class snapshots the current members. There are no student groups.',
  })
  @ApiCreatedResponse({ type: AssignmentDetailDto })
  @ApiNotFoundResponse({ description: 'Class not yours, or content not published practice content' })
  @ApiConflictResponse({ description: 'Class archived, or whole_class with no students' })
  create(@CurrentUser() user: User, @Body() input: CreateAssignmentDto) { return this.assignments.create(user, input); }

  @Get()
  @ApiOperation({ summary: 'List your assignments, newest window first' })
  @ApiOkResponse({ type: [AssignmentDto] })
  list(@CurrentUser() user: User, @Query() query: ListAssignmentsDto) { return this.assignments.list(user, query); }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of your assignments with its recipients' })
  @ApiOkResponse({ type: AssignmentDetailDto })
  @ApiNotFoundResponse({ description: 'Assignment missing or owned by another teacher' })
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.assignments.get(user, id); }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an assignment whose window has not ended; records are kept', description: 'Repeating the call is a no-op.' })
  @ApiOkResponse({ type: AssignmentDetailDto })
  @ApiNotFoundResponse({ description: 'Assignment missing or owned by another teacher' })
  @ApiConflictResponse({ description: 'The window has already ended' })
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.assignments.cancel(user, id); }
}

@Module({ controllers: [TeacherAssignmentsController], providers: [AssignmentsService] })
export class TeacherAssignmentsModule {}
