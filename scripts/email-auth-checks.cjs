const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { SMTPServer } = require('smtp-server');

module.exports = async function emailAuthChecks(source) {
  const previous = { ...process.env };
  const messages = [];
  let rejectDelivery = false;
  const smtp = new SMTPServer({ disabledCommands:['AUTH','STARTTLS'],
    onData(stream, session, callback) {
      let raw=''; stream.on('data',chunk=>{raw+=chunk.toString();});
      stream.on('end',()=> {
        if (rejectDelivery) return callback(new Error('Temporary test failure'));
        messages.push({ to:session.envelope.rcptTo[0].address,raw }); callback();
      });
    },
  });
  await new Promise(resolve=>smtp.listen(0,'127.0.0.1',resolve));
  process.env.NODE_ENV='test'; process.env.AUTH_DEV_OTP_ENABLED='false';
  process.env.AUTH_OTP_SECRET=randomUUID()+randomUUID();
  process.env.SMTP_HOST='127.0.0.1'; process.env.SMTP_PORT=String(smtp.server.address().port);
  process.env.SMTP_FROM='Hodhod <no-reply@hodhod.test>';
  process.env.SMTP_ALLOW_INSECURE_LOCAL='true'; process.env.SMTP_SECURE='false';
  delete process.env.SMTP_USER; delete process.env.SMTP_PASSWORD;
  process.env.AUTH_VERIFY_IP_LIMIT='100';
  const { Test } = require('@nestjs/testing');
  const { ValidationPipe } = require('@nestjs/common');
  const { DataSource } = require('typeorm');
  const { AppModule } = require('../src/app.module');
  const { EmailService } = require('../src/auth/email.service');
  const { OtpService } = require('../src/auth/otp.service');
  const testing = await Test.createTestingModule({imports:[AppModule]})
    .overrideProvider(DataSource).useValue(source).compile();
  const app=testing.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  try {
    await app.listen(0,'127.0.0.1');
    const port=app.getHttpServer().address().port;
    async function request(url,body,token,method='POST') {
      const response=await fetch('http://127.0.0.1:'+port+url,{method,
        headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
        body:body===undefined?undefined:JSON.stringify(body)});
      return {status:response.status,data:response.status===204?null:await response.json()};
    }
    const resetLimits=()=>source.query('TRUNCATE auth_rate_limits');
    const verify=(email,code)=>request('/auth/verify-code',{email,code});
    async function issueAt(path,email) {
      const before=messages.length;
      const response=await request(path,{email});
      assert.equal(response.status,201,JSON.stringify(response.data));
      assert.equal(messages.length,before+1);
      const message=messages.at(-1);
      assert.equal(message.to,email.toLowerCase());
      const code=/code is: (\d{6})/.exec(message.raw)?.[1];
      assert.ok(code,'SMTP message contains a six-digit code');
      assert.equal(JSON.stringify(response.data).includes(code),false);
      return code;
    }
    const issue=email=>issueAt('/auth/request-code',email);
    const email='email-student@example.com';
    const code=await issue(email);
    const saved=(await source.query('SELECT * FROM auth_email_codes WHERE email=$1',[email]))[0];
    assert.match(saved.code_hash,/^[a-f0-9]{64}$/);
    assert.notEqual(saved.code_hash,code);
    assert.ok(saved.expires_at>new Date());
    assert.equal((await request('/auth/request-code',{email})).status,429);
    const login=await verify(email,code);assert.equal(login.status,201,JSON.stringify(login.data));
    assert.equal(login.data.user.role,'student');
    assert.equal((await verify(email,code)).status,401);
    assert.equal((await request('/me',undefined,login.data.accessToken,'GET')).status,200);
    console.log('PASS real loopback SMTP delivery, hashed expiring OTP, cooldown, login and replay rejection');

    await resetLimits();
    const lockedEmail='locked@example.com';const lockedCode=await issue(lockedEmail);
    const wrong=lockedCode==='000000'?'999999':'000000';
    for(let i=0;i<5;i++)assert.equal((await verify(lockedEmail,wrong)).status,401);
    assert.equal((await source.query('SELECT attempts FROM auth_email_codes WHERE email=$1',[lockedEmail]))[0].attempts,5);
    // Recreating the service does not reset the persisted attempts or rate limits.
    const recreated=new OtpService(source,new EmailService());
    assert.equal(await source.transaction(manager=>recreated.consume(manager,lockedEmail,lockedCode)),false);
    assert.equal((await verify(lockedEmail,lockedCode)).status,401);
    const expiredEmail='expired@example.com';const expiredCode=await issue(expiredEmail);
    await source.query("UPDATE auth_email_codes SET expires_at=now()-interval '1 second' WHERE email=$1",[expiredEmail]);
    assert.equal((await verify(expiredEmail,expiredCode)).status,401);
    const resendEmail='resend@example.com';const old=await issue(resendEmail);
    const oldId=(await source.query('SELECT request_id FROM auth_email_codes WHERE email=$1',[resendEmail]))[0].request_id;
    await resetLimits();const newer=await issue(resendEmail);
    assert.notEqual((await source.query('SELECT request_id FROM auth_email_codes WHERE email=$1',[resendEmail]))[0].request_id,oldId);
    if(old!==newer)assert.equal((await verify(resendEmail,old)).status,401);
    const race=await Promise.all([verify(resendEmail,newer),verify(resendEmail,newer)]);
    assert.deepEqual(race.map(r=>r.status).sort(),[201,401]);
    console.log('PASS durable guess limits, expiry, resend invalidation and concurrent one-time consumption');

    await resetLimits();process.env.AUTH_REQUEST_IP_LIMIT='2';
    await issue('ip-one@example.com');await issue('ip-two@example.com');
    assert.equal((await request('/auth/request-code',{email:'ip-three@example.com'})).status,429);
    process.env.AUTH_REQUEST_IP_LIMIT='20';
    await resetLimits();process.env.AUTH_REQUEST_EMAIL_LIMIT='1';
    await issue('quota@example.com');
    assert.equal((await request('/auth/request-code',{email:'quota@example.com'})).status,429);
    process.env.AUTH_REQUEST_EMAIL_LIMIT='5';
    await resetLimits();process.env.AUTH_VERIFY_IP_LIMIT='2';
    assert.equal((await verify('absent-one@example.com','000000')).status,401);
    assert.equal((await verify('absent-two@example.com','000000')).status,401);
    assert.equal((await verify('absent-three@example.com','000000')).status,429);
    process.env.AUTH_VERIFY_IP_LIMIT='100';
    await resetLimits();process.env.AUTH_VERIFY_EMAIL_LIMIT='1';
    assert.equal((await verify('absent@example.com','000000')).status,401);
    assert.equal((await verify('absent@example.com','000000')).status,429);
    process.env.AUTH_VERIFY_EMAIL_LIMIT='10';
    console.log('PASS request and verification limits by both email and IP');

    await resetLimits();
    const beforeFailure=messages.length;rejectDelivery=true;
    assert.equal((await request('/auth/request-code',{email:'failure@example.com'})).status,503);
    assert.equal(messages.length,beforeFailure);
    assert.equal((await source.query('SELECT * FROM auth_email_codes WHERE email=$1',['failure@example.com'])).length,0);
    rejectDelivery=false;
    const productionEmail='production@example.com';const prodCode=await issue(productionEmail);
    process.env.NODE_ENV='production';process.env.AUTH_DEV_OTP_ENABLED='true';
    assert.equal((await verify(productionEmail,'11111')).status,401);
    assert.equal((await verify(productionEmail,prodCode)).status,201);
    await assert.rejects(()=>new EmailService().sendCode('tls@example.com','123456',300),/temporarily unavailable/);
    process.env.NODE_ENV='test';process.env.AUTH_DEV_OTP_ENABLED='false';
    console.log('PASS failed delivery invalidation, production fixed-code rejection and mandatory SMTP TLS');

    assert.equal((await request('/auth/logout',undefined,login.data.accessToken)).status,204);
    assert.equal((await request('/me',undefined,login.data.accessToken,'GET')).status,401);
    await resetLimits();const firstSession=await verify(email,await issue(email));
    await resetLimits();const secondSession=await verify(email,await issue(email));
    assert.equal(firstSession.status,201);assert.equal(secondSession.status,201);
    assert.equal((await request('/auth/logout-all',undefined,firstSession.data.accessToken)).status,204);
    for(const session of [firstSession,secondSession])assert.equal((await request('/me',undefined,session.data.accessToken,'GET')).status,401);
    await resetLimits();const expiring=await verify(email,await issue(email));
    await source.query("UPDATE auth_sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE user_id=$1",[expiring.data.user.id]);
    assert.equal((await request('/me',undefined,expiring.data.accessToken,'GET')).status,401);
    console.log('PASS logout, logout-all, fresh sign-in and database session expiry');

    const credentials = {
      student: { email:'password-student@example.com', password:'student password one', next:'student password two' },
      teacher: { email:'password-teacher@example.com', password:'teacher password one', next:'teacher password two' },
      admin: { email:'password-admin@example.com', password:'admin password one', next:'admin password two' },
    };
    await source.query("INSERT INTO users(email,role) VALUES ($1,'teacher'),($2,'admin')", [credentials.teacher.email,credentials.admin.email]);
    for (const [role, account] of Object.entries(credentials)) {
      await resetLimits();
      const code=await issueAt(`/${role}/auth/request-code`,account.email);
      const otpLogin=await request(`/${role}/auth/verify-code`,{email:account.email,code});
      assert.equal(otpLogin.status,201,`${role} OTP login: ${JSON.stringify(otpLogin.data)}`);
      assert.equal(otpLogin.data.user.role,role);
      assert.equal((await request('/me',undefined,otpLogin.data.accessToken,'GET')).data.hasPassword,false);
      assert.equal((await request(`/${role}/auth/password/set`,{newPassword:account.password},otpLogin.data.accessToken)).status,204);
      assert.equal((await request('/me',undefined,otpLogin.data.accessToken,'GET')).status,401,'set revokes the verified session');
      const stored=(await source.query('SELECT password_hash FROM users WHERE email=$1',[account.email]))[0].password_hash;
      assert.match(stored,/^scrypt\$16384\$8\$1\$/);assert.equal(stored.includes(account.password),false);
      await resetLimits();
      assert.equal((await request(`/${role}/auth/login/password`,{email:account.email,password:'wrong password'})).status,401);
      const passwordLogin=await request(`/${role}/auth/login/password`,{email:account.email,password:account.password});
      assert.equal(passwordLogin.status,201,`${role} password login: ${JSON.stringify(passwordLogin.data)}`);
      assert.equal(passwordLogin.data.user.role,role);
      assert.equal((await request('/me',undefined,passwordLogin.data.accessToken,'GET')).data.hasPassword,true);
      assert.equal((await request(`/${role}/auth/password/set`,{newPassword:account.next},passwordLogin.data.accessToken)).status,409);
      assert.equal((await request(`/${role}/auth/password/change`,{currentPassword:'wrong password',newPassword:account.next},passwordLogin.data.accessToken)).status,401);
      assert.equal((await request('/me',undefined,passwordLogin.data.accessToken,'GET')).status,200,'failed change preserves session');
      assert.equal((await request(`/${role}/auth/password/change`,{currentPassword:account.password,newPassword:account.next},passwordLogin.data.accessToken)).status,204);
      assert.equal((await request('/me',undefined,passwordLogin.data.accessToken,'GET')).status,401,'change revokes all sessions');
      await resetLimits();
      assert.equal((await request(`/${role}/auth/login/password`,{email:account.email,password:account.password})).status,401);
      assert.equal((await request(`/${role}/auth/login/password`,{email:account.email,password:account.next})).status,201);
    }
    console.log('PASS role-specific student, teacher and admin OTP login, password set/login/change, hashes and session revocation');

    const resetAccount=credentials.student;
    await resetLimits();
    const signInCode=await issueAt('/student/auth/request-code',resetAccount.email);
    const resetCode=await issueAt('/student/auth/password/reset/request-code',resetAccount.email);
    const purposes=await source.query('SELECT purpose FROM auth_email_codes WHERE email=$1 ORDER BY purpose',[resetAccount.email]);
    assert.deepEqual(purposes.map(row=>row.purpose),['password-reset','sign-in']);
    assert.equal((await request('/student/auth/password/reset/confirm',{
      email:resetAccount.email,code:signInCode,newPassword:'student password three'})).status,401);
    assert.equal((await request('/student/auth/password/reset/confirm',{
      email:resetAccount.email,code:resetCode,newPassword:'student password three'})).status,204);
    await resetLimits();
    assert.equal((await request('/student/auth/login/password',{email:resetAccount.email,password:resetAccount.next})).status,401);
    assert.equal((await request('/student/auth/login/password',{email:resetAccount.email,password:'student password three'})).status,201);
    const beforeUnknown=messages.length;
    assert.equal((await request('/teacher/auth/password/reset/request-code',{email:'unknown-teacher@example.com'})).status,201);
    assert.equal((await request('/teacher/auth/request-code',{email:'unknown-teacher@example.com'})).status,201);
    assert.equal(messages.length,beforeUnknown,'unknown privileged accounts do not receive codes');
    console.log('PASS purpose-separated reset code, password reset and non-disclosing privileged-account requests');
  } finally {
    await app.close();await new Promise(resolve=>smtp.close(resolve));process.env=previous;
  }
};
