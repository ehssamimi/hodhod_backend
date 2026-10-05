// BE-24 / BE-22: the three OpenAPI documents are separate, complete and match the running API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ request }) => {
  const docs = {};
  for (const audience of ['student', 'teacher', 'admin']) {
    const ui = await fetch(request.baseUrl + '/docs/' + audience);
    assert.equal(ui.status, 200, audience + ' UI page');
    const json = await request('/docs/' + audience + '/openapi.json');
    assert.equal(json.status, 200);
    docs[audience] = json.data;
  }

  const ready = await request('/health/ready');
  assert.deepEqual([ready.status, ready.data], [200, { status: 'ready' }]);
  assert.deepEqual((await request('/health')).data, { status: 'ok' });

  const shared = path => path.startsWith('/health') || path.startsWith('/auth/') || path === '/me';
  const audienceOf = p => p.startsWith('/teacher/') ? 'teacher' : p.startsWith('/admin/') ? 'admin' : shared(p) ? 'shared' : 'student';
  const ops = [];
  for (const [audience, doc] of Object.entries(docs)) {
    assert.equal(doc.info.title, `Hodhod ${audience} API`);
    assert.ok(doc.components.securitySchemes.bearer, 'Bearer scheme');
    for (const [p, item] of Object.entries(doc.paths)) {
      // Each endpoint appears only on its own page; auth, profile and health are shared by design.
      assert.ok(['shared', audience].includes(audienceOf(p)), `${p} must not be on the ${audience} page`);
      for (const [method, op] of Object.entries(item)) ops.push({ audience, p, method: method.toUpperCase(), op, doc });
    }
  }
  // Every endpoint of each family is documented on the page of its audience.
  const expected = {
    student: ['/student/auth/request-code', '/student/auth/verify-code', '/student/auth/login/password', '/student/auth/password/set', '/student/auth/password/change', '/student/auth/password/reset/request-code', '/student/auth/password/reset/confirm', '/classes/mine', '/classes/join', '/content', '/adventure/map', '/assignments/mine', '/attempts', '/feedback', '/streak', '/leaderboards/global', '/leaderboards/class'],
    teacher: ['/teacher/auth/request-code', '/teacher/auth/verify-code', '/teacher/auth/login/password', '/teacher/auth/password/set', '/teacher/auth/password/change', '/teacher/auth/password/reset/request-code', '/teacher/auth/password/reset/confirm', '/teacher/classes', '/teacher/content', '/teacher/assignments', '/teacher/feedback', '/teacher/reports/students/{studentId}'],
    admin: ['/admin/auth/request-code', '/admin/auth/verify-code', '/admin/auth/login/password', '/admin/auth/password/set', '/admin/auth/password/change', '/admin/auth/password/reset/request-code', '/admin/auth/password/reset/confirm', '/admin/content', '/admin/adventure/path', '/admin/rules', '/admin/users', '/admin/users/{id}', '/admin/users/{id}/role', '/admin/feedback', '/admin/suspicious-events', '/admin/overview', '/admin/audit'],
  };
  for (const [audience, paths] of Object.entries(expected)) for (const p of paths) assert.ok(docs[audience].paths[p], `${p} missing on ${audience}`);
  assert.equal(Object.keys(docs.student.paths).some(p => p.startsWith('/teacher/') || p.startsWith('/admin/')), false);
  assert.equal(Object.keys(docs.teacher.paths).some(p => p.startsWith('/admin/') || p.startsWith('/attempts')), false);
  assert.equal(Object.keys(docs.admin.paths).some(p => p.startsWith('/teacher/') || p.startsWith('/attempts')), false);

  const resolve = (doc, schema) => schema?.$ref ? doc.components.schemas[schema.$ref.split('/').pop()] : schema;
  const problems = [];
  for (const { audience, p, method, op, doc } of ops) {
    const id = `${audience} ${method} ${p}`;
    const publicRoleAuth = /^\/(student|teacher|admin)\/auth\/(request-code|verify-code|login\/password|password\/reset\/(request-code|confirm))$/.test(p);
    const publicRoute = p.startsWith('/health') || ['/auth/request-code', '/auth/verify-code'].includes(p) || publicRoleAuth;
    if (!op.summary) problems.push(id + ': no summary');
    if (!op.tags?.length) problems.push(id + ': no tag');
    const codes = Object.keys(op.responses);
    if (!codes.some(c => /^2/.test(c))) problems.push(id + ': no success response');
    if (!publicRoute) {
      if (!op.security?.some(s => s.bearer)) problems.push(id + ': not marked as Bearer-secured');
      if (!codes.includes('401')) problems.push(id + ': no 401 response');
    }
    if (!publicRoute && p.startsWith('/teacher/') && !codes.includes('403')) problems.push(id + ': no 403 response');
    if (!publicRoute && p.startsWith('/admin/') && !codes.includes('403')) problems.push(id + ': no 403 response');
    // Endpoints that read an id or filter document the 400 they can return.
    if ((op.parameters ?? []).length && !codes.includes('400')) problems.push(id + ': parameters but no 400 response');
    for (const param of (p.match(/\{(\w+)\}/g) ?? [])) {
      if (!(op.parameters ?? []).some(x => x.in === 'path' && `{${x.name}}` === param)) problems.push(id + ': undocumented path parameter ' + param);
    }
    // Success bodies have schemas.
    for (const code of codes.filter(c => /^2/.test(c) && c !== '204')) {
      const content = op.responses[code].content?.['application/json'];
      if (!content?.schema && !p.startsWith('/health')) problems.push(`${id}: ${code} without a response schema`);
    }
    // Request bodies: every property is described by an example, enum, format, constraint or description.
    const body = op.requestBody?.content?.['application/json']?.schema;
    if (body) {
      const schema = resolve(doc, body);
      for (const [name, prop] of Object.entries(schema.properties ?? {})) {
        const hint = prop.example !== undefined || prop.enum || prop.format || prop.description || prop.minimum !== undefined || prop.maxLength !== undefined || prop.$ref || prop.items;
        if (!hint) problems.push(`${id}: request property "${name}" has no example or description`);
      }
    }
  }
  assert.deepEqual(problems, [], 'OpenAPI contract problems:\n' + problems.join('\n'));

  // Attempt and error contracts that clients rely on are documented.
  const attempts = docs.student.paths['/attempts'].post;
  assert.ok(attempts.responses['201'] && attempts.responses['200'] && attempts.responses['409'] && attempts.responses['429'] !== undefined || attempts.responses['409']);
  assert.ok(docs.student.components.schemas.AttemptResultDto.properties.duplicate);
  assert.ok(docs.student.components.schemas.SubmitAttemptDto.properties.attemptId.example);

  // Separate, client-usable files for the three consumers.
  const out = process.env.OPENAPI_EXPORT_DIR;
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    for (const [audience, doc] of Object.entries(docs)) fs.writeFileSync(path.join(out, audience + '.openapi.json'), JSON.stringify(doc, null, 2) + '\n');
  }
  console.log(`PASS BE-24/BE-22 three separate OpenAPI documents: ${ops.length} operations complete (summary, Bearer, 401/403/400, schemas, examples)` + (out ? `; exported to ${out}` : ''));
};
