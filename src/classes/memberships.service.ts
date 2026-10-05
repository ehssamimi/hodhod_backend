import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/user.entity';
import { ClassMemberDto, CurrentMembershipDto, MembershipDto } from './memberships.dto';

const projection = `m.id, m.class_id AS "classId", c.name AS "className",
  m.student_id AS "studentId", m.joined_at AS "joinedAt", m.ended_at AS "endedAt"`;

@Injectable()
export class MembershipsService {
  constructor(private readonly source: DataSource) {}

  private authorized<T>(actor: User, role: 'student' | 'teacher', work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction(async manager => {
      const user = await manager.getRepository(User).findOne({ where: { id: actor.id }, lock: { mode: 'pessimistic_read' } });
      if (!user || user.authVersion !== actor.authVersion) throw new UnauthorizedException('Session revoked');
      if (user.role !== role) throw new ForbiddenException(`${role} role required`);
      return work(manager);
    });
  }

  private async lockStudent(manager: EntityManager, studentId: string): Promise<void> {
    // Also serializes the first join, when no membership row exists to lock.
    // Always acquire this before class locks. Archive never takes this lock.
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1790553606))', [studentId.toLowerCase()]);
  }

  private async current(manager: EntityManager, studentId: string): Promise<CurrentMembershipDto> {
    const rows = await manager.query(`SELECT ${projection} FROM class_memberships m
      JOIN classes c ON c.id=m.class_id
      WHERE m.student_id=$1 AND m.ended_at IS NULL AND c.status='active'`, [studentId]);
    return { membership: rows[0] ?? null };
  }

  mine(actor: User): Promise<CurrentMembershipDto> {
    return this.authorized(actor, 'student', manager => this.current(manager, actor.id));
  }

  history(actor: User): Promise<MembershipDto[]> {
    return this.authorized(actor, 'student', manager => manager.query(`SELECT ${projection}
      FROM class_memberships m JOIN classes c ON c.id=m.class_id
      WHERE m.student_id=$1 ORDER BY m.joined_at DESC,m.id`, [actor.id]));
  }

  join(actor: User, code: string): Promise<CurrentMembershipDto> {
    return this.authorized(actor, 'student', async manager => {
      await this.lockStudent(manager, actor.id);
      // Keep the target active and its code valid until the membership commits.
      const classes = await manager.query("SELECT id FROM classes WHERE join_code=$1 AND status='active' FOR SHARE", [code]);
      if (!classes.length) throw new NotFoundException('Active class code not found');
      const classId = classes[0].id;
      const existing = await this.current(manager, actor.id);
      if (existing.membership?.classId === classId) return existing;
      // clock_timestamp (not transaction-start now()) remains ordered after lock waits.
      await manager.query('UPDATE class_memberships SET ended_at=clock_timestamp() WHERE student_id=$1 AND ended_at IS NULL', [actor.id]);
      await manager.query('INSERT INTO class_memberships(class_id,student_id,joined_at) VALUES ($1,$2,clock_timestamp())', [classId, actor.id]);
      await manager.query(`INSERT INTO assignment_recipients(assignment_id,student_id)
        SELECT a.id,$2 FROM assignments a
        WHERE a.class_id=$1 AND a.audience='whole_class' AND a.status='scheduled'
          AND a.ends_at>clock_timestamp()
        ON CONFLICT DO NOTHING`, [classId, actor.id]);
      return this.current(manager, actor.id);
    });
  }

  leave(actor: User): Promise<CurrentMembershipDto> {
    return this.authorized(actor, 'student', async manager => {
      await this.lockStudent(manager, actor.id);
      await manager.query('UPDATE class_memberships SET ended_at=clock_timestamp() WHERE student_id=$1 AND ended_at IS NULL', [actor.id]);
      return { membership: null };
    });
  }

  private async ownedClass(manager: EntityManager, actor: User, classId: string): Promise<void> {
    const rows = await manager.query('SELECT id FROM classes WHERE id=$1 AND teacher_id=$2 FOR SHARE', [classId, actor.id]);
    if (!rows.length) throw new NotFoundException('Class not found');
  }

  members(actor: User, classId: string): Promise<ClassMemberDto[]> {
    return this.authorized(actor, 'teacher', async manager => {
      await this.ownedClass(manager, actor, classId);
      return manager.query(`SELECT ${projection}, u.display_name AS "displayName" FROM class_memberships m
        JOIN classes c ON c.id=m.class_id JOIN users u ON u.id=m.student_id
        WHERE m.class_id=$1 AND m.ended_at IS NULL AND c.status='active' ORDER BY m.joined_at,m.id`, [classId]);
    });
  }

  remove(actor: User, classId: string, studentId: string): Promise<{ removed: boolean }> {
    return this.authorized(actor, 'teacher', async manager => {
      await this.lockStudent(manager, studentId);
      await this.ownedClass(manager, actor, classId);
      // Scope to this class: a former teacher cannot end a subsequent membership.
      const rows = await manager.query(`UPDATE class_memberships SET ended_at=clock_timestamp()
        WHERE class_id=$1 AND student_id=$2 AND ended_at IS NULL RETURNING id`, [classId, studentId]);
      return { removed: rows[0].length > 0 };
    });
  }
}
