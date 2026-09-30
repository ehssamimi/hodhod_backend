// Restores a backup made by scripts/db-backup.cjs into an EMPTY database of a container.
//   node scripts/db-restore.cjs <container> <database> <user> <backup-file>
// The target database must already exist and be empty; the script refuses to overwrite data.
// Restore into a fresh database first, verify it, then switch the application over.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');

function tableCount(container, database, user) {
  const out = execFileSync('docker', ['exec', container, 'psql', '-U', user, '-d', database, '-Atc',
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"], { encoding: 'utf8' });
  return Number(out.trim());
}

async function restore(container, database, user, input) {
  if (!fs.existsSync(input)) throw new Error('Backup file not found');
  if (tableCount(container, database, user) !== 0) throw new Error('Target database is not empty; restore into a new empty database');
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', ['exec', '-i', container, 'pg_restore', '--no-owner', '--exit-on-error', '-U', user, '-d', database], { stdio: ['pipe', 'ignore', 'pipe'] });
    let errors = '';
    proc.stderr.on('data', chunk => { errors += chunk; });
    fs.createReadStream(input).pipe(proc.stdin);
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve(tableCount(container, database, user)) : reject(new Error('pg_restore failed: ' + errors.trim())));
  });
}

module.exports = { restore };

if (require.main === module) {
  const [container, database, user, input] = process.argv.slice(2);
  if (!container || !database || !user || !input) { console.error('Usage: node scripts/db-restore.cjs <container> <database> <user> <backup-file>'); process.exit(2); }
  restore(container, database, user, input).then(n => console.log(`Restored ${n} tables into ${database}`), error => { console.error(error.message); process.exit(1); });
}
