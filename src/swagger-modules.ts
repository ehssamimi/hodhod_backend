import { Type } from '@nestjs/common';
import { AdminContentModule } from './admin-content/admin-content.module';
import { AdminOverviewModule } from './admin-overview/admin-overview.module';
import { StudentAdventureModule } from './adventure/adventure.module';
import { TeacherAssignmentsModule } from './assignments/assignments.module';
import { StudentAssignmentsModule } from './assignments/student-assignments.module';
import { AttemptsModule } from './attempts/attempts.module';
import { StudentStreakModule } from './attempts/streak.module';
import { AdminSuspiciousModule } from './attempts/suspicious.module';
import { AppModule } from './app.module';
import { AuthModule } from './auth/auth.module';
import { AdminAuthModule, StudentAuthModule, TeacherAuthModule } from './auth/role-auth.module';
import { ClassesModule } from './classes/classes.module';
import { StudentClassesModule } from './classes/student-classes.module';
import { StudentContentModule, TeacherContentModule } from './content/content.module';
import { AdminFeedbackModule, StudentFeedbackModule, TeacherFeedbackModule } from './feedback/feedback.module';
import { StudentLeaderboardsModule } from './leaderboards/leaderboards.module';
import { TeacherReportsModule } from './reports/reports.module';
import { AdminUsersModule } from './users/admin-users.module';
import { ProfileModule } from './users/profile.module';
import { StudentProfileModule } from './users/student-profile.module';

// The single list of which module documents itself on which audience's Swagger page.
// Add every new feature module here, in its own audience only.
export function audienceModules(): Record<'student' | 'teacher' | 'admin', Array<Type<unknown>>> {
  const shared = [AppModule, AuthModule, ProfileModule];
  return {
    student: [...shared, StudentAuthModule, StudentProfileModule, StudentClassesModule, StudentContentModule, StudentAdventureModule, StudentAssignmentsModule, AttemptsModule,
      StudentFeedbackModule, StudentStreakModule, StudentLeaderboardsModule],
    teacher: [...shared, TeacherAuthModule, ClassesModule, TeacherContentModule, TeacherAssignmentsModule, TeacherFeedbackModule, TeacherReportsModule],
    admin: [...shared, AdminAuthModule, AdminUsersModule, AdminContentModule, AdminFeedbackModule, AdminSuspiciousModule, AdminOverviewModule],
  };
}
