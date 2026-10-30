import { z } from 'zod';

export interface ApiConfiguration {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly accessTokenSecret: string;
  readonly tokenIssuer: string;
  readonly tokenAudience: string;
  readonly accessTokenLifetimeSeconds: number;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly host: string;
  readonly port: number;
  readonly smtpUrl?: string;
  readonly smtpFrom?: string;
  readonly publicAppUrl?: string;
}

function parseOrigins(value: string | undefined): ReadonlySet<string> {
  const entries = (value ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim()).filter(Boolean);
  const origins = new Set<string>();
  for (const entry of entries) {
    let url: URL;
    try { url = new URL(entry); } catch { throw new Error('CORS_ALLOWED_ORIGINS must contain absolute origins.'); }
    if (url.origin !== entry || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain canonical HTTP(S) origins without paths.');
    }
    origins.add(entry);
  }
  if (origins.size === 0) throw new Error('CORS_ALLOWED_ORIGINS must not be empty.');
  return origins;
}

export function loadApiConfiguration(source: Readonly<Record<string, string | undefined>> = process.env): ApiConfiguration {
  const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    ACCESS_TOKEN_SECRET: z.string().min(32),
    ACCESS_TOKEN_ISSUER: z.string().min(1).default('flowforge'),
    ACCESS_TOKEN_AUDIENCE: z.string().min(1).default('flowforge-api'),
    ACCESS_TOKEN_LIFETIME_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
    CORS_ALLOWED_ORIGINS: z.string().optional(),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    SMTP_URL: z.string().url().optional(),
    SMTP_FROM: z.string().email().optional(),
    PUBLIC_APP_URL: z.string().url().optional(),
  }).safeParse(source);
  if (!schema.success) throw new Error('Authentication/API environment configuration is invalid.');
  if (schema.data.ACCESS_TOKEN_SECRET === 'REPLACE_WITH_AT_LEAST_32_RANDOM_BYTES') {
    throw new Error('ACCESS_TOKEN_SECRET must be replaced with a private random value.');
  }
  if (schema.data.NODE_ENV === 'production' && !schema.data.CORS_ALLOWED_ORIGINS) {
    throw new Error('CORS_ALLOWED_ORIGINS is required in production.');
  }
  const hasMailConfig = Boolean(schema.data.SMTP_URL && schema.data.SMTP_FROM && schema.data.PUBLIC_APP_URL);
  if (schema.data.NODE_ENV === 'production' && !hasMailConfig) {
    throw new Error('Secure SMTP, sender, and public application URL configuration is required in production.');
  }
  const allowedOrigins = parseOrigins(schema.data.CORS_ALLOWED_ORIGINS);
  if (schema.data.NODE_ENV === 'production' && [...allowedOrigins].some((origin) => !origin.startsWith('https://'))) {
    throw new Error('CORS_ALLOWED_ORIGINS must use HTTPS in production.');
  }
  if (hasMailConfig) {
    const smtp = new URL(schema.data.SMTP_URL!);
    const web = new URL(schema.data.PUBLIC_APP_URL!);
    if (!['smtp:', 'smtps:'].includes(smtp.protocol) || smtp.search || smtp.hash || (smtp.pathname !== '' && smtp.pathname !== '/') ||
      (schema.data.NODE_ENV === 'production' && smtp.protocol !== 'smtps:')) {
      throw new Error('Production SMTP must use SMTPS.');
    }
    if (web.protocol !== 'https:' && !(schema.data.NODE_ENV !== 'production' && web.hostname === 'localhost')) {
      throw new Error('PUBLIC_APP_URL must use HTTPS outside local development.');
    }
  }
  return Object.freeze({
    nodeEnv: schema.data.NODE_ENV,
    accessTokenSecret: schema.data.ACCESS_TOKEN_SECRET,
    tokenIssuer: schema.data.ACCESS_TOKEN_ISSUER,
    tokenAudience: schema.data.ACCESS_TOKEN_AUDIENCE,
    accessTokenLifetimeSeconds: schema.data.ACCESS_TOKEN_LIFETIME_SECONDS,
    allowedOrigins,
    host: schema.data.API_HOST,
    port: schema.data.API_PORT,
    ...(hasMailConfig ? { smtpUrl: schema.data.SMTP_URL, smtpFrom: schema.data.SMTP_FROM, publicAppUrl: schema.data.PUBLIC_APP_URL } : {}),
  });
}
