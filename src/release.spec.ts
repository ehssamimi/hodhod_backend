import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { productionConfigProblems } from './config/production-config';
import { requestLog } from './config/request-log';
import { HealthController } from './health.controller';

const good = {
  NODE_ENV: 'production', JWT_SECRET: 'j'.repeat(40), AUTH_OTP_SECRET: 'o'.repeat(40),
  DATABASE_HOST: 'postgres', DATABASE_USER: 'hodhod', DATABASE_PASSWORD: 'a-strong-database-password', DATABASE_NAME: 'hodhod',
  SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'Hodhod <no-reply@example.com>',
};

describe('production configuration', () => {
  it('accepts a complete production configuration and relaxes only development and test', () => {
    expect(productionConfigProblems(good)).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: 'development' })).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: 'test' })).toEqual([]);
  });

  it.each([
    ['unset NODE_ENV', { NODE_ENV: undefined }, 'NODE_ENV'],
    ['short JWT secret', { JWT_SECRET: 'short' }, 'JWT_SECRET'],
    ['missing OTP secret', { AUTH_OTP_SECRET: undefined }, 'AUTH_OTP_SECRET must contain'],
    ['shared secrets', { AUTH_OTP_SECRET: good.JWT_SECRET }, 'must differ'],
    ['development sign-in code', { AUTH_DEV_OTP_ENABLED: 'true' }, 'AUTH_DEV_OTP_ENABLED'],
    ['local database password', { DATABASE_PASSWORD: 'hodhod_local_only' }, 'local development password'],
    ['weak database password', { DATABASE_PASSWORD: 'short' }, 'at least 16'],
    ['missing database host', { DATABASE_HOST: undefined }, 'DATABASE_HOST is required'],
    ['no mail server', { SMTP_HOST: undefined }, 'SMTP_HOST is required'],
    ['insecure local mail', { SMTP_ALLOW_INSECURE_LOCAL: 'true' }, 'SMTP_ALLOW_INSECURE_LOCAL'],
    ['half SMTP login', { SMTP_USER: 'user' }, 'together'],
    ['malformed reward table', { SCORING_STAR_POINTS: '0;x' }, 'malformed'],
  ])('rejects %s', (_name, override, expected) => {
    const problems = productionConfigProblems({ ...good, ...override } as NodeJS.ProcessEnv);
    expect(problems.some(problem => problem.includes(expected))).toBe(true);
  });

  it('never prints secret values', () => {
    const text = productionConfigProblems({ ...good, JWT_SECRET: 'super-secret-value', DATABASE_PASSWORD: 'hodhod_local_only' }).join('\n');
    expect(text).not.toContain('super-secret-value');
    expect(text).not.toContain('hodhod_local_only'.repeat(2));
  });
});

describe('request log', () => {
  it('logs method, path and status without query strings or credentials, and sets a request id', () => {
    const lines: string[] = [];
    const spy = jest.spyOn(require('@nestjs/common').Logger.prototype, 'log').mockImplementation((message: unknown) => { lines.push(String(message)); });
    let finish = () => undefined as void;
    const headers: Record<string, string> = {};
    const res = { statusCode: 200, setHeader: (k: string, v: string) => { headers[k] = v; }, on: (_e: 'finish', fn: () => void) => { finish = fn; } };
    requestLog({ method: 'GET', url: '/classes/mine?token=secret&email=a@b.c', headers: { authorization: 'Bearer top-secret', 'x-request-id': 'bad id\nforged' } }, res, () => undefined);
    finish();
    spy.mockRestore();
    expect(headers['X-Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ method: 'GET', path: '/classes/mine', status: 200 });
    expect(lines[0]).not.toMatch(/secret|a@b\.c|forged/);
  });
});

describe('health checks', () => {
  it('reports ready only when the database answers', async () => {
    await expect(new HealthController({ query: async () => [{}] } as never).ready()).resolves.toEqual({ status: 'ready' });
    await expect(new HealthController({ query: async () => { throw new Error('down'); } } as never).ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(new HealthController({} as never).health()).toEqual({ status: 'ok' });
  });
});

describe('deployment files keep PostgreSQL private', () => {
  const service = (file: string, name: string) => {
    const text = readFileSync(join(__dirname, '..', file), 'utf8').replace(/\r/g, '');
    const start = text.indexOf(`\n  ${name}:`);
    const rest = text.slice(start + 1);
    const next = rest.slice(1).search(/\n  \w[\w-]*:/);
    return next === -1 ? rest : rest.slice(0, next + 1);
  };

  it('publishes no PostgreSQL port in the production stack', () => {
    expect(service('compose.prod.yaml', 'postgres')).not.toMatch(/ports:/);
  });

  it('binds the API only to the loopback address for the reverse proxy', () => {
    expect(service('compose.prod.yaml', 'api')).toMatch(/"127\.0\.0\.1:/);
    expect(service('compose.prod.yaml', 'api')).not.toMatch(/"0\.0\.0\.0:|- "?\d+:\d+/);
  });

  it('binds the development database to loopback only', () => {
    expect(service('compose.yaml', 'postgres')).toMatch(/"127\.0\.0\.1:\d+:5432"/);
  });

  it('keeps secrets out of the image and repository', () => {
    const ignore = readFileSync(join(__dirname, '..', '.dockerignore'), 'utf8');
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    const git = readFileSync(join(__dirname, '..', '.gitignore'), 'utf8');
    expect(git).toMatch(/^\.env\.\*$/m);
  });
});
