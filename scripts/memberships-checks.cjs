const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async ({ source, request, login, teacher, admin }) => {
  const student = await login('membership-student@example.com');
  const other = await login('membership-other@example.com');
  let secondTeacher = await login('membership-teacher@example.com');
  await source.query("UPDATE users SET role='teacher',auth_version=auth_version+1 WHERE id=$1", [secondTeacher.user.id]);
  secondTeacher = await login('membership-teacher@example.com');
  const call = (path, method='GET', body, token=student.accessToken) => request(path, {method,body,token});
  const join = code => call('/classes/join','POST',{code});
  const mine = () => call('/classes/mine');
  const history = () => call('/classes/history');
  const create = async (name, owner=teacher) => {
    const response = await call('/teacher/classes','POST',{name},owner.accessToken);
    assert.equal(response.status,201,JSON.stringify(response.data));
    return response.data;
  };
  const a = await create('Membership A');
  const b = await create('Membership B',secondTeacher);
  const roster = (c, owner=teacher) => call(`/teacher/classes/${c.id}/members`,'GET',undefined,owner.accessToken);
  const remove = (c, owner=teacher) => call(`/teacher/classes/${c.id}/members/${student.user.id}`,'DELETE',undefined,owner.accessToken);
  const archive = c => call(`/teacher/classes/${c.id}/archive`,'POST',undefined,teacher.accessToken);

  for (const [path,method] of [['/classes/mine','GET'],['/classes/history','GET'],['/classes/join','POST'],['/classes/leave','POST']]) {
    assert.equal((await request(path,{method,body:method==='POST'?{code:a.joinCode}:undefined})).status,401);
    for (const user of [teacher,admin]) assert.equal((await call(path,method,undefined,user.accessToken)).status,403);
  }
  assert.deepEqual((await mine()).data,{membership:null});
  assert.deepEqual((await history()).data,[]);
  assert.equal((await call('/me')).status,200);
  for (const body of [{},{code:''},{code:' '},{code:null},{code:42},{code:'x'.repeat(33)},{code:a.joinCode,studentId:other.user.id},{code:a.joinCode,joinedAt:'2000-01-01'}]) {
    assert.equal((await call('/classes/join','POST',body)).status,400);
  }
  const first = await join(' '+a.joinCode+' ');
  assert.equal(first.status,200,JSON.stringify(first.data));
  assert.equal(first.data.membership.classId,a.id);
  assert.equal(first.data.membership.studentId,student.user.id);
  assert.deepEqual((await join(a.joinCode)).data,first.data);
  assert.equal((await history()).data.length,1);
  assert.deepEqual((await roster(a)).data,[first.data.membership]);
  assert.equal((await roster(a,secondTeacher)).status,404);
  assert.equal((await remove(a,secondTeacher)).status,404);
  assert.equal((await roster(a,{accessToken:student.accessToken})).status,403);
  assert.equal((await call('/teacher/classes/invalid/members','GET',undefined,teacher.accessToken)).status,400);
  assert.equal((await call(`/teacher/classes/${a.id}/members/invalid`,'DELETE',undefined,teacher.accessToken)).status,400);
  assert.equal((await call(`/teacher/classes/${randomUUID()}/members`,'GET',undefined,teacher.accessToken)).status,404);
  assert.deepEqual((await call('/classes/history','GET',undefined,other.accessToken)).data,[]);
  assert.equal((await join('INVALID')).status,404);
  assert.deepEqual((await mine()).data,first.data);
  const rotated = await call(`/teacher/classes/${a.id}/join-code/rotate`,'POST',undefined,teacher.accessToken);
  assert.equal((await join(a.joinCode)).status,404);
  a.joinCode = rotated.data.joinCode;
  assert.deepEqual((await mine()).data,first.data);

  // Persist both progress contexts and a ledger entry before exercising transfer.
  const content = (await source.query("INSERT INTO content_items(title,subject,kind) VALUES ('Retention','Math','both') RETURNING id"))[0];
  await source.query('INSERT INTO adventure_stages(content_id,position) VALUES ($1,$2)',[content.id,900000+Math.floor(Math.random()*90000)]);
  const assignment = (await source.query(`INSERT INTO assignments(teacher_id,class_id,content_id,audience,starts_at,ends_at)
    VALUES ($1,$2,$3,'selected',now(),now()+interval '7 days') RETURNING id`,[teacher.user.id,a.id,content.id]))[0];
  await source.query('INSERT INTO assignment_recipients(assignment_id,student_id) VALUES ($1,$2)',[assignment.id,student.user.id]);
  await source.query('INSERT INTO assignment_progress(assignment_id,student_id,best_stars,attempt_count) VALUES ($1,$2,4,2)',[assignment.id,student.user.id]);
  await source.query('INSERT INTO adventure_progress(student_id,content_id,best_stars,attempt_count) VALUES ($1,$2,5,3)',[student.user.id,content.id]);
  await source.query("INSERT INTO point_ledger(student_id,delta,reason,source,idempotency_key) VALUES ($1,30,'retention fixture','adjustment','membership-fixture')",[student.user.id]);
  const snapshot = async () => Promise.all(['adventure_progress','assignment_progress','assignment_recipients','point_ledger'].map(table => source.query(`SELECT * FROM ${table} WHERE student_id=$1`,[student.user.id])));
  const before = await snapshot();
  const transferred = await join(b.joinCode);
  assert.equal(transferred.status,200);
  assert.equal(transferred.data.membership.classId,b.id);
  assert.notEqual(transferred.data.membership.id,first.data.membership.id);
  const past = (await history()).data;
  assert.equal(past.length,2);
  assert.ok(past.find(m=>m.id===first.data.membership.id).endedAt);
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual((await roster(a)).data,[]);
  assert.equal((await roster(b)).status,404);
  assert.deepEqual((await remove(a)).data,{removed:false});
  assert.equal((await mine()).data.membership.classId,b.id);
  assert.equal((await call('/test-access/classes/'+a.id)).status,403);
  assert.equal((await call('/test-access/classes/'+b.id)).status,200);
  assert.deepEqual((await remove(b,secondTeacher)).data,{removed:true});
  assert.deepEqual((await remove(b,secondTeacher)).data,{removed:false});
  assert.deepEqual((await mine()).data,{membership:null});
  assert.equal((await history()).data.length,2);
  await join(a.joinCode);
  assert.equal((await history()).data.length,3);
  assert.deepEqual((await call('/classes/leave','POST')).data,{membership:null});
  const left = (await history()).data;
  await call('/classes/leave','POST');
  assert.deepEqual((await history()).data,left);

  const same = await Promise.all(Array.from({length:4},()=>join(a.joinCode)));
  assert.ok(same.every(r=>r.status===200),JSON.stringify(same));
  assert.equal(new Set(same.map(r=>r.data.membership.id)).size,1);
  const different = await Promise.all([join(a.joinCode),join(b.joinCode)]);
  assert.ok(different.every(r=>r.status===200),JSON.stringify(different));
  const active = () => source.query('SELECT * FROM class_memberships WHERE student_id=$1 AND ended_at IS NULL',[student.user.id]);
  assert.equal((await active()).length,1);
  const mixed = await Promise.all([join(a.joinCode),call('/classes/leave','POST'),remove(a)]);
  assert.ok(mixed.every(r=>r.status===200),JSON.stringify(mixed));
  assert.ok((await active()).length<=1);

  // Failure after closing the old membership must restore it on rollback.
  await join(a.joinCode);
  const original = (await history()).data;
  const { MembershipsService } = require('../src/classes/memberships.service');
  const { ClassesService } = require('../src/classes/classes.service');
  const { User } = require('../src/users/user.entity');
  const service = new MembershipsService(source);
  const actor = await source.getRepository(User).findOneByOrFail({id:student.user.id});
  await source.query(`CREATE FUNCTION test_reject_membership() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'test membership failure'; END; $$`);
  await source.query('CREATE TRIGGER test_reject_membership BEFORE INSERT ON class_memberships FOR EACH ROW EXECUTE FUNCTION test_reject_membership()');
  try { await assert.rejects(()=>service.join(actor,b.joinCode),/test membership failure/); }
  finally {
    await source.query('DROP TRIGGER test_reject_membership ON class_memberships');
    await source.query('DROP FUNCTION test_reject_membership()');
  }
  assert.deepEqual((await history()).data,original);

  // Archive failure after ending members must roll back those membership changes.
  const teacherActor = await source.getRepository(User).findOneByOrFail({id:teacher.user.id});
  await source.query(`CREATE FUNCTION test_reject_archive() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'test archive failure'; END; $$`);
  await source.query('CREATE TRIGGER test_reject_archive BEFORE UPDATE ON classes FOR EACH ROW EXECUTE FUNCTION test_reject_archive()');
  try { await assert.rejects(()=>new ClassesService(source).archive(teacherActor,a.id),/test archive failure/); }
  finally {
    await source.query('DROP TRIGGER test_reject_archive ON classes');
    await source.query('DROP FUNCTION test_reject_archive()');
  }
  assert.deepEqual((await history()).data,original);

  const c = await create('Archive race');
  const race = await Promise.all([join(c.joinCode),archive(c)]);
  assert.ok([200,404].includes(race[0].status),JSON.stringify(race));
  assert.equal(race[1].status,201);
  assert.equal((await source.query('SELECT id FROM class_memberships WHERE class_id=$1 AND ended_at IS NULL',[c.id])).length,0);
  assert.equal((await join(c.joinCode)).status,404);
  await join(a.joinCode);
  await archive(a);
  assert.deepEqual((await mine()).data,{membership:null});
  assert.deepEqual((await roster(a)).data,[]);
  const archivedHistory = (await history()).data;
  await archive(a);
  assert.deepEqual((await history()).data,archivedHistory);
  assert.deepEqual(await snapshot(),before);
  await source.query("UPDATE users SET role='teacher',auth_version=auth_version+1 WHERE id=$1",[student.user.id]);
  await assert.rejects(()=>service.join(actor,b.joinCode),/Session revoked/);
  assert.equal((await mine()).status,401);
  console.log('PASS BE-06 membership lifecycle, ownership, history/progress/points retention, concurrent writes, rollback and stale roles');
};
