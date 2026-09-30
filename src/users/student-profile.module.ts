import { Body, Controller, Module, Patch } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiForbiddenResponse, ApiOkResponse,
  ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/security';
import { ProfileSettingsDto } from './profile-settings.dto';
import { ProfileSettingsService } from './profile-settings.service';
import { ProfileDto } from './user.dto';
import { User } from './user.entity';

@ApiTags('Student / Account settings')
@ApiBearerAuth()
@Roles('student')
@Controller('me')
export class StudentProfileController {
  constructor(private readonly settings: ProfileSettingsService) {}

  @Patch()
  @ApiOperation({ summary: 'Update your display name, avatar identifier and timezone' })
  @ApiOkResponse({ type: ProfileDto })
  @ApiBadRequestResponse({ description: 'Invalid field, timezone, or unexpected property' })
  @ApiUnauthorizedResponse({ description: 'Missing, expired or revoked access token' })
  @ApiForbiddenResponse({ description: 'Student role required' })
  update(@CurrentUser() user: User, @Body() input: ProfileSettingsDto) {
    return this.settings.update(user, input);
  }
}

@Module({ controllers: [StudentProfileController], providers: [ProfileSettingsService] })
export class StudentProfileModule {}
