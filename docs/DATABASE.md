# BE-01: database model and migrations

PostgreSQL 17 is the supported baseline (matching compose.yaml). SQL migrations
are authoritative. Automatic TypeORM synchronization is disabled in every
environment, and API startup never applies migrations. The existing User entity
is mapped now; repositories/entities for the other tables belong to their feature
tasks. Do not run schema:sync or generate migrations from this partial entity set:
it does not describe the complete schema and could propose dropping domain tables.

## Apply and verify

Local: start PostgreSQL with docker compose up -d, configure DATABASE_* in .env,
then run npm run migration:show and npm run migration:run before starting the API.
Running migration:run again does nothing when schema_migrations is current.

Production: back up and verify the target database, build with npm run build,
then run npm run migration:show:prod and npm run migration:run:prod as one
deployment job, before starting the new API. Do not run concurrent migrators.
The old authentication code can coexist during this additive rollout: id, email
and the quoted users."createdAt" retain their names and types, and new columns
have defaults or allow NULL. Defaults preserve existing users as students.
The original API response is unchanged. Auth/role enforcement is BE-02, not BE-01.

Each migration batch runs inside one transaction. A failed step rolls back schema,
backfill and history together. Inspect and fix the reported conflict before retrying;
never fake migration history or drop existing tables to suppress a failure.

## Existing development databases

UsersBaseline adopts the existing users table and validates its known column and
email-uniqueness shape. It preserves all IDs, emails, timestamps and the existing
UUID default. On a blank database it creates users using gen_random_uuid(), without
requiring extension-install privileges. Unexpected existing domain tables or an
incompatible users baseline cause migration failure rather than data replacement.
MvpDataModel adds account fields and backfills student_profiles for existing users.
BE-02 creates missing role profiles during sign-in and role changes.

## Model

| Tables | Identity and invariant |
| --- | --- |
| users | UUID, unique email, one role (student default), display name/avatar, timezone (UTC default), auth_version for future token invalidation |
| student_profiles, teacher_profiles | Optional 1:1 records keyed by user; role changes do not cascade-delete profiles |
| role_change_audit | Target, actor, old/new role, timestamp and optional reason |
| classes, class_memberships | Stable class, teacher and unique join code; membership history; partial unique index permits at most one open membership per student |
| content_items, content_versions | Stable content ID plus retained numbered versions/Unity mapping; kind can be adventure, practice or both |
| scoring_rules | Global (NULL content) or content-specific numbered rule; default max/pass stars 5/3; JSON rule snapshot; unique version within scope, including global |
| adventure_stages | One stage per content ID, unique ordering, optional prerequisite and unlock threshold |
| assignments, assignment_recipients | Each allocation is a new UUID with time window and explicit recipients; assigning the same content again is allowed |
| game_attempts | Globally unique attempt UUID, student, content version, rule and server timestamps; context is adventure with no assignment, or assignment with an existing recipient and matching content |
| adventure_progress | Key (student_id, content_id) |
| assignment_progress | Key (assignment_id, student_id), linked to an actual recipient; content comes from that assignment |
| point_ledger | Signed nonzero delta, cause, source, rule and unique per-student idempotency key; game rewards match attempt student/context/allocation and permit one star delta per attempt |
| daily_activity, streaks | Unique local date per student with timezone snapshot and qualifying attempt; current/best count; activity reference |
| game_feedback | One 1–4 interest rating per student/content; independent of performance stars |

Adventure, assignment A and assignment B can refer to the same content ID while
keeping three independent progress records and reward histories. No uniqueness
constraint on class/content prevents repeat allocations. An attempt's primary key
is its idempotency identifier; duplicate request handling belongs to BE-14.

Historical records use RESTRICT foreign keys. End membership or archive content/
classes instead of deleting records. Student progress and ledger refer to the user,
not their current class, so transfer does not erase progress or points. Archiving a
class must end its memberships in the same feature-service transaction (BE-05/06).

Rules and content versions are to be treated as append-only by their owning
services. New policy changes create new version records; ledger deltas already
recorded must not be recalculated. BE-09/16 implement those write paths. The schema
does not yet enforce service authorization. Since BE-09, migration ImmutableRuleHistory rejects UPDATE/DELETE on scoring_rules and point_ledger and any change to a released content_versions row.

## Deliberately deferred behavior

This task establishes storage and database constraints, not the remaining MVP
APIs. Role/ownership guards, last-admin protection, role-change audit writes and
token invalidation are BE-02. Content publication/access, prerequisite-cycle
validation, rule applicability to content, recipient selection, trusted server
timestamps and atomic result/progress/ledger processing belong to their feature
tasks. Stored timezone values must be validated as IANA names by BE-04/19.

The open product decisions in BACKEND_MVP_PLAN.md remain open: late attempts,
newcomers to whole-class assignments, feedback editing, streak qualification and
timezone changes, tie-breaking, prior-class report access and actual reward values.
No example reward table or inferred behavior is seeded. Explicit recipient records
can support either future whole-class audience policy. UTC is only a storage
default, not a decision about the user's actual timezone.

## Rollback

Roll the application back first if necessary: the previous auth code tolerates the
added schema. Prefer retaining the additive database migration after real usage.
For an unused migration, npm run migration:revert (or migration:revert:prod) removes
the MVP tables/columns inside a transaction. It locks the affected tables and
refuses rollback if domain data or nondefault account metadata would be lost.
The reproducible student profile links are the only removed backfill; users survive.

Reverting UsersBaseline deliberately leaves users in place, because it may have
existed before migration history. It only removes the migration-history entry.
Reapplying safely adopts the retained table. A full destructive teardown is never
part of this rollback. If rollback refuses, take a verified backup and design a
separate data-preserving migration; do not bypass the checks.

## Tests

Run npm test and npm run build. With Docker running and postgres:17-alpine already
available, run npm run test:db. The integration script starts its own disposable
container on a random loopback port, uses generated test credentials, and removes
only that container afterwards. It never connects to the database configured in
.env and does not change the project's Docker volume.

Checks cover blank-schema creation, rerun, concurrent membership/attempt uniqueness,
foreign keys, separate Adventure/allocation progress, ledger attribution and reward
deduplication, feedback bounds, transfer retention, real repository-backed auth,
legacy user preservation, rollback/reapply and atomic rollback of a failed batch.
