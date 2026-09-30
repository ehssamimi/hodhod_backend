import 'dotenv/config';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { assertProductionConfig } from './config/production-config';
import { requestLog } from './config/request-log';
import { setupSwagger, docsPolicy } from './swagger';
import { audienceModules } from './swagger-modules';

async function bootstrap() {
  assertProductionConfig();
  const app = await NestFactory.create(AppModule);
  // Behind a reverse proxy, set TRUST_PROXY (for example "1") so rate limits see the client address.
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.getHttpAdapter().getInstance().set('trust proxy', Number.isInteger(hops) ? hops : process.env.TRUST_PROXY);
  }
  app.use(requestLog);
  app.enableShutdownHooks();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const docs = docsPolicy();
  if (docs.enabled) setupSwagger(app, audienceModules(), docs.guard);
  else new Logger('Docs').log('API documentation pages are disabled: ' + docs.reason);

  await app.listen(
    Number(process.env.PORT ?? 3000),
    process.env.HOST ?? (process.env.NODE_ENV === 'development' ? '127.0.0.1' : '0.0.0.0'),
  );
}

void bootstrap();
