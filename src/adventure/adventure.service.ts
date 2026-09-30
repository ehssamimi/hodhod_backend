import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdventureMapDto, AdventureStageDto } from './adventure.dto';

// Only published Adventure content with a released version is on the map. A stage
// is unlocked when it has no prerequisite, the student's best stars on the
// prerequisite reach unlock_stars, or the student already passed the stage itself
// (a later rule change never re-locks earned progress). The check is one hop, so
// a bad prerequisite chain cannot loop. Stars come from adventure_progress only:
// teacher assignments are independent and never unlock anything.
export const mapSql = `SELECT s.content_id AS "contentId", s.position, s.prerequisite_content_id AS "prerequisiteContentId",
    s.unlock_stars AS "unlockStars", c.title, c.subject, v.unity_id AS "unityId", v.version,
    CASE WHEN s.prerequisite_content_id IS NULL OR COALESCE(pp.best_stars,0) >= s.unlock_stars OR p.first_passed_at IS NOT NULL
      THEN 'unlocked' ELSE 'locked' END AS status,
    COALESCE(p.best_stars,0) AS "bestStars", COALESCE(p.attempt_count,0) AS "attemptCount",
    COALESCE(r.max_stars,5) AS "maxStars", COALESCE(r.pass_stars,3) AS "passStars",
    COALESCE(p.best_stars,0) >= COALESCE(r.pass_stars,3) AS passed,
    p.first_passed_at AS "firstPassedAt", p.last_attempt_at AS "lastAttemptAt"
  FROM adventure_stages s
  JOIN content_items c ON c.id=s.content_id AND c.status='published' AND c.kind IN ('adventure','both')
  JOIN LATERAL (
    SELECT version, unity_id FROM content_versions
    WHERE content_id=s.content_id AND published_at IS NOT NULL AND published_at<=now()
    ORDER BY version DESC LIMIT 1
  ) v ON true
  LEFT JOIN adventure_progress p ON p.student_id=$1 AND p.content_id=s.content_id
  LEFT JOIN adventure_progress pp ON pp.student_id=$1 AND pp.content_id=s.prerequisite_content_id
  LEFT JOIN LATERAL (
    SELECT max_stars, pass_stars FROM scoring_rules
    WHERE content_id=s.content_id OR content_id IS NULL
    ORDER BY (content_id IS NULL), version DESC LIMIT 1
  ) r ON true
  ORDER BY s.position`;

@Injectable()
export class AdventureService {
  constructor(private readonly source: DataSource) {}

  async map(studentId: string): Promise<AdventureMapDto> {
    const stages: AdventureStageDto[] = await this.source.query(mapSql, [studentId]);
    const next = stages.find(stage => stage.status === 'unlocked' && !stage.passed);
    return { stages, nextContentId: next?.contentId ?? null };
  }
}
