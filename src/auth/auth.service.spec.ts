import { developmentOtpEnabled, otpSecret, positiveSetting } from './auth.config';

describe('Authentication configuration', () => {
  const previous = { ...process.env };
  afterEach(() => { process.env = { ...previous }; });
  it.each(['production','test'])('never enables fixed OTP in %s', env => {
    process.env.NODE_ENV=env; process.env.AUTH_DEV_OTP_ENABLED='true';
    expect(developmentOtpEnabled()).toBe(false);
  });
  it('requires both development and an explicit flag', () => {
    process.env.NODE_ENV='development'; process.env.AUTH_DEV_OTP_ENABLED='false';
    expect(developmentOtpEnabled()).toBe(false);
    process.env.AUTH_DEV_OTP_ENABLED='true'; expect(developmentOtpEnabled()).toBe(true);
  });
  it('rejects unsafe or missing secrets outside development', () => {
    process.env.NODE_ENV='production'; delete process.env.AUTH_OTP_SECRET;
    expect(() => otpSecret()).toThrow();
    process.env.AUTH_OTP_SECRET='short'; expect(() => otpSecret()).toThrow();
  });
  it('bounds numeric settings', () => {
    process.env.AUTH_OTP_TTL_SECONDS='0'; expect(() => positiveSetting('AUTH_OTP_TTL_SECONDS',300,900)).toThrow();
    process.env.AUTH_OTP_TTL_SECONDS='901'; expect(() => positiveSetting('AUTH_OTP_TTL_SECONDS',300,900)).toThrow();
  });
});
