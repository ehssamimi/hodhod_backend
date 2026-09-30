// Operator-only CLI. No public endpoint can bootstrap an administrator.
require('ts-node/register');
const { isEmail } = require('class-validator');
const source = require('../src/database/data-source').default;
const { lockRoleChanges } = require('../src/users/role.service');
const { User } = require('../src/users/user.entity');
async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!isEmail(email)) throw new Error('Usage: npm run admin:bootstrap -- existing-account@example.com');
  await source.initialize();
  await source.transaction(async manager => {
    await lockRoleChanges(manager);
    const users = manager.getRepository(User);
    if (await users.countBy({ role: 'admin' })) throw new Error('An admin already exists; use the authenticated admin API.');
    const user = await users.findOne({ where: { email }, lock: { mode: 'pessimistic_write' } });
    if (!user) throw new Error('Register this account first.');
    const previousRole = user.role;
    user.role = 'admin';
    user.authVersion += 1;
    await users.save(user);
    await manager.query(`INSERT INTO role_change_audit(user_id,actor_id,previous_role,new_role,reason)
      VALUES ($1,$1,$2,'admin','Operator CLI: bootstrap first administrator')`, [user.id,previousRole]);
  });
  console.log('Initial admin configured. Sign in again to obtain a fresh token.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => { if (source.isInitialized) await source.destroy(); });
