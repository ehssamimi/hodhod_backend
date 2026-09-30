import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/user.entity';
import { ClassDto } from './classes.dto';

const projection = `id, teacher_id AS "teacherId", name, status, CASE WHEN status='active' THEN join_code ELSE NULL END AS "joinCode", created_at AS "createdAt", archived_at AS "archivedAt"`;

@Injectable()
export class ClassesService {
  constructor(private readonly source: DataSource) {}

  private async authorized<T>(actor: User, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    // Lock the role until commit so an admin role change cannot race a class mutation.
    return this.source.transaction(async manager => {
      const user = await manager.getRepository(User).findOne({ where: { id: actor.id }, lock: { mode: 'pessimistic_read' } });
      if (!user || user.authVersion !== actor.authVersion) throw new UnauthorizedException('Session revoked');
      if (user.role !== 'teacher') throw new ForbiddenException('Teacher role required');
      return work(manager);
    });
  }

  private async withUniqueCode<T>(work: (code: string) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await work(randomBytes(8).toString('hex').toUpperCase()); }
      catch (error) {
        const failure = error as { code?: string; constraint?: string };
        if (failure.code !== '23505' || failure.constraint !== 'classes_join_code_key') throw error;
      }
    }
    throw new ConflictException('Could not allocate a join code; retry');
  }

  create(actor: User, name: string): Promise<ClassDto> {
    return this.withUniqueCode(code => this.authorized(actor, async manager => {
      const rows = await manager.query('INSERT INTO classes(teacher_id,name,join_code) VALUES ($1,$2,$3) RETURNING ' + projection, [actor.id, name, code]);
      return rows[0];
    }));
  }

  list(actor: User): Promise<ClassDto[]> {
    return this.authorized(actor, manager => manager.query('SELECT ' + projection + ' FROM classes WHERE teacher_id=$1 ORDER BY created_at DESC,id', [actor.id]));
  }

  get(actor: User, id: string): Promise<ClassDto> {
    return this.authorized(actor, async manager => {
      const rows = await manager.query('SELECT ' + projection + ' FROM classes WHERE id=$1 AND teacher_id=$2', [id, actor.id]);
      if (!rows.length) throw new NotFoundException('Class not found');
      return rows[0];
    });
  }

  private mutate(actor: User, id: string, code?: string): Promise<ClassDto> {
    return this.authorized(actor, async manager => {
      const rows = await manager.query('SELECT status,join_code FROM classes WHERE id=$1 AND teacher_id=$2 FOR UPDATE', [id, actor.id]);
      if (!rows.length) throw new NotFoundException('Class not found');
      if (code !== undefined) {
        if (rows[0].status !== 'active') throw new ConflictException('Class is archived');
        if (rows[0].join_code === code) throw new ConflictException('Please retry code rotation');
        return (await manager.query('UPDATE classes SET join_code=$3 WHERE id=$1 AND teacher_id=$2 RETURNING ' + projection, [id, actor.id, code]))[0][0];
      }
      // End open memberships in the same transaction; keep every history row.
      // Join holds a shared class lock, so no student can join during archive.
      await manager.query('UPDATE class_memberships SET ended_at=clock_timestamp() WHERE class_id=$1 AND ended_at IS NULL', [id]);
      return (await manager.query("UPDATE classes SET status='archived',archived_at=COALESCE(archived_at,clock_timestamp()) WHERE id=$1 AND teacher_id=$2 RETURNING " + projection, [id, actor.id]))[0][0];
    });
  }

  archive(actor: User, id: string) { return this.mutate(actor, id); }
  rotateCode(actor: User, id: string) { return this.withUniqueCode(code => this.mutate(actor, id, code)); }
}
