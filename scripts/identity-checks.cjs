const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

module.exports = async function identityChecks(dataSource) {
  process.env.JWT_SECRET = randomUUID() + randomUUID();
  const { Test } = require('@nestjs/testing');
  const { Controller, Get, Inject, Module, Param, Req, ValidationPipe } = require('@nestjs/common');
  const { JwtService } = require('@nestjs/jwt');
  const { DataSource } = require('typeorm');
  const { AppModule } = require('../src/app.module');
  const { AuthModule } = require('../src/auth/auth.module');
  const { ClassesModule } = require('../src/classes/classes.module');
  const { StudentAdventureModule } = require('../src/adventure/adventure.module');
  const { AdminContentModule } = require('../src/admin-content/admin-content.module');
  const { TeacherAssignmentsModule } = require('../src/assignments/assignments.module');
  const { StudentAssignmentsModule } = require('../src/assignments/student-assignments.module');
  const { StudentClassesModule } = require('../src/classes/student-classes.module');
  const { StudentContentModule, TeacherContentModule } = require('../src/content/content.module');
  const { StudentProfileModule } = require('../src/users/student-profile.module');
  const { ProfileModule } = require('../src/users/profile.module');
  const { AdminUsersModule } = require('../src/users/admin-users.module');
  const { User } = require('../src/users/user.entity');
  const { RoleService } = require('../src/users/role.service');
  const { ClassAccessService } = require('../src/auth/class-access.service');
  const { Roles } = require('../src/auth/security');
  const { setupSwagger } = require('../src/swagger');

  // Test-only endpoints exercise the real shared guards and class-access service.
  class AccessProbeController {
    constructor(access) { this.access = access; }
    teacher() { return { allowed: true }; }
    async classroom(req, id) { await this.access.requireClassAccess(req.user, id); return { allowed: true }; }
  }
  Controller('test-access')(AccessProbeController);
  Inject(ClassAccessService)(AccessProbeController, undefined, 0);
  Get('teacher')(AccessProbeController.prototype, 'teacher', Object.getOwnPropertyDescriptor(AccessProbeController.prototype, 'teacher'));
  Roles('teacher')(AccessProbeController.prototype, 'teacher', Object.getOwnPropertyDescriptor(AccessProbeController.prototype, 'teacher'));
  Get('classes/:id')(AccessProbeController.prototype, 'classroom', Object.getOwnPropertyDescriptor(AccessProbeController.prototype, 'classroom'));
  Req()(AccessProbeController.prototype, 'classroom', 0);
  Param('id')(AccessProbeController.prototype, 'classroom', 1);
  class TestHttpModule {}
  Module({ imports: [AppModule, AuthModule], controllers: [AccessProbeController] })(TestHttpModule);
  const testing = await Test.createTestingModule({ imports: [TestHttpModule] })
    .overrideProvider(DataSource).useValue(dataSource).compile();
  const app = testing.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  setupSwagger(app, { student: [AppModule,AuthModule,ProfileModule,StudentProfileModule,StudentClassesModule,StudentContentModule,StudentAdventureModule,StudentAssignmentsModule], teacher: [AppModule,AuthModule,ProfileModule,ClassesModule,TeacherContentModule,TeacherAssignmentsModule],
    admin: [AppModule,AuthModule,ProfileModule,AdminUsersModule,AdminContentModule] });
  try {
    await app.listen(0, '127.0.0.1');
    const port = app.getHttpServer().address().port;
    async function request(url, { method = 'GET', body, token } = {}) {
      const response = await fetch('http://127.0.0.1:' + port + url, { method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    }
    async function login(email) {
      const r = await request('/auth/verify-code', { method: 'POST', body: { email,code:'11111' } });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      return r.data;
    }
    const change = (actor, id, role, reason) => request('/admin/users/' + id + '/role', {
      method: 'PATCH', token: actor.accessToken, body: { role, ...(reason ? { reason } : {}) },
    });
    assert.equal((await request('/health')).status, 200);
    assert.equal((await request('/me')).status, 401);
    assert.equal((await request('/me', { token: 'garbage' })).status, 401);
    assert.equal((await request('/auth/verify-code', { method:'POST', body:{ email:'injected@example.com',code:'11111',role:'admin' } })).status, 400);
    assert.equal(await dataSource.getRepository(User).countBy({ email:'injected@example.com' }), 0);
    const student = await login('identity-student@example.com');
    const outsider = await login('identity-outsider@example.com');
    assert.equal(student.user.role, 'student');
    assert.equal((await request('/me', { token:student.accessToken })).data.id, student.user.id);
    assert.equal((await request('/me?userId=' + outsider.user.id, { token:student.accessToken })).data.id, student.user.id);
    assert.equal((await request('/test-access/teacher', { token:student.accessToken })).status, 403);
    assert.equal((await change(student, student.user.id, 'admin')).status, 403);
    assert.equal((await dataSource.query('SELECT * FROM student_profiles WHERE user_id=$1', [student.user.id])).length, 1);
    const simultaneous = await Promise.all([login('race@example.com'), login('race@example.com')]);
    assert.equal(simultaneous.filter(r => r.isNewUser).length, 1);
    assert.equal(simultaneous[0].user.id, simultaneous[1].user.id);
    const signer = new JwtService({ secret:process.env.JWT_SECRET });
    const oldToken = signer.sign({ sub:student.user.id }, { expiresIn:'1h' });
    assert.equal((await request('/me', { token:oldToken })).status, 401);
    const expired = signer.sign({ sub:student.user.id,ver:0 }, { expiresIn:-1 });
    assert.equal((await request('/me', { token:expired })).status, 401);
    const wrongAlgorithm = signer.sign({ sub:student.user.id,ver:0 }, { expiresIn:'1h',algorithm:'HS384' });
    assert.equal((await request('/me', { token:wrongAlgorithm })).status, 401);
    console.log('PASS HTTP authentication, default student, rejected role injection, concurrent signup and token validation');

    let admin = await login('identity-admin@example.com');
    // Bootstrap fixture only, on the disposable test database.
    await dataSource.query("UPDATE users SET role='admin',auth_version=auth_version+1 WHERE id=$1", [admin.user.id]);
    admin = await login('identity-admin@example.com');
    assert.equal((await change(admin, admin.user.id, 'student')).status, 409);
    assert.equal((await change(admin, randomUUID(), 'teacher')).status, 404);
    assert.equal((await change(admin, 'invalid-id', 'teacher')).status, 400);
    assert.equal((await change(admin, student.user.id, 'owner')).status, 400);
    const roleService = new RoleService(dataSource);
    const staleActor = await dataSource.getRepository(User).findOneByOrFail({ id:admin.user.id });
    const promoted = await change(admin, student.user.id, 'teacher', 'Teaching assignment');
    assert.equal(promoted.status, 200, JSON.stringify(promoted.data));
    assert.equal((await request('/me', { token:student.accessToken })).status, 401);
    const teacher = await login('identity-student@example.com');
    assert.equal(teacher.user.role, 'teacher');
    assert.equal((await request('/test-access/teacher', { token:teacher.accessToken })).status, 200);
    assert.equal((await change(teacher, outsider.user.id, 'admin')).status, 403);
    assert.equal((await dataSource.query('SELECT * FROM student_profiles WHERE user_id=$1', [student.user.id])).length, 1);
    assert.equal((await dataSource.query('SELECT * FROM teacher_profiles WHERE user_id=$1', [student.user.id])).length, 1);
    const audit = (await dataSource.query('SELECT * FROM role_change_audit WHERE user_id=$1', [student.user.id]))[0];
    assert.equal(audit.actor_id, admin.user.id);
    assert.equal(audit.previous_role, 'student');
    assert.equal(audit.new_role, 'teacher');
    assert.equal(audit.reason, 'Teaching assignment');
    assert.ok(audit.created_at);
    const noOp = await change(admin, student.user.id, 'teacher');
    assert.equal(noOp.status, 200);
    assert.equal((await request('/me', { token:teacher.accessToken })).status, 200);
    assert.equal((await dataSource.query('SELECT * FROM role_change_audit WHERE user_id=$1', [student.user.id])).length, 1);
    console.log('PASS admin-only role updates, audit, prior profile retention, last-admin rule and session revocation');

    const classes = await dataSource.query('SELECT * FROM classes ORDER BY name');
    const ownClass = classes[0];
    const otherClass = classes[1];
    await dataSource.query('UPDATE classes SET teacher_id=$1 WHERE id=$2', [teacher.user.id,ownClass.id]);
    await dataSource.query('INSERT INTO class_memberships(class_id,student_id) VALUES ($1,$2)', [ownClass.id,outsider.user.id]);
    const accessUrl = '/test-access/classes/';
    assert.equal((await request(accessUrl + ownClass.id, { token:teacher.accessToken })).status, 200);
    assert.equal((await request(accessUrl + otherClass.id, { token:teacher.accessToken })).status, 403);
    assert.equal((await request(accessUrl + ownClass.id, { token:outsider.accessToken })).status, 200);
    assert.equal((await request(accessUrl + otherClass.id, { token:outsider.accessToken })).status, 403);
    await dataSource.query('UPDATE class_memberships SET ended_at=now() WHERE student_id=$1 AND ended_at IS NULL', [outsider.user.id]);
    assert.equal((await request(accessUrl + ownClass.id, { token:outsider.accessToken })).status, 403);
    console.log('PASS teacher ownership, student membership and removal access boundaries');

    await require('./profile-settings-checks.cjs')({ source:dataSource,request,login,teacher });

    await require('./classes-checks.cjs')({ source:dataSource,request,login,teacher,outsider,admin });
    await require('./memberships-checks.cjs')({ source:dataSource,request,login,teacher,admin });
    await require('./content-checks.cjs')({ source:dataSource,request,login,teacher,admin });
    await require('./adventure-checks.cjs')({ source:dataSource,request,login,teacher,admin });
    await require('./admin-content-checks.cjs')({ source:dataSource,request,login,teacher,admin });
    await require('./assignments-checks.cjs')({ source:dataSource,request,login,teacher,admin });
    await require('./assignment-turns-checks.cjs')({ source:dataSource,request,login,teacher,admin });
    await require('./student-assignments-checks.cjs')({ source:dataSource,request,login,teacher,admin });

    // Failure after the UPDATE must roll back both the role and token version.
    await dataSource.query(`CREATE FUNCTION test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test audit failure'; END; $$`);
    await dataSource.query('CREATE TRIGGER test_reject_audit BEFORE INSERT ON role_change_audit FOR EACH ROW EXECUTE FUNCTION test_reject_audit()');
    await assert.rejects(() => roleService.changeRole(staleActor, outsider.user.id, { role:'teacher' }), /test audit failure/);
    assert.equal((await dataSource.getRepository(User).findOneByOrFail({ id:outsider.user.id })).role, 'student');
    assert.equal((await request('/me', { token:outsider.accessToken })).status, 200);
    await dataSource.query('DROP TRIGGER test_reject_audit ON role_change_audit');
    await dataSource.query('DROP FUNCTION test_reject_audit()');
    console.log('PASS role and token changes roll back when audit persistence fails');

    assert.equal((await change(admin, outsider.user.id, 'admin')).status, 200);
    const secondAdmin = await login('identity-outsider@example.com');
    const race = await Promise.all([
      change(admin, admin.user.id, 'student'),
      change(secondAdmin, secondAdmin.user.id, 'student'),
    ]);
    assert.deepEqual(race.map(r => r.status).sort(), [200,409]);
    assert.equal(await dataSource.getRepository(User).countBy({ role:'admin' }), 1);
    const demoted = race[0].status === 200 ? admin : secondAdmin;
    const survivor = race[0].status === 200 ? secondAdmin : admin;
    assert.equal((await request('/me', { token:demoted.accessToken })).status, 401);
    assert.equal((await change(demoted, teacher.user.id, 'admin')).status, 401);
    if (demoted.user.id === staleActor.id) {
      await assert.rejects(() => roleService.changeRole(staleActor, teacher.user.id, { role:'admin' }), /Session revoked/);
    }
    assert.equal((await change(survivor, teacher.user.id, 'student')).status, 200);
    assert.equal((await request('/test-access/teacher', { token:teacher.accessToken })).status, 401);
    const formerTeacher = await login('identity-student@example.com');
    assert.equal((await request('/test-access/teacher', { token:formerTeacher.accessToken })).status, 403);
    console.log('PASS simultaneous admin demotions retain one admin and stale privileges cannot continue');

    for (const audience of ['student','teacher','admin']) {
      const doc = await request('/docs/' + audience + '/openapi.json');
      assert.equal(doc.status, 200);
      assert.ok(doc.data.paths['/me']);
      assert.equal(Boolean(doc.data.paths['/teacher/classes']), audience === 'teacher');
      for (const path of ['/classes/mine','/classes/history','/classes/join','/classes/leave']) {
        assert.equal(Boolean(doc.data.paths[path]), audience === 'student');
      }
      for (const path of ['/teacher/classes/{id}/members','/teacher/classes/{id}/members/{studentId}']) {
        assert.equal(Boolean(doc.data.paths[path]), audience === 'teacher');
      }
      assert.equal(Boolean(doc.data.paths['/content']), audience === 'student');
      assert.equal(Boolean(doc.data.paths['/content/{id}']), audience === 'student');
      for (const path of ['/admin/content','/admin/content/{id}/versions/{version}/publish','/admin/adventure/path','/admin/rules','/admin/rules/effective']) {
        assert.equal(Boolean(doc.data.paths[path]), audience === 'admin', path);
      }
      for (const path of ['/teacher/assignments','/teacher/assignments/{id}','/teacher/assignments/{id}/cancel','/teacher/assignments/{id}/progress']) {
        assert.equal(Boolean(doc.data.paths[path]), audience === 'teacher', path);
      }
      for (const path of ['/assignments/mine','/assignments/mine/{id}']) assert.equal(Boolean(doc.data.paths[path]), audience === 'student', path);
      assert.equal(Boolean(doc.data.paths['/adventure/map']), audience === 'student');
      assert.equal(Boolean(doc.data.paths['/teacher/content']), audience === 'teacher');
      assert.equal(Boolean(doc.data.paths['/teacher/content/{id}']), audience === 'teacher');
      if (audience === 'student') {
        assert.ok(doc.data.components.schemas.ContentDto.properties.unityId);
        assert.deepEqual(doc.data.paths['/classes/join'].post.security,[{bearer:[]}]);
        assert.ok(doc.data.paths['/classes/join'].post.responses['404']);
        assert.ok(doc.data.components.schemas.JoinClassDto);
        assert.ok(doc.data.components.schemas.CurrentMembershipDto.properties.membership.nullable);
      }
      if(audience === 'teacher') assert.deepEqual(doc.data.paths['/teacher/classes'].post.security,[{bearer:[]}]);
      assert.equal(Boolean(doc.data.paths['/me'].patch), audience === 'student');
      assert.ok(doc.data.components.securitySchemes.bearer);
      assert.deepEqual(doc.data.paths['/me'].get.security, [{ bearer:[] }]);
      assert.equal(Boolean(doc.data.paths['/admin/users/{id}/role']), audience === 'admin');
      assert.equal(Boolean(doc.data.paths['/test-access/teacher']), false);
    }
    console.log('PASS audience-specific OpenAPI schemas and Bearer security');
  } finally { await app.close(); }
};
