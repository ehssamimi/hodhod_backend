import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User } from './user.entity';
import { ChangeRoleDto, profileOf } from './user.dto';

// All role writes, including the one-time bootstrap, use this transaction lock.
export async function lockRoleChanges(manager: EntityManager): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(17905536, 2)');
}

@Injectable()
export class RoleService {
  constructor(private readonly dataSource: DataSource) {}

  async changeRole(actor: User, targetId: string, input: ChangeRoleDto) {
    return this.dataSource.transaction(async manager => {
      await lockRoleChanges(manager);
      const users = manager.getRepository(User);
      // A stable lock order also handles self-demotion without deadlocks.
      const locked = await users.createQueryBuilder('u')
        .where('u.id IN (:...ids)', { ids: [...new Set([actor.id, targetId])] })
        .orderBy('u.id').setLock('pessimistic_write').getMany();
      const currentActor = locked.find(user => user.id === actor.id);
      if (!currentActor || currentActor.authVersion !== actor.authVersion) {
        throw new UnauthorizedException('Session revoked');
      }
      if (currentActor.role !== 'admin') throw new ForbiddenException('Admin role required');
      const target = locked.find(user => user.id === targetId);
      if (!target) throw new NotFoundException('User not found');
      if (target.role === input.role) return profileOf(target);
      if (target.role === 'admin' && await users.countBy({ role: 'admin' }) <= 1) {
        throw new ConflictException('Cannot demote the last admin');
      }
      const previousRole = target.role;
      target.role = input.role;
      target.authVersion += 1;
      await users.save(target);
      if (input.role === 'student' || input.role === 'teacher') {
        const table = input.role === 'student' ? 'student_profiles' : 'teacher_profiles';
        await manager.query('INSERT INTO ' + table + '(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [target.id]);
      }
      await manager.query(`INSERT INTO role_change_audit(user_id,actor_id,previous_role,new_role,reason)
        VALUES ($1,$2,$3,$4,$5)`, [target.id,currentActor.id,previousRole,input.role,input.reason ?? null]);
      return profileOf(target);
    });
  }
}
