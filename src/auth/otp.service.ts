import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { developmentOtpEnabled, otpSecret, positiveSetting } from './auth.config';
import { EmailService } from './email.service';

@Injectable()
export class OtpService {
  constructor(private readonly source: DataSource, private readonly email: EmailService) {}

  private hash(value: string): string { return createHmac('sha256', otpSecret()).update(value).digest('hex'); }

  private async limit(scope: string, value: string, seconds: number, maximum: number): Promise<void> {
    // Committed independently so failed OTP/email attempts still consume their budget.
    const rows: Array<{ hits: number }> = await this.source.query(`
      INSERT INTO auth_rate_limits(bucket) VALUES ($1)
      ON CONFLICT (bucket) DO UPDATE SET
        hits = CASE WHEN auth_rate_limits.window_start <= now() - $2 * interval '1 second' THEN 1 ELSE auth_rate_limits.hits + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start <= now() - $2 * interval '1 second' THEN now() ELSE auth_rate_limits.window_start END
      RETURNING hits
    `, [scope + ':' + this.hash(value), seconds]);
    if (rows[0].hits > maximum) throw new HttpException('Too many authentication attempts; try again later', HttpStatus.TOO_MANY_REQUESTS);
  }

  async requestCode(email: string, ip: string): Promise<{ message: string }> {
    await this.limit('request-ip', ip, 3600, positiveSetting('AUTH_REQUEST_IP_LIMIT', 20, 10000));
    await this.limit('request-email-hour', email, 3600, positiveSetting('AUTH_REQUEST_EMAIL_LIMIT', 5, 100));
    await this.limit('request-email-cooldown', email, positiveSetting('AUTH_OTP_COOLDOWN_SECONDS', 60, 3600), 1);
    if (developmentOtpEnabled()) return { message: 'Development verification code is 11111' };
    const lifetime = positiveSetting('AUTH_OTP_TTL_SECONDS', 300, 900);
    const requestId = randomUUID();
    const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const digest = this.hash(email + ':' + requestId + ':' + code);
    await this.source.query(`
      INSERT INTO auth_email_codes(email,request_id,code_hash,expires_at)
      VALUES ($1,$2,$3,now() + $4 * interval '1 second')
      ON CONFLICT (email) DO UPDATE SET request_id=EXCLUDED.request_id, code_hash=EXCLUDED.code_hash,
        expires_at=EXCLUDED.expires_at, attempts=0, consumed_at=NULL, created_at=now()
    `, [email,requestId,digest,lifetime]);
    try { await this.email.sendCode(email,code,lifetime); }
    catch (error) {
      await this.source.query('DELETE FROM auth_email_codes WHERE email=$1 AND request_id=$2', [email,requestId]);
      throw error;
    }
    return { message: 'If delivery succeeds, a sign-in code will arrive shortly' };
  }

  async limitVerification(email: string, ip: string): Promise<void> {
    await this.limit('verify-ip', ip, 300, positiveSetting('AUTH_VERIFY_IP_LIMIT', 30, 10000));
    await this.limit('verify-email', email, 300, positiveSetting('AUTH_VERIFY_EMAIL_LIMIT', 10, 100));
  }

  async consume(manager: EntityManager, email: string, code: string): Promise<boolean> {
    if (developmentOtpEnabled()) return code === '11111';
    const rows: Array<{ request_id: string; code_hash: string; attempts: number; valid: boolean }> = await manager.query(`
      SELECT request_id,code_hash,attempts,(expires_at > now() AND consumed_at IS NULL) AS valid
      FROM auth_email_codes WHERE email=$1 FOR UPDATE
    `, [email]);
    const row = rows[0];
    if (!row?.valid || row.attempts >= positiveSetting('AUTH_OTP_MAX_ATTEMPTS', 5, 10)) return false;
    const supplied = this.hash(email + ':' + row.request_id + ':' + code);
    if (!/^\d{6}$/.test(code) || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(row.code_hash, 'hex'))) {
      await manager.query('UPDATE auth_email_codes SET attempts=attempts+1 WHERE email=$1', [email]);
      return false;
    }
    await manager.query('UPDATE auth_email_codes SET consumed_at=now() WHERE email=$1', [email]);
    return true;
  }
}
