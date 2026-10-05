import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { positiveSetting } from './auth.config';

@Injectable()
export class EmailService {
  async sendCode(email: string, code: string, lifetimeSeconds: number, purpose: 'sign-in' | 'password-reset' = 'sign-in'): Promise<void> {
    const host = process.env.SMTP_HOST;
    const from = process.env.SMTP_FROM;
    if (!host || !from) throw new ServiceUnavailableException('Email delivery is not configured');
    const secure = process.env.SMTP_SECURE === 'true';
    const insecureLocal = process.env.NODE_ENV !== 'production' &&
      process.env.SMTP_ALLOW_INSECURE_LOCAL === 'true' && ['127.0.0.1','::1','localhost'].includes(host);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    if (Boolean(user) !== Boolean(pass)) throw new ServiceUnavailableException('Incomplete SMTP authentication configuration');
    const transport = createTransport({
      host, port: positiveSetting('SMTP_PORT', secure ? 465 : 587, 65535), secure,
      requireTLS: !secure && !insecureLocal,
      ignoreTLS: insecureLocal && !secure,
      auth: user && pass ? { user, pass } : undefined,
      tls: { minVersion: 'TLSv1.2' },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      disableFileAccess: true, disableUrlAccess: true,
      logger: false, debug: false,
    });
    try {
      const info = await transport.sendMail({
        from, to: email, subject: purpose === 'sign-in' ? 'Hodhod sign-in code' : 'Hodhod password reset code',
        text: 'Your Hodhod ' + (purpose === 'sign-in' ? 'sign-in' : 'password reset') + ' code is: ' + code +
          '\nExpires in ' + Math.ceil(lifetimeSeconds / 60) + ' minutes. Do not share this code.',
      });
      if (info.rejected.length || !info.accepted.length) throw new Error('Recipient not accepted');
    } catch {
      // Do not leak SMTP credentials, addresses or OTPs through errors or logs.
      throw new ServiceUnavailableException('Email delivery is temporarily unavailable');
    } finally { transport.close(); }
  }
}
