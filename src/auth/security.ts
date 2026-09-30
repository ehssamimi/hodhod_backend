import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { User } from '../users/user.entity';

export const PUBLIC_ROUTE = 'publicRoute';
export const REQUIRED_ROLES = 'requiredRoles';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: Array<User['role']>) => SetMetadata(REQUIRED_ROLES, roles);
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User =>
  ctx.switchToHttp().getRequest<{ user: User }>().user,
);
