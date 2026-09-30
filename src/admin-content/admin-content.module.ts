import { Body, Controller, Get, HttpCode, Module, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/security';
import { User } from '../users/user.entity';
import {
  AdminContentDto, AdminContentSummaryDto, AdventurePathDto, CreateContentDto, CreateRuleDto, CreateVersionDto, EffectiveRuleDto,
  EffectiveRuleQueryDto, ListAdminContentDto, ListRulesDto, ReplacePathDto, RuleDto, UpdateContentDto, UpdateVersionDto,
} from './admin-content.dto';
import { AdminContentService } from './admin-content.service';

@ApiTags('Admin / Content')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Admin role required' })
@ApiBadRequestResponse({ description: 'Invalid UUID, field, filter or unexpected property' })
@Roles('admin')
@Controller('admin/content')
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get()
  @ApiOperation({ summary: 'List content in every status, newest first' })
  @ApiOkResponse({ type: [AdminContentSummaryDto] })
  list(@Query() query: ListAdminContentDto) { return this.content.list(query); }

  @Post()
  @ApiOperation({ summary: 'Create a draft content item with its first (unreleased) version and Unity mapping' })
  @ApiCreatedResponse({ type: AdminContentDto })
  @ApiConflictResponse({ description: 'Unity ID already mapped to another content item' })
  create(@CurrentUser() user: User, @Body() input: CreateContentDto) { return this.content.create(user, input); }

  @Get(':id')
  @ApiOperation({ summary: 'Get one content item with all versions' })
  @ApiOkResponse({ type: AdminContentDto })
  @ApiNotFoundResponse({ description: 'Content not found' })
  get(@Param('id', ParseUUIDPipe) id: string) { return this.content.get(id); }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit title, subject or kind; the stable ID never changes' })
  @ApiOkResponse({ type: AdminContentDto })
  @ApiNotFoundResponse({ description: 'Content not found' })
  @ApiConflictResponse({ description: 'Kind change would break an Adventure stage or assignment' })
  update(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateContentDto) { return this.content.update(user, id, input); }

  @Post(':id/versions')
  @ApiOperation({ summary: 'Add the next unreleased version with a Unity mapping', description: 'Version numbers are assigned by the server. Students keep seeing the last released version until this one is released.' })
  @ApiCreatedResponse({ type: AdminContentDto })
  @ApiNotFoundResponse({ description: 'Content not found' })
  @ApiConflictResponse({ description: 'Unity ID already mapped to another content item' })
  addVersion(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() input: CreateVersionDto) { return this.content.addVersion(user, id, input); }

  @Patch(':id/versions/:version')
  @ApiOperation({ summary: 'Correct an unreleased version', description: 'Released versions are immutable (also enforced by the database).' })
  @ApiOkResponse({ type: AdminContentDto })
  @ApiNotFoundResponse({ description: 'Content or version not found' })
  @ApiConflictResponse({ description: 'Version is released, or Unity ID is mapped elsewhere' })
  updateVersion(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('version', ParseIntPipe) version: number, @Body() input: UpdateVersionDto) {
    return this.content.updateVersion(user, id, version, input);
  }

  @Post(':id/versions/:version/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Release a version at the server time and publish the item', description: 'Repeating the call keeps the original release time.' })
  @ApiOkResponse({ type: AdminContentDto })
  @ApiNotFoundResponse({ description: 'Content or version not found' })
  @ApiConflictResponse({ description: 'A newer version is already released' })
  publish(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Param('version', ParseIntPipe) version: number) { return this.content.publish(user, id, version); }

  @Post(':id/unpublish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hide the item from clients again (back to draft); history is kept' })
  @ApiOkResponse({ type: AdminContentDto })
  @ApiNotFoundResponse({ description: 'Content not found' })
  unpublish(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.content.setStatus(user, id, 'draft'); }

  @Post(':id/archive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive the item; nothing is deleted' })
  @ApiOkResponse({ type: AdminContentDto })
  @ApiNotFoundResponse({ description: 'Content not found' })
  archive(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) { return this.content.setStatus(user, id, 'archived'); }
}

@ApiTags('Admin / Adventure path')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Admin role required' })
@Roles('admin')
@Controller('admin/adventure/path')
export class AdminAdventureController {
  constructor(private readonly content: AdminContentService) {}

  @Get()
  @ApiOperation({ summary: 'Get the whole Adventure path in order, including unpublished content' })
  @ApiOkResponse({ type: AdventurePathDto })
  get() { return this.content.path(); }

  @Put()
  @ApiOperation({
    summary: 'Replace the Adventure path (order, prerequisites, unlock stars)',
    description: 'Send every stage in play order; positions become 1..n. A prerequisite must appear earlier, so cycles are impossible. Adventure or both content only. Omitted stages are removed unless students already have progress there.',
  })
  @ApiOkResponse({ type: AdventurePathDto })
  @ApiBadRequestResponse({ description: 'Duplicate stage, unknown or practice-only content, prerequisite not earlier, unlockStars above the prerequisite star ceiling' })
  @ApiConflictResponse({ description: 'A removed stage already has student progress' })
  replace(@CurrentUser() user: User, @Body() input: ReplacePathDto) { return this.content.replacePath(user, input); }
}

@ApiTags('Admin / Scoring rules')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Admin role required' })
@ApiBadRequestResponse({ description: 'Invalid UUID, stars, filter or unexpected property' })
@Roles('admin')
@Controller('admin/rules')
export class AdminRulesController {
  constructor(private readonly content: AdminContentService) {}

  @Get()
  @ApiOperation({ summary: 'List rule versions, newest first' })
  @ApiOkResponse({ type: [RuleDto] })
  list(@Query() query: ListRulesDto) { return this.content.listRules(query); }

  @Post()
  @ApiOperation({
    summary: 'Add the next rule version for one content item or globally',
    description: 'Rules are append-only: this never edits earlier versions or recorded points, and the database rejects UPDATE/DELETE on rules and the point ledger. Defaults when nothing is stored: 5 max stars, 3 to pass.',
  })
  @ApiCreatedResponse({ type: RuleDto })
  @ApiNotFoundResponse({ description: 'Content not found' })
  create(@CurrentUser() user: User, @Body() input: CreateRuleDto) { return this.content.createRule(user, input); }

  @Get('effective')
  @ApiOperation({ summary: 'Resolve the rule that applies now: content rule, else global rule, else defaults' })
  @ApiOkResponse({ type: EffectiveRuleDto })
  @ApiNotFoundResponse({ description: 'Content not found' })
  effective(@Query() query: EffectiveRuleQueryDto) { return this.content.effectiveFor(query.contentId); }

  @Get(':id')
  @ApiOperation({ summary: 'Get one rule version' })
  @ApiOkResponse({ type: RuleDto })
  @ApiNotFoundResponse({ description: 'Rule not found' })
  get(@Param('id', ParseUUIDPipe) id: string) { return this.content.getRule(id); }
}

@Module({
  controllers: [AdminContentController, AdminAdventureController, AdminRulesController],
  providers: [AdminContentService],
})
export class AdminContentModule {}
