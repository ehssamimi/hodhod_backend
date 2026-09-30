import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from './auth/security';

@ApiTags('Shared / Health')
@Controller('health')
export class HealthController {
  constructor(private readonly source: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness check: the process is up' })
  @ApiOkResponse({ schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } })
  health() { return { status: 'ok' }; }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness check: the database answers', description: 'Use for load balancer and orchestrator probes. Reveals nothing beyond the status.' })
  @ApiOkResponse({ schema: { type: 'object', properties: { status: { type: 'string', example: 'ready' } } } })
  @ApiServiceUnavailableResponse({ description: 'The database is unreachable' })
  async ready() {
    try { await this.source.query('SELECT 1'); }
    catch { throw new ServiceUnavailableException({ status: 'unavailable' }); }
    return { status: 'ready' };
  }
}
