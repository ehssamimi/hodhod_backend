import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/security';
import { User } from '../users/user.entity';
import { AdventureMapDto } from './adventure.dto';
import { AdventureService } from './adventure.service';

@ApiTags('Student / Adventure')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Student role required' })
@Roles('student')
@Controller('adventure')
export class AdventureController {
  constructor(private readonly adventure: AdventureService) {}

  @Get('map')
  @ApiOperation({
    summary: 'Get the Adventure path with your lock state and progress',
    description: 'Lock state is computed by the server from your own Adventure progress. A stage unlocks when your best stars on its prerequisite reach unlockStars (default 3). Teacher assignments never affect it.',
  })
  @ApiOkResponse({ type: AdventureMapDto })
  map(@CurrentUser() user: User) { return this.adventure.map(user.id); }
}

@Module({ controllers: [AdventureController], providers: [AdventureService] })
export class StudentAdventureModule {}
