export function positiveSetting(name: string, fallback: number, maximum: number): number {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) throw new Error('Invalid ' + name);
  return n;
}
export const developmentOtpEnabled = () => process.env.NODE_ENV === 'development' && process.env.AUTH_DEV_OTP_ENABLED === 'true';
export function otpSecret(): string {
  const secret = process.env.AUTH_OTP_SECRET ?? (process.env.NODE_ENV === 'development' ? process.env.JWT_SECRET : undefined);
  if (!secret || secret.length < 32) throw new Error('AUTH_OTP_SECRET must contain at least 32 characters');
  return secret;
}
