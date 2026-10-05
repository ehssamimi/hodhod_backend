import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { profileOf } from '../users/user.dto';
import { positiveSetting } from './auth.config';
import { OtpService } from './otp.service';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
    private readonly passwords: PasswordService,
  ) {}

  requestCode(email: string, ip: string) { return this.otp.requestCode(email.trim().toLowerCase(), ip); }

  async requestRoleCode(email: string, ip: string, role: User['role']) {
    const normalizedEmail = email.trim().toLowerCase();
    const account = await this.users.findOneBy({ email: normalizedEmail });
    const deliver = account ? account.role === role : role === 'student';
    return this.otp.requestCode(normalizedEmail, ip, 'sign-in', deliver);
  }

  private async issueSession(manager: EntityManager, user: User) {
    const lifetime = positiveSetting('AUTH_SESSION_TTL_SECONDS', 604800, 2592000);
    const sessions: Array<{ id: string; expires_at: Date }> = await manager.query(`
      INSERT INTO auth_sessions(user_id,auth_version,expires_at) VALUES ($1,$2,now()+$3*interval '1 second') RETURNING id,expires_at
    `, [user.id,user.authVersion,lifetime]);
    return this.jwt.signAsync({ sub: user.id, ver: user.authVersion, sid: sessions[0].id,
      exp: Math.floor(sessions[0].expires_at.getTime()/1000) });
  }

  async verifyCode(email: string, code: string, ip = 'internal') {
    return this.verifyCodeForRole(email, code, ip);
  }

  async verifyCodeForRole(email: string, code: string, ip: string, expectedRole?: User['role']) {
    const normalizedEmail = email.trim().toLowerCase();
    await this.otp.limitVerification(normalizedEmail, ip);
    const result = await this.users.manager.transaction(async manager => {
      // A failed guess must commit its attempt counter; throw only after commit.
      if (!await this.otp.consume(manager,normalizedEmail,code)) return null;
      const inserted: Array<{ id: string }> = !expectedRole || expectedRole === 'student' ? await manager.query(
        'INSERT INTO users(email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING id', [normalizedEmail],
      ) : [];
      const user = await manager.getRepository(User).findOne({
        where: { email: normalizedEmail }, lock: { mode: 'pessimistic_read' },
      });
      if (!user || expectedRole && user.role !== expectedRole) return null;
      if (user.role === 'student' || user.role === 'teacher') {
        const table = user.role === 'student' ? 'student_profiles' : 'teacher_profiles';
        await manager.query('INSERT INTO ' + table + '(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
      }
      return {
        accessToken: await this.issueSession(manager, user),
        user: profileOf(user),
        isNewUser: inserted.length === 1,
      };
    });
    if (!result) throw new UnauthorizedException('Invalid or expired verification code');
    return result;
  }

  async loginWithPassword(email: string, password: string, ip: string, role: User['role']) {
    const normalizedEmail = email.trim().toLowerCase();
    await this.otp.limitPasswordLogin(normalizedEmail, ip);
    const result = await this.users.manager.transaction(async manager => {
      const user = await manager.getRepository(User).createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.email = :email AND user.role = :role', { email: normalizedEmail, role })
        .setLock('pessimistic_read').getOne();
      if (!await this.passwords.verify(password, user?.passwordHash)) return null;
      return {
        accessToken: await this.issueSession(manager, user!),
        user: profileOf(user!),
        isNewUser: false,
      };
    });
    if (!result) throw new UnauthorizedException('Invalid email or password');
    return result;
  }

  async setPassword(user: User, newPassword: string): Promise<void> {
    const hash = await this.passwords.hash(newPassword);
    await this.users.manager.transaction(async manager => {
      const current = await manager.getRepository(User).createQueryBuilder('user').addSelect('user.passwordHash')
        .where('user.id = :id', { id: user.id }).setLock('pessimistic_write').getOne();
      if (!current || current.authVersion !== user.authVersion || current.role !== user.role) {
        throw new UnauthorizedException('Session revoked');
      }
      if (current.passwordHash) throw new ConflictException('Password is already set; use change password');
      await this.replacePassword(manager, current, hash);
    });
  }

  async changePassword(user: User, currentPassword: string, newPassword: string): Promise<void> {
    const hash = await this.passwords.hash(newPassword);
    await this.users.manager.transaction(async manager => {
      const current = await manager.getRepository(User).createQueryBuilder('user').addSelect('user.passwordHash')
        .where('user.id = :id', { id: user.id }).setLock('pessimistic_write').getOne();
      if (!current || current.authVersion !== user.authVersion || current.role !== user.role) {
        throw new UnauthorizedException('Session revoked');
      }
      if (!current.passwordHash || !await this.passwords.verify(currentPassword, current.passwordHash)) {
        throw new UnauthorizedException('Current password is incorrect');
      }
      await this.replacePassword(manager, current, hash);
    });
  }

  async requestPasswordReset(email: string, ip: string, role: User['role']) {
    const normalizedEmail = email.trim().toLowerCase();
    const deliver = await this.users.existsBy({ email: normalizedEmail, role });
    return this.otp.requestCode(normalizedEmail, ip, 'password-reset', deliver);
  }

  async resetPassword(email: string, code: string, newPassword: string, ip: string, role: User['role']): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    await this.otp.limitVerification(normalizedEmail, ip, 'password-reset');
    const hash = await this.passwords.hash(newPassword);
    const reset = await this.users.manager.transaction(async manager => {
      if (!await this.otp.consume(manager, normalizedEmail, code, 'password-reset')) return false;
      const current = await manager.getRepository(User).createQueryBuilder('user')
        .where('user.email = :email AND user.role = :role', { email: normalizedEmail, role })
        .setLock('pessimistic_write').getOne();
      if (!current) return false;
      await this.replacePassword(manager, current, hash);
      return true;
    });
    if (!reset) throw new UnauthorizedException('Invalid or expired verification code');
  }

  private async replacePassword(manager: EntityManager, user: User, hash: string): Promise<void> {
    await manager.query('UPDATE users SET password_hash=$1,auth_version=auth_version+1 WHERE id=$2', [hash,user.id]);
    await manager.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [user.id]);
  }

  async logout(user: User, sessionId: string): Promise<void> {
    await this.users.manager.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL', [sessionId,user.id]);
  }

  async logoutAll(user: User): Promise<void> {
    await this.users.manager.transaction(async manager => {
      await manager.query('UPDATE users SET auth_version=auth_version+1 WHERE id=$1', [user.id]);
      await manager.query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [user.id]);
    });
  }
}
