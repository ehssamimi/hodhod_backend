import 'dotenv/config';
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger, docsPolicy } from './swagger';
import { audienceModules } from './swagger-modules';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
