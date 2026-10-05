import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ListUsersQueryDto, ProfileDto, UserListDto } from './user.dto';

@Injectable()
export class AdminUsersService {
  constructor(private readonly source: DataSource) {}

  async get(id: string): Promise<ProfileDto> {
    const rows = await this.source.query(`SELECT u.id, u.email, u.role,
        u.display_name AS "displayName", u.avatar_id AS "avatarId", u.timezone, u."createdAt"
      FROM users u WHERE u.id=$1`, [id]);
    if (!rows.length) throw new NotFoundException('User not found');
    return rows[0];
  }

  async list(query: ListUsersQueryDto): Promise<UserListDto> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.role) {
      params.push(query.role);
      where.push(`u.role=$${params.length}`);
    }
    if (query.search) {
      // Treat %, _ and backslash as text so a search cannot unexpectedly become a wildcard query.
      const search = query.search.trim().replace(/[\\%_]/g, value => '\\' + value);
      params.push('%' + search + '%');
      where.push(`(u.email ILIKE $${params.length} ESCAPE '\\' OR u.display_name ILIKE $${params.length} ESCAPE '\\')`);
    }
    const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const total = (await this.source.query(`SELECT count(*)::int AS n FROM users u${clause}`, params))[0].n as number;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const pageParams = [...params, limit, offset];
    const items = await this.source.query(`SELECT u.id, u.email, u.role,
        u.display_name AS "displayName", u.avatar_id AS "avatarId", u.timezone, u."createdAt"
      FROM users u${clause}
      ORDER BY u."createdAt" DESC, u.id
      LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`, pageParams);
    return { items, total, limit, offset };
  }
}
