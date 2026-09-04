/**
 * Typed, validated environment configuration.
 *
 * Every process (api, worker, web) imports from here rather than reading
 * process.env directly. A missing or malformed variable fails loudly at
 * boot instead of surfacing as `undefined` three layers deep at 2am.
 */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { resolve } from 'node:path';

loadDotenv({ path: resolve(process.cwd(), '../../.env') });
loadDotenv();

const booleanish = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .or(z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  /** 32-byte base64 key protecting stored platform session cookies. */
  PF_ENCRYPTION_KEY: z.string().min(32, 'PF_ENCRYPTION_KEY must be a 32-byte base64 string'),

  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().url(),

  API_PORT: z.coerce.number().int().positive().default(3001),
  API_URL: z.string().url(),
  WEB_URL: z.string().url(),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  S3_FORCE_PATH_STYLE: booleanish.default(true),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  PLAYWRIGHT_HEADLESS: booleanish.default(true),
  RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),

  QUOTA_CONNECTIONS_PER_DAY: z.coerce.number().int().nonnegative().default(20),
  QUOTA_MESSAGES_PER_DAY: z.coerce.number().int().nonnegative().default(30),
  QUOTA_PROFILE_VIEWS_PER_DAY: z.coerce.number().int().nonnegative().default(80),
  QUOTA_POSTS_PER_DAY: z.coerce.number().int().nonnegative().default(3),
  PACING_MIN_MS: z.coerce.number().int().nonnegative().default(8_000),
  PACING_MAX_MS: z.coerce.number().int().nonnegative().default(25_000),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        'Copy .env.example to .env and fill in the missing values.',
    );
  }
  return parsed.data;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
