import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ContentDto, ListContentDto } from './content.dto';

type Kind = 'adventure' | 'practice';

// Only published items with a released version are visible. The latest released
// version supplies the Unity ID, so drafts and future versions never leak.
const select = `SELECT c.id, c.title, c.subject, c.grade, c.kind, v.unity_id AS "unityId", v.version, v.published_at AS "publishedAt"
  FROM content_items c
  JOIN LATERAL (
    SELECT version, unity_id, published_at FROM content_versions
    WHERE content_id=c.id AND published_at IS NOT NULL AND published_at<=now()
    ORDER BY version DESC LIMIT 1
  ) v ON true
  WHERE c.status='published'`;

@Injectable()
export class ContentService {
  constructor(private readonly source: DataSource) {}

  private kinds(kind: Kind): string[] { return [kind, 'both']; }

  async list(kind: Kind | undefined, query: ListContentDto, fixed?: Kind): Promise<ContentDto[]> {
    const params: unknown[] = [];
    let sql = select;
    const wanted = fixed ?? kind;
    if (wanted) { params.push(this.kinds(wanted)); sql += ` AND c.kind = ANY($${params.length})`; }
    if (query.subject) { params.push(query.subject); sql += ` AND c.subject=$${params.length}`; }
    if (query.q) {
      params.push('%' + query.q.replace(/[\\%_]/g, '\\$&') + '%');
      sql += ` AND c.title ILIKE $${params.length} ESCAPE '\\'`;
    }
    params.push(query.limit ?? 50, query.offset ?? 0);
    sql += ` ORDER BY c.title, c.id LIMIT $${params.length - 1} OFFSET $${params.length}`;
    return this.source.query(sql, params);
  }

  async get(id: string, fixed?: Kind): Promise<ContentDto> {
    const params: unknown[] = [id];
    let sql = select + ' AND c.id=$1';
    if (fixed) { params.push(this.kinds(fixed)); sql += ' AND c.kind = ANY($2)'; }
    const rows = await this.source.query(sql, params);
    if (!rows.length) throw new NotFoundException('Content not found');
    return rows[0];
  }
}
