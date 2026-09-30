import { Controller, Get, Module, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Roles } from '../auth/security';
import { ContentDto, ListContentDto, ListStudentContentDto } from './content.dto';
import { ContentService } from './content.service';

@ApiTags('Student / Content')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Student role required' })
@ApiBadRequestResponse({ description: 'Invalid filter, UUID or unexpected property' })
@Roles('student')
@Controller('content')
export class StudentContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  @ApiOperation({ summary: 'List published Adventure and practice content', description: 'Drafts, archived items and unreleased versions are never returned.' })
  @ApiOkResponse({ type: [ContentDto] })
  list(@Query() query: ListStudentContentDto) { return this.content.list(query.kind, query); }

  @Get(':id')
  @ApiOperation({ summary: 'Get one published content item' })
  @ApiOkResponse({ type: ContentDto })
  @ApiNotFoundResponse({ description: 'Content missing or not published' })
  get(@Param('id', ParseUUIDPipe) id: string) { return this.content.get(id); }
}

@ApiTags('Teacher / Content')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Teacher role required' })
@ApiBadRequestResponse({ description: 'Invalid filter, UUID or unexpected property' })
@Roles('teacher')
@Controller('teacher/content')
export class TeacherContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  @ApiOperation({ summary: 'Search published content that can be assigned as practice', description: 'Adventure-only items are excluded.' })
  @ApiOkResponse({ type: [ContentDto] })
  list(@Query() query: ListContentDto) { return this.content.list(undefined, query, 'practice'); }

  @Get(':id')
  @ApiOperation({ summary: 'Preview one assignable published content item' })
  @ApiOkResponse({ type: ContentDto })
  @ApiNotFoundResponse({ description: 'Content missing, not published or not available for practice' })
  get(@Param('id', ParseUUIDPipe) id: string) { return this.content.get(id, 'practice'); }
}

@Module({ controllers: [StudentContentController], providers: [ContentService] })
export class StudentContentModule {}

@Module({ controllers: [TeacherContentController], providers: [ContentService] })
export class TeacherContentModule {}
