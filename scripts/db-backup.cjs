// Logical backup of the PostgreSQL database running in a container (custom format, restorable
// with scripts/db-restore.cjs). Usage:
//   node scripts/db-backup.cjs <container> <database> <user> <output-file>
// The password never appears on the command line: pg_dump runs inside the container over the
// local socket. Keep backups outside the repository and off the database host.
const { spawn } = require('node:child_process');
const fs = require('node:fs');

function backup(container, database, user, output) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(output, { mode: 0o600 });
    const dump = spawn('docker', ['exec', container, 'pg_dump', '-Fc', '--no-owner', '-U', user, '-d', database], { stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    dump.stderr.on('data', chunk => { errors += chunk; });
    dump.stdout.pipe(file);
    dump.on('error', reject);
    dump.on('close', code => {
      file.end(() => {
        if (code !== 0) { fs.rmSync(output, { force: true }); reject(new Error('pg_dump failed: ' + errors.trim())); }
        else if (fs.statSync(output).size === 0) { fs.rmSync(output, { force: true }); reject(new Error('pg_dump produced an empty file')); }
        else resolve(output);
      });
    });
  });
}

module.exports = { backup };

if (require.main === module) {
  const [container, database, user, output] = process.argv.slice(2);
  if (!container || !database || !user || !output) { console.error('Usage: node scripts/db-backup.cjs <container> <database> <user> <output-file>'); process.exit(2); }
  backup(container, database, user, output).then(file => console.log('Backup written to ' + file), error => { console.error(error.message); process.exit(1); });
}
