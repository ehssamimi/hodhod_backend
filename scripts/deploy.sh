#!/usr/bin/env bash
set -Eeuo pipefail

release_sha=${1:?release commit SHA is required}
compose_file=compose.prod.yaml
compose_project=hodhod
previous_sha=$(git rev-parse HEAD 2>/dev/null || true)
release_started=false

if [[ ! $release_sha =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid release SHA" >&2
  exit 2
fi

rollback() {
  exit_code=$?
  trap - ERR
  if [[ $release_started == true && -n $previous_sha && $previous_sha != "$release_sha" ]]; then
    echo "Deployment failed; restoring application revision $previous_sha" >&2
    git checkout --detach "$previous_sha"
    docker compose --env-file .env.production -p "$compose_project" -f "$compose_file" build api
    docker compose --env-file .env.production -p "$compose_project" -f "$compose_file" up -d --remove-orphans
  fi
  exit "$exit_code"
}
trap rollback ERR

if [[ ! -f .env.production ]]; then
  echo ".env.production is missing on the server" >&2
  exit 1
fi

git cat-file -e "$release_sha^{commit}"
git diff --quiet
git diff --cached --quiet

mkdir -p backups
postgres_container=$(docker compose --env-file .env.production -p "$compose_project" -f "$compose_file" ps -q postgres)
if [[ -n $postgres_container ]]; then
  backup_file="backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-${release_sha:0:12}.dump"
  database_name=$(docker exec "$postgres_container" printenv POSTGRES_DB)
  database_user=$(docker exec "$postgres_container" printenv POSTGRES_USER)
  if [[ -z $database_name || -z $database_user ]]; then
    echo "DATABASE_NAME and DATABASE_USER must be set in .env.production" >&2
    exit 1
  fi
  node scripts/db-backup.cjs "$postgres_container" "$database_name" "$database_user" "$backup_file"
  echo "Database backup created at $backup_file"
else
  echo "PostgreSQL is not running; treating this as the first deployment"
fi

git checkout --detach "$release_sha"
release_started=true

docker compose --env-file .env.production -p "$compose_project" -f "$compose_file" build api
docker compose --env-file .env.production -p "$compose_project" -f "$compose_file" run --rm api npm run migration:show:prod
docker compose --env-file .env.production -p "$compose_project" -f "$compose_file" run --rm api npm run migration:run:prod
docker compose --env-file .env.production -p "$compose_project" -f "$compose_file" up -d --remove-orphans

for attempt in {1..20}; do
  if docker compose --env-file .env.production -p "$compose_project" -f "$compose_file" exec -T api wget -qO- http://127.0.0.1:3000/health/ready | grep -q '"status":"ready"'; then
    trap - ERR
    echo "Deployment $release_sha is ready"
    exit 0
  fi
  sleep 3
done

echo "Readiness check did not pass" >&2
exit 1
