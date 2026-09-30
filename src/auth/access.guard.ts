import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUUID } from 'class-validator';
import { User } from '../users/user.entity';
import { PUBLIC_ROUTE, REQUIRED_ROLES } from './security';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; user: User; sessionId: string }>();
    const match = /^Bearer ([^ ]+)$/i.exec(request.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Bearer token required');
    let payload: { sub?: unknown; ver?: unknown; exp?: unknown; sid?: unknown };
    try {
      payload = await this.jwt.verifyAsync(match[1], { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!payload || typeof payload.sid !== 'string' || !isUUID(payload.sid) || typeof payload.sub !== 'string' || !isUUID(payload.sub) ||
        !Number.isInteger(payload.ver) || typeof payload.exp !== 'number') {
      throw new UnauthorizedException('Invalid token claims');
    }
    const user = await this.users.findOneBy({ id: payload.sub });
    if (!user || user.authVersion !== payload.ver) throw new UnauthorizedException('Session revoked');
    const sessions: Array<{ valid: boolean }> = await this.users.manager.query(
      'SELECT EXISTS (SELECT 1 FROM auth_sessions WHERE id=$1 AND user_id=$2 AND auth_version=$3 AND revoked_at IS NULL AND expires_at > now()) AS valid',
      [payload.sid,user.id,user.authVersion],
    );
    if (!sessions[0].valid) throw new UnauthorizedException('Session revoked or expired');
    request.sessionId = payload.sid;
    const roles = this.reflector.getAllAndOverride<Array<User['role']>>(REQUIRED_ROLES, targets);
    if (roles && !roles.includes(user.role)) throw new ForbiddenException('Role is not allowed');
    request.user = user;
    return true;
  }
}
