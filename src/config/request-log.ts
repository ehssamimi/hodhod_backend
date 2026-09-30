import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

type Req = { method: string; url: string; headers: Record<string, string | string[] | undefined> };
type Res = { statusCode: number; setHeader(name: string, value: string): void; on(event: 'finish', listener: () => void): void };

const logger = new Logger('http');
// Accept only a plain token as caller-supplied request id, so logs cannot be forged with newlines.
const safeId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(value) ? value : undefined;

// One JSON line per request: method, path without the query string, status, duration, request id.
// Bodies, headers, tokens, e-mail addresses and query strings are never logged.
export function requestLog(req: Req, res: Res, next: () => void): void {
  const started = process.hrtime.bigint();
  const requestId = safeId(req.headers['x-request-id']) ?? randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    const ms = Number((process.hrtime.bigint() - started) / 1000000n);
    const line = JSON.stringify({ requestId, method: req.method, path: req.url.split('?')[0], status: res.statusCode, ms });
    if (res.statusCode >= 500) logger.error(line); else logger.log(line);
  });
  next();
}
