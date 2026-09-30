import { ClassesModule } from './classes/classes.module';
import { StudentClassesModule } from './classes/student-classes.module';
import { StudentContentModule, TeacherContentModule } from './content/content.module';
import { StudentAdventureModule } from './adventure/adventure.module';
import { AdminContentModule } from './admin-content/admin-content.module';
import { TeacherAssignmentsModule } from './assignments/assignments.module';
import { StudentAssignmentsModule } from './assignments/student-assignments.module';
import { AttemptsModule } from './attempts/attempts.module';
import { StudentFeedbackModule, TeacherFeedbackModule, AdminFeedbackModule } from './feedback/feedback.module';
import { TeacherReportsModule } from './reports/reports.module';
import { AdminSuspiciousModule } from './attempts/suspicious.module';
import 'dotenv/config';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthModule } from './auth/auth.module';
import { StudentProfileModule } from './users/student-profile.module';
import { ProfileModule } from './users/profile.module';
import { AdminUsersModule } from './users/admin-users.module';
import { setupSwagger } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  if (process.env.NODE_ENV === 'development') {
    // Add each future feature module only to its audience's list.
    const sharedModules = [AppModule, AuthModule, ProfileModule];
    setupSwagger(app, {
      student: [...sharedModules, StudentProfileModule, StudentClassesModule, StudentContentModule, StudentAdventureModule, StudentAssignmentsModule, AttemptsModule, StudentFeedbackModule],
      teacher: [...sharedModules, ClassesModule, TeacherContentModule, TeacherAssignmentsModule, TeacherFeedbackModule, TeacherReportsModule],
      admin: [...sharedModules, AdminUsersModule, AdminContentModule, AdminFeedbackModule, AdminSuspiciousModule],
    });
  }

  await app.listen(
    Number(process.env.PORT ?? 3000),
    process.env.HOST ?? (process.env.NODE_ENV === 'development' ? '127.0.0.1' : '0.0.0.0'),
  );
}

void bootstrap();
