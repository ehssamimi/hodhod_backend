import { INestApplication, Type } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

type Audience = 'student' | 'teacher' | 'admin';

export function setupSwagger(
  app: INestApplication,
  modulesByAudience: Record<Audience, Array<Type<unknown>>>,
) {
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
