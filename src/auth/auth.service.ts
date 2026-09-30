import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { profileOf } from '../users/user.dto';
import { positiveSetting } from './auth.config';
import { OtpService } from './otp.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
  ) {}

  requestCode(email: string, ip: string) { return this.otp.requestCode(email.trim().toLowerCase(), ip); }

  async verifyCode(email: string, code: string, ip = 'internal') {
    const normalizedEmail = email.trim().toLowerCase();
    await this.otp.limitVerification(normalizedEmail, ip);
    const result = await this.users.manager.transaction(async manager => {
      // A failed guess must commit its attempt counter; throw only after commit.
      if (!await this.otp.consume(manager,normalizedEmail,code)) return null;
      const inserted: Array<{ id: string }> = await manager.query(
        'INSERT INTO users(email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING id', [normalizedEmail],
      );
      const user = await manager.getRepository(User).findOneOrFail({
        where: { email: normalizedEmail }, lock: { mode: 'pessimistic_read' },
      });
      if (user.role === 'student' || user.role === 'teacher') {
        const table = user.role === 'student' ? 'student_profiles' : 'teacher_profiles';
        await manager.query('INSERT INTO ' + table + '(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
      }
      const lifetime = positiveSetting('AUTH_SESSION_TTL_SECONDS', 604800, 2592000);
      const sessions: Array<{ id: string; expires_at: Date }> = await manager.query(`
        INSERT INTO auth_sessions(user_id,auth_version,expires_at) VALUES ($1,$2,now()+$3*interval '1 second') RETURNING id,expires_at
      `, [user.id,user.authVersion,lifetime]);
      return {
        accessToken: await this.jwt.signAsync({ sub: user.id, ver: user.authVersion, sid: sessions[0].id,
          exp: Math.floor(sessions[0].expires_at.getTime()/1000) }),
        user: profileOf(user),
        isNewUser: inserted.length === 1,
      };
    });
    if (!result) throw new UnauthorizedException('Invalid or expired verification code');
    return result;
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
