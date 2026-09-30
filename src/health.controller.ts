import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from './auth/security';

@ApiTags('Shared / Health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOkResponse({ schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } })
  health() { return { status: 'ok' }; }
}
