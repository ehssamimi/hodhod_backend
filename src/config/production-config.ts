// Refuses to start a non-development server with a development-grade or incomplete configuration.
// Only names are reported, never values.
const secretProblem = (env: NodeJS.ProcessEnv, name: string): string | undefined =>
  !env[name] || env[name]!.length < 32 ? `${name} must contain at least 32 characters` : undefined;

export function productionConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  // "development" and "test" are the only relaxed modes; an unset NODE_ENV is treated as production.
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return [];
  const problems: Array<string | undefined> = [];
  if (env.NODE_ENV !== 'production') problems.push('NODE_ENV must be "production" (or "development" for local work)');
  problems.push(secretProblem(env, 'JWT_SECRET'), secretProblem(env, 'AUTH_OTP_SECRET'));
  if (env.JWT_SECRET && env.JWT_SECRET === env.AUTH_OTP_SECRET) problems.push('AUTH_OTP_SECRET must differ from JWT_SECRET');
  if (env.AUTH_DEV_OTP_ENABLED === 'true') problems.push('AUTH_DEV_OTP_ENABLED must not be true');
  for (const name of ['DATABASE_HOST', 'DATABASE_USER', 'DATABASE_PASSWORD', 'DATABASE_NAME', 'SMTP_HOST', 'SMTP_FROM']) {
    if (!env[name]) problems.push(`${name} is required`);
  }
  if (env.DATABASE_PASSWORD === 'hodhod_local_only') problems.push('DATABASE_PASSWORD must not be the local development password');
  if (env.DATABASE_PASSWORD && env.DATABASE_PASSWORD.length < 16) problems.push('DATABASE_PASSWORD must contain at least 16 characters');
  if (env.SMTP_ALLOW_INSECURE_LOCAL === 'true') problems.push('SMTP_ALLOW_INSECURE_LOCAL must not be true');
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) problems.push('SMTP_USER and SMTP_PASSWORD must be set together');
  for (const name of ['SCORING_STAR_POINTS', 'STREAK_DAILY_POINTS']) {
    // Reward tables are a product decision: warn by failing only on malformed values.
    if (env[name] !== undefined && !/^[0-9, ]+$/.test(env[name]!)) problems.push(`${name} is malformed`);
  }
  return problems.filter((problem): problem is string => Boolean(problem));
}

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const problems = productionConfigProblems(env);
  if (problems.length) throw new Error('Refusing to start with an unsafe configuration:\n - ' + problems.join('\n - '));
}
