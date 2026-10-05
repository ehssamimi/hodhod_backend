import { DataSource, EntityManager } from 'typeorm';

export interface EffectiveRule {
  id: string;
  contentId: string | null;
  version: number;
  maxStars: number;
  passStars: number;
  definition: Record<string, unknown>;
}

// Shared with the admin rule writer so both serialize creation of the first global rule.
export const RULE_LOCK_SEED = 1790553609;

function positive(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0 || value > 10) throw new Error('Invalid ' + name);
  return value;
}

// Star limits used when no rule row exists yet (the same defaults effectiveRule() would persist).
export function defaultStarLimits(): { maxStars: number; passStars: number } {
  const max = positive('SCORING_DEFAULT_MAX_STARS', 5) || 5;
  return { maxStars: max, passStars: Math.min(positive('SCORING_DEFAULT_PASS_STARS', 3), max) };
}

// SCORING_STAR_POINTS lists the total points for having 0,1,2,... best stars, e.g. "0,0,0,20,30".
// No table is built in: without it (or a rule definition) stars earn no points.
export function defaultStarPoints(): number[] {
  const raw = process.env.SCORING_STAR_POINTS;
  if (!raw) return [];
  const values = raw.split(',').map(part => Number(part.trim()));
  if (values.length > 11 || values.some(v => !Number.isInteger(v) || v < 0 || v > 100000)) throw new Error('Invalid SCORING_STAR_POINTS');
  return values;
}

const projection = `id, content_id AS "contentId", version, max_stars AS "maxStars", pass_stars AS "passStars", definition`;

// Content-specific rule, else global rule. The first global rule is created from the
// environment defaults on demand, so every attempt can reference an immutable rule row.
export async function effectiveRule(manager: EntityManager, contentId: string): Promise<EffectiveRule> {
  const find = () => manager.query(`SELECT ${projection} FROM scoring_rules WHERE content_id=$1 OR content_id IS NULL
    ORDER BY (content_id IS NULL), version DESC LIMIT 1`, [contentId]);
  let rows = await find();
  if (!rows.length) {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', ['rule:global', RULE_LOCK_SEED]);
    rows = await find();
    if (!rows.length) {
      const { maxStars: max, passStars: pass } = defaultStarLimits();
      const points = defaultStarPoints();
      rows = await manager.query(`INSERT INTO scoring_rules(content_id,version,max_stars,pass_stars,definition) VALUES (NULL,1,$1,$2,$3) RETURNING ${projection}`,
        [max, Math.min(pass, max), points.length ? { starPoints: points } : {}]);
    }
  }
  return rows[0];
}

// Total points earned by having `stars` as the best result under a rule. Missing entries
// inherit the nearest lower defined value; no table means zero.
export function pointsForStars(rule: EffectiveRule, stars: number): number {
  const table = rule.definition?.starPoints;
  if (!table) return 0;
  for (let s = stars; s >= 0; s--) {
    const value = Array.isArray(table) ? table[s] : (table as Record<string, unknown>)[String(s)];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  }
  return 0;
}

// Read-only star limits for display: content rule, else global rule, else environment defaults.
// Unlike effectiveRule() this never writes, so it is safe on list endpoints.
export async function starLimitsFor(source: DataSource | EntityManager, contentIds: string[]): Promise<Map<string, { maxStars: number; passStars: number }>> {
  const fallback = defaultStarLimits();
  const rows: Array<{ contentId: string | null; maxStars: number; passStars: number }> = contentIds.length
    ? await source.query(`SELECT DISTINCT ON (content_id) content_id AS "contentId", max_stars AS "maxStars", pass_stars AS "passStars"
        FROM scoring_rules WHERE content_id = ANY($1) OR content_id IS NULL
        ORDER BY content_id, version DESC`, [contentIds])
    : [];
  const global = rows.find(row => row.contentId === null) ?? fallback;
  const limits = new Map<string, { maxStars: number; passStars: number }>();
  for (const id of contentIds) {
    const own = rows.find(row => row.contentId === id);
    limits.set(id, { maxStars: (own ?? global).maxStars, passStars: (own ?? global).passStars });
  }
  return limits;
}
