import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/user.entity';
import {
  AdminContentDto, AdminContentSummaryDto, AdventurePathDto, CreateContentDto, CreateRuleDto, CreateVersionDto, EffectiveRuleDto,
  ListAdminContentDto, ListRulesDto, ReplacePathDto, RuleDto, UpdateContentDto, UpdateVersionDto,
} from './admin-content.dto';

const MAX_JSON_BYTES = 16 * 1024;
const DEFAULT_MAX_STARS = 5;
const DEFAULT_PASS_STARS = 3;

const summarySql = `SELECT c.id, c.title, c.subject, c.grade, c.kind, c.status, c.created_at AS "createdAt",
    (SELECT max(version) FROM content_versions v WHERE v.content_id=c.id) AS "latestVersion",
    (SELECT max(version) FROM content_versions v WHERE v.content_id=c.id AND v.published_at IS NOT NULL) AS "currentVersion"
  FROM content_items c`;
const versionSql = `SELECT version, unity_id AS "unityId", configuration, published_at AS "publishedAt", created_at AS "createdAt"
  FROM content_versions WHERE content_id=$1 ORDER BY version`;
const ruleSql = `SELECT id, content_id AS "contentId", version, max_stars AS "maxStars", pass_stars AS "passStars", definition, created_at AS "createdAt"
  FROM scoring_rules`;

@Injectable()
export class AdminContentService {
  constructor(private readonly source: DataSource) {}

  // Every write re-checks the admin under a row lock, so a role change or token
  // revocation cannot race a mutation that started with a stale guard result.
  private write<T>(actor: User, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.source.transaction(async manager => {
      const user = await manager.getRepository(User).findOne({ where: { id: actor.id }, lock: { mode: 'pessimistic_read' } });
      if (!user || user.authVersion !== actor.authVersion) throw new UnauthorizedException('Session revoked');
      if (user.role !== 'admin') throw new ForbiddenException('Admin role required');
      return work(manager);
    });
  }

  private json(value: Record<string, unknown> | undefined, label: string): Record<string, unknown> {
    const object = value ?? {};
    if (Buffer.byteLength(JSON.stringify(object)) > MAX_JSON_BYTES) throw new BadRequestException(label + ' must be at most 16 KB');
    return object;
  }

  private async lock(manager: EntityManager, key: string): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 1790553609))', [key]);
  }

  private async lockItem(manager: EntityManager, id: string) {
    const rows = await manager.query('SELECT id, kind, status FROM content_items WHERE id=$1 FOR UPDATE', [id]);
    if (!rows.length) throw new NotFoundException('Content not found');
    return rows[0] as { id: string; kind: string; status: string };
  }

  private async requireFreeUnityId(manager: EntityManager, contentId: string, unityId: string): Promise<void> {
    await this.lock(manager, 'unity:' + unityId);
    const taken = await manager.query('SELECT 1 FROM content_versions WHERE unity_id=$1 AND content_id<>$2 LIMIT 1', [unityId, contentId]);
    if (taken.length) throw new ConflictException('Unity ID is already mapped to another content item');
  }

  private async detail(manager: EntityManager | DataSource, id: string): Promise<AdminContentDto> {
    const rows = await manager.query(summarySql + ' WHERE c.id=$1', [id]);
    if (!rows.length) throw new NotFoundException('Content not found');
    return { ...rows[0], versions: await manager.query(versionSql, [id]) };
  }

  // ---- content -------------------------------------------------------------

  async list(query: ListAdminContentDto): Promise<AdminContentSummaryDto[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    for (const [column, value] of [['status', query.status], ['kind', query.kind], ['subject', query.subject]] as const) {
      if (value) { params.push(value); where.push(`c.${column}=$${params.length}`); }
    }
    if (query.q) {
      params.push('%' + query.q.replace(/[\\%_]/g, '\\$&') + '%');
      where.push(`c.title ILIKE $${params.length} ESCAPE '\\'`);
    }
    params.push(query.limit ?? 50, query.offset ?? 0);
    return this.source.query(`${summarySql} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY c.created_at DESC, c.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  }

  get(id: string): Promise<AdminContentDto> { return this.detail(this.source, id); }

  create(actor: User, input: CreateContentDto): Promise<AdminContentDto> {
    const configuration = this.json(input.configuration, 'configuration');
    return this.write(actor, async manager => {
      const id = (await manager.query('INSERT INTO content_items(title,subject,grade,kind) VALUES ($1,$2,$3,$4) RETURNING id',
        [input.title, input.subject, input.grade ?? 3, input.kind]))[0].id;
      await this.requireFreeUnityId(manager, id, input.unityId);
      await manager.query('INSERT INTO content_versions(content_id,version,unity_id,configuration) VALUES ($1,1,$2,$3)', [id, input.unityId, configuration]);
      return this.detail(manager, id);
    });
  }

  update(actor: User, id: string, input: UpdateContentDto): Promise<AdminContentDto> {
    if (input.title === undefined && input.subject === undefined && input.kind === undefined) throw new BadRequestException('Send at least one field');
    return this.write(actor, async manager => {
      const item = await this.lockItem(manager, id);
      if (input.kind && input.kind !== item.kind) {
        if (input.kind === 'practice') {
          const stage = await manager.query('SELECT 1 FROM adventure_stages WHERE content_id=$1', [id]);
          if (stage.length) throw new ConflictException('Remove the Adventure stage before making this practice-only');
        }
        if (input.kind === 'adventure') {
          const used = await manager.query("SELECT 1 FROM assignments WHERE content_id=$1 AND status<>'cancelled' LIMIT 1", [id]);
          if (used.length) throw new ConflictException('Content has teacher assignments and must stay available for practice');
        }
      }
      await manager.query('UPDATE content_items SET title=COALESCE($2,title), subject=COALESCE($3,subject), kind=COALESCE($4,kind) WHERE id=$1',
        [id, input.title ?? null, input.subject ?? null, input.kind ?? null]);
      return this.detail(manager, id);
    });
  }

  addVersion(actor: User, id: string, input: CreateVersionDto): Promise<AdminContentDto> {
    const configuration = this.json(input.configuration, 'configuration');
    return this.write(actor, async manager => {
      await this.lockItem(manager, id);
      await this.requireFreeUnityId(manager, id, input.unityId);
      const next = (await manager.query('SELECT COALESCE(max(version),0)+1 AS v FROM content_versions WHERE content_id=$1', [id]))[0].v;
      await manager.query('INSERT INTO content_versions(content_id,version,unity_id,configuration) VALUES ($1,$2,$3,$4)', [id, next, input.unityId, configuration]);
      return this.detail(manager, id);
    });
  }

  updateVersion(actor: User, id: string, version: number, input: UpdateVersionDto): Promise<AdminContentDto> {
    if (input.unityId === undefined && input.configuration === undefined) throw new BadRequestException('Send at least one field');
    const configuration = input.configuration === undefined ? null : this.json(input.configuration, 'configuration');
    return this.write(actor, async manager => {
      await this.lockItem(manager, id);
      const rows = await manager.query('SELECT published_at FROM content_versions WHERE content_id=$1 AND version=$2 FOR UPDATE', [id, version]);
      if (!rows.length) throw new NotFoundException('Version not found');
      if (rows[0].published_at) throw new ConflictException('Released versions are immutable; add a new version');
      if (input.unityId) await this.requireFreeUnityId(manager, id, input.unityId);
      await manager.query('UPDATE content_versions SET unity_id=COALESCE($3,unity_id), configuration=COALESCE($4,configuration) WHERE content_id=$1 AND version=$2',
        [id, version, input.unityId ?? null, configuration]);
      return this.detail(manager, id);
    });
  }

  // Release time is the server clock, never a client value.
  publish(actor: User, id: string, version: number): Promise<AdminContentDto> {
    return this.write(actor, async manager => {
      await this.lockItem(manager, id);
      const rows = await manager.query('SELECT published_at FROM content_versions WHERE content_id=$1 AND version=$2 FOR UPDATE', [id, version]);
      if (!rows.length) throw new NotFoundException('Version not found');
      if (!rows[0].published_at) {
        const later = await manager.query('SELECT 1 FROM content_versions WHERE content_id=$1 AND version>$2 AND published_at IS NOT NULL', [id, version]);
        if (later.length) throw new ConflictException('A newer version is already released; release versions in order');
        await manager.query('UPDATE content_versions SET published_at=clock_timestamp() WHERE content_id=$1 AND version=$2', [id, version]);
      }
      await manager.query("UPDATE content_items SET status='published' WHERE id=$1", [id]);
      return this.detail(manager, id);
    });
  }

  setStatus(actor: User, id: string, status: 'draft' | 'archived'): Promise<AdminContentDto> {
    return this.write(actor, async manager => {
      await this.lockItem(manager, id);
      await manager.query('UPDATE content_items SET status=$2 WHERE id=$1', [id, status]);
      return this.detail(manager, id);
    });
  }

  // ---- Adventure path ------------------------------------------------------

  async path(manager: EntityManager | DataSource = this.source): Promise<AdventurePathDto> {
    return { stages: await manager.query(`SELECT s.position, s.content_id AS "contentId", c.title, c.kind, c.status,
        s.prerequisite_content_id AS "prerequisiteContentId", s.unlock_stars AS "unlockStars"
      FROM adventure_stages s JOIN content_items c ON c.id=s.content_id ORDER BY s.position`) };
  }

  replacePath(actor: User, input: ReplacePathDto): Promise<AdventurePathDto> {
    const stages = input.stages;
    const ids = stages.map(s => s.contentId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A content item can appear only once in the path');
    stages.forEach((stage, index) => {
      const prerequisite = stage.prerequisiteContentId ?? null;
      if (prerequisite && ids.indexOf(prerequisite) >= index) {
        throw new BadRequestException('Prerequisite of stage ' + (index + 1) + ' must appear earlier in the path');
      }
    });
    return this.write(actor, async manager => {
      await this.lock(manager, 'adventure-path');
      const items: Array<{ id: string; kind: string }> = ids.length
        ? await manager.query('SELECT id, kind FROM content_items WHERE id = ANY($1) FOR SHARE', [ids]) : [];
      const kindOf = new Map(items.map(item => [item.id, item.kind]));
      for (const id of ids) {
        if (!kindOf.has(id)) throw new BadRequestException('Unknown content ' + id);
        if (kindOf.get(id) === 'practice') throw new BadRequestException('Practice-only content cannot be an Adventure stage: ' + id);
      }
      for (const stage of stages) {
        if (stage.prerequisiteContentId && (stage.unlockStars ?? 3) > await this.maxStarsFor(manager, stage.prerequisiteContentId)) {
          throw new BadRequestException('unlockStars exceeds the star ceiling of its prerequisite');
        }
      }
      const existing: Array<{ content_id: string }> = await manager.query('SELECT content_id FROM adventure_stages FOR UPDATE');
      const removed = existing.map(row => row.content_id).filter(id => !ids.includes(id));
      // Detach and park positions so reordering never trips the unique position index.
      const park = Number((await manager.query('SELECT COALESCE(max(position),0)+$1 AS p FROM adventure_stages', [ids.length + 1]))[0].p);
      await manager.query('UPDATE adventure_stages SET prerequisite_content_id=NULL, position=position+$1', [park]);
      if (removed.length) {
        try { await manager.query('DELETE FROM adventure_stages WHERE content_id = ANY($1)', [removed]); }
        catch (error) {
          if ((error as { driverError?: { code?: string } }).driverError?.code === '23503') {
            throw new ConflictException('A removed stage already has student progress; keep it in the path or archive its content');
          }
          throw error;
        }
      }
      for (const [index, stage] of stages.entries()) {
        await manager.query(`INSERT INTO adventure_stages(content_id,position,unlock_stars) VALUES ($1,$2,$3)
          ON CONFLICT (content_id) DO UPDATE SET position=EXCLUDED.position, unlock_stars=EXCLUDED.unlock_stars`,
          [stage.contentId, index + 1, stage.unlockStars ?? 3]);
      }
      for (const stage of stages) {
        if (stage.prerequisiteContentId) {
          await manager.query('UPDATE adventure_stages SET prerequisite_content_id=$2 WHERE content_id=$1', [stage.contentId, stage.prerequisiteContentId]);
        }
      }
      return this.path(manager);
    });
  }

  private async maxStarsFor(manager: EntityManager, contentId: string): Promise<number> {
    return (await this.effective(manager, contentId)).maxStars;
  }

  // ---- scoring rules (append-only) ----------------------------------------

  async listRules(query: ListRulesDto): Promise<RuleDto[]> {
    const params: unknown[] = [];
    let where = '';
    if (query.contentId) { params.push(query.contentId); where = 'WHERE content_id=$1'; }
    else if (query.scope === 'global') where = 'WHERE content_id IS NULL';
    params.push(query.limit ?? 50, query.offset ?? 0);
    return this.source.query(`${ruleSql} ${where} ORDER BY created_at DESC, version DESC, id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  }

  async getRule(id: string): Promise<RuleDto> {
    const rows = await this.source.query(ruleSql + ' WHERE id=$1', [id]);
    if (!rows.length) throw new NotFoundException('Rule not found');
    return rows[0];
  }

  async effective(manager: EntityManager | DataSource, contentId?: string): Promise<EffectiveRuleDto> {
    const stored = await manager.query(`${ruleSql} WHERE content_id=$1 OR content_id IS NULL
      ORDER BY (content_id IS NULL), version DESC LIMIT 1`, [contentId ?? null]);
    const rule: RuleDto | undefined = stored[0];
    if (!rule) return { source: 'default', rule: null, maxStars: DEFAULT_MAX_STARS, passStars: DEFAULT_PASS_STARS };
    return { source: rule.contentId ? 'content' : 'global', rule, maxStars: rule.maxStars, passStars: rule.passStars };
  }

  async effectiveFor(contentId?: string): Promise<EffectiveRuleDto> {
    if (contentId) await this.requireContent(this.source, contentId);
    return this.effective(this.source, contentId);
  }

  private async requireContent(manager: EntityManager | DataSource, id: string): Promise<void> {
    if (!(await manager.query('SELECT 1 FROM content_items WHERE id=$1', [id])).length) throw new NotFoundException('Content not found');
  }

  createRule(actor: User, input: CreateRuleDto): Promise<RuleDto> {
    if (input.passStars > input.maxStars) throw new BadRequestException('passStars cannot exceed maxStars');
    const definition = this.json(input.definition, 'definition');
    const contentId = input.contentId ?? null;
    return this.write(actor, async manager => {
      if (contentId) await this.requireContent(manager, contentId);
      // A new version never edits an older one, so points already in the ledger keep their rule.
      await this.lock(manager, 'rule:' + (contentId ?? 'global'));
      const next = (await manager.query('SELECT COALESCE(max(version),0)+1 AS v FROM scoring_rules WHERE content_id IS NOT DISTINCT FROM $1', [contentId]))[0].v;
      const rows = await manager.query(`INSERT INTO scoring_rules(content_id,version,max_stars,pass_stars,definition) VALUES ($1,$2,$3,$4,$5)
        RETURNING id, content_id AS "contentId", version, max_stars AS "maxStars", pass_stars AS "passStars", definition, created_at AS "createdAt"`,
        [contentId, next, input.maxStars, input.passStars, definition]);
      return rows[0];
    });
  }
}
