import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/user.entity';

/** Reuse in class feature services; never accept a caller-supplied identity/role. */
@Injectable()
export class ClassAccessService {
  constructor(private readonly dataSource: DataSource) {}

  async requireClassAccess(user: User, classId: string): Promise<void> {
    const rows: Array<{ allowed: boolean }> = await this.dataSource.query(`
      SELECT EXISTS (
        SELECT 1 FROM classes c JOIN users u ON u.id = $1
        WHERE c.id = $2 AND u.auth_version = $3 AND (
          u.role = 'admin' OR (u.role = 'teacher' AND c.teacher_id = u.id) OR
          (u.role = 'student' AND c.status = 'active' AND EXISTS (
            SELECT 1 FROM class_memberships m WHERE m.class_id = c.id
              AND m.student_id = u.id AND m.ended_at IS NULL
          ))
        )
      ) AS allowed
    `, [user.id,classId,user.authVersion]);
    if (!rows[0].allowed) throw new ForbiddenException('Class access denied');
  }
}
