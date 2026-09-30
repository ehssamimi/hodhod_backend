const assert = require('node:assert/strict');
module.exports = async ({ source, request, login, teacher }) => {
  const student = await login('profile-settings@example.com');
  const other = await login('profile-other@example.com');
  const patch = (body, token = student.accessToken) => request('/me', { method:'PATCH',body,token });
  assert.equal((await request('/me',{method:'PATCH',body:{displayName:'No token'}})).status,401);
  assert.equal((await patch({displayName:'Teacher'},teacher.accessToken)).status,403);
  const updated = await patch({displayName:'  سارا  ',avatarId:'owl_blue',timezone:'Asia/Tehran'});
  assert.equal(updated.status,200,JSON.stringify(updated.data));
  assert.equal(updated.data.displayName,'سارا');
  assert.equal(updated.data.avatarId,'owl_blue');
  assert.equal(updated.data.timezone,'Asia/Tehran');
  const fetched = await request('/me',{token:student.accessToken});
  assert.deepEqual(fetched.data,updated.data);
  assert.equal((await request('/me',{token:other.accessToken})).data.displayName,null);
  for(const body of [
    {displayName:'   '},{displayName:'x'.repeat(121)},{avatarId:'https://example.com/avatar'},
    {avatarId:'../private'},{timezone:'Mars/Olympus'},{timezone:'+03:30'},{timezone:null},
    {role:'admin'},{id:other.user.id},{authVersion:42},{clientTime:'2099-01-01'},{score:1000},
  ]) assert.equal((await patch(body)).status,400,JSON.stringify(body));
  const snapshot = await source.query('SELECT student_id,activity_date,timezone FROM daily_activity ORDER BY student_id,activity_date');
  const points = await source.query('SELECT id,delta FROM point_ledger ORDER BY id');
  const account = (await source.query("SELECT id FROM users WHERE email='student@example.com'"))[0];
  const pastUser = await login('student@example.com');
  assert.equal((await patch({timezone:'America/New_York'},pastUser.accessToken)).status,200);
  assert.deepEqual(await source.query('SELECT student_id,activity_date,timezone FROM daily_activity ORDER BY student_id,activity_date'),snapshot);
  assert.deepEqual(await source.query('SELECT id,delta FROM point_ledger ORDER BY id'),points);
  const saved = (await source.query('SELECT display_name,avatar_id,timezone FROM users WHERE id=$1',[student.user.id]))[0];
  assert.deepEqual(saved,{display_name:'سارا',avatar_id:'owl_blue',timezone:'Asia/Tehran'});
  const cleared = await patch({displayName:null,avatarId:null});
  assert.equal(cleared.status,200);
  assert.equal(cleared.data.displayName,null);
  assert.equal(cleared.data.timezone,'Asia/Tehran');
  console.log('PASS BE-04 profile persistence, field validation, ownership, role boundary and historical score/time retention');
};
