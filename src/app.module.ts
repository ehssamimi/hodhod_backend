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
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { StudentProfileModule } from './users/student-profile.module';
import { ProfileModule } from './users/profile.module';
import { AdminUsersModule } from './users/admin-users.module';
import { databaseOptions } from './database/data-source';

@Module({
  imports: [TypeOrmModule.forRoot(databaseOptions()), AuthModule, ProfileModule, AdminUsersModule, StudentProfileModule, ClassesModule, StudentClassesModule, StudentContentModule, TeacherContentModule, StudentAdventureModule, AdminContentModule, TeacherAssignmentsModule, StudentAssignmentsModule, AttemptsModule, StudentFeedbackModule, TeacherFeedbackModule, AdminFeedbackModule, TeacherReportsModule, AdminSuspiciousModule],
  controllers: [HealthController],
})
export class AppModule {}
