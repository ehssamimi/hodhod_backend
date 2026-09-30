import { Body, Controller, HttpCode, Module, Post, Res } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiConflictResponse, ApiCreatedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../auth/security';
import { User } from '../users/user.entity';
import { AttemptResultDto, SubmitAttemptDto } from './attempts.dto';
import { AttemptsService } from './attempts.service';

@ApiTags('Student / Attempts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing, expired or revoked session' })
@ApiForbiddenResponse({ description: 'Student role required, or the Adventure stage is locked' })
@Roles('student')
@Controller('attempts')
export class AttemptsController {
  constructor(private readonly attempts: AttemptsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Submit the finished result of one online attempt',
    description: 'attemptId is the idempotency key. The first submission records the attempt, updates the best stars/attempt count of that context only (Adventure, or this one assignment turn) and adds points for the improvement only, all in one transaction. Sending the same attemptId again returns 200 with the identical result and duplicate=true, and creates nothing. The server stamps receipt time itself.',
  })
  @ApiCreatedResponse({ type: AttemptResultDto, description: 'Attempt recorded' })
  @ApiOkResponse({ type: AttemptResultDto, description: 'Same attemptId already recorded: identical result replayed, duplicate=true' })
  @ApiBadRequestResponse({ description: 'Invalid field, stars above the rule ceiling, missing/forbidden assignmentId, or contentId does not match the assignment' })
  @ApiNotFoundResponse({ description: 'Content is not on the Adventure map, or the assignment is not addressed to you in your current class' })
  @ApiConflictResponse({ description: 'attemptId reused with different data, assignment not open / not started / window closed, or content unavailable' })
  async submit(@CurrentUser() user: User, @Body() input: SubmitAttemptDto, @Res({ passthrough: true }) response: { status(code: number): unknown }): Promise<AttemptResultDto> {
    const result = await this.attempts.submit(user, input);
    if (result.duplicate) response.status(200);
    return result;
  }
}

@Module({ controllers: [AttemptsController], providers: [AttemptsService] })
export class AttemptsModule {}
