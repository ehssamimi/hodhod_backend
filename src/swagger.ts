import { INestApplication, Type } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createHash, timingSafeEqual } from 'node:crypto';

type Audience = 'student' | 'teacher' | 'admin';
type Middleware = (req: { headers: Record<string, string | string[] | undefined> }, res: { setHeader(name: string, value: string): void; status(code: number): { send(body: string): void } }, next: () => void) => void;

const digest = (value: string) => createHash('sha256').update(value).digest();

// HTTP Basic protection for the documentation pages outside development. Documentation never
// replaces API authorization; it only limits who can read the contract.
export function docsBasicAuth(user: string, password: string): Middleware {
  const expected = [digest(user), digest(password)];
  return (req, res, next) => {
    const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(String(req.headers.authorization ?? ''));
    if (match) {
      const [name, ...rest] = Buffer.from(match[1], 'base64').toString('utf8').split(':');
      if (timingSafeEqual(digest(name), expected[0]) && timingSafeEqual(digest(rest.join(':')), expected[1])) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Hodhod API docs"');
    res.status(401).send('Authentication required');
  };
}

// Development: open on localhost. Elsewhere: off unless DOCS_ENABLED=true, and then only with
// DOCS_USER / DOCS_PASSWORD (at least 16 characters); otherwise the pages stay disabled.
export function docsPolicy(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; guard?: Middleware; reason?: string } {
  if (env.NODE_ENV === 'development') return { enabled: true };
  if (env.DOCS_ENABLED !== 'true') return { enabled: false, reason: 'DOCS_ENABLED is not true' };
  if (!env.DOCS_USER || !env.DOCS_PASSWORD || env.DOCS_PASSWORD.length < 16) {
    return { enabled: false, reason: 'DOCS_USER and a DOCS_PASSWORD of at least 16 characters are required' };
  }
  return { enabled: true, guard: docsBasicAuth(env.DOCS_USER, env.DOCS_PASSWORD) };
}

export function setupSwagger(
  app: INestApplication,
  modulesByAudience: Record<Audience, Array<Type<unknown>>>,
  guard?: Middleware,
) {
  if (guard) app.use('/docs', guard);
  for (const audience of ['student', 'teacher', 'admin'] as const) {
    const config = new DocumentBuilder()
      .setTitle(`Hodhod ${audience} API`)
      .setDescription('Implemented endpoints only. Email sign-in and revocable Bearer sessions.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();

    SwaggerModule.setup(
      `docs/${audience}`,
      app,
      () => SwaggerModule.createDocument(app, config, {
        include: modulesByAudience[audience],
      }),
      { jsonDocumentUrl: `/docs/${audience}/openapi.json` },
    );
  }
}
