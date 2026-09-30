import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';
import { setupSwagger } from './swagger';

@Module({
  controllers: [AuthController, HealthController],
  providers: [{ provide: AuthService, useValue: {} }, { provide: DataSource, useValue: {} }],
})
class TestApiModule {}

describe('Swagger documents', () => {
  it('serves the implemented routes and request/response schemas in all three audiences', async () => {
    const testingModule = await Test.createTestingModule({
      imports: [TestApiModule],
    }).compile();
    const app = testingModule.createNestApplication();
    setupSwagger(app, {
      student: [TestApiModule],
      teacher: [TestApiModule],
      admin: [TestApiModule],
    });

    try {
      await app.listen(0, '127.0.0.1');
      const address = app.getHttpServer().address() as { port: number };
      for (const audience of ['student', 'teacher', 'admin']) {
        const ui = await fetch(`http://127.0.0.1:${address.port}/docs/${audience}`);
        expect(ui.status).toBe(200);
        const response = await fetch(
          `http://127.0.0.1:${address.port}/docs/${audience}/openapi.json`,
        );
        expect(response.status).toBe(200);
        const document = (await response.json()) as {
          info: { title: string };
          paths: Record<string, unknown>;
          components: { schemas: Record<string, unknown> };
        };
        expect(document.info.title).toBe(`Hodhod ${audience} API`);
        expect(Object.keys(document.paths).sort()).toEqual([
          '/auth/logout',
          '/auth/logout-all',
          '/auth/request-code',
          '/auth/verify-code',
          '/health',
          '/health/ready',
        ]);
        expect(document.components.schemas.EmailDto).toBeDefined();
        expect(document.components.schemas.VerifyCodeDto).toBeDefined();
        expect(document.components.schemas.VerifyCodeResponseDto).toBeDefined();
      }
    } finally {
      await app.close();
    }
  });
});
