import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './auth/security';

@ApiTags('Shared / Health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness check: the process is up' })
  @ApiOkResponse({ schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } })
  health() { return { status: 'ok' }; }
}
