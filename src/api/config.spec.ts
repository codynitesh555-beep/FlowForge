import { describe, expect, it } from 'vitest';
import { loadApiConfiguration } from './config.js';

const productionEnvironment = (overrides: Record<string, string> = {}) => ({
  NODE_ENV: 'production',
  ACCESS_TOKEN_SECRET: 'a-secure-random-production-secret-with-at-least-32-characters',
  CORS_ALLOWED_ORIGINS: 'https://app.example.com',
  SMTP_URL: 'smtps://example-user:example-password@smtp.example.com:465',
  SMTP_FROM: 'no-reply@example.com',
  PUBLIC_APP_URL: 'https://app.example.com',
  ...overrides,
});

describe('API production configuration', () => {
  it('accepts HTTPS application origins with secure mail configuration', () => {
    const configuration = loadApiConfiguration(productionEnvironment());

    expect(configuration.allowedOrigins).toEqual(new Set(['https://app.example.com']));
  });

  it('rejects HTTP origins in production even when they are canonical', () => {
    expect(() => loadApiConfiguration(productionEnvironment({
      CORS_ALLOWED_ORIGINS: 'http://app.example.com',
    }))).toThrow('CORS_ALLOWED_ORIGINS must use HTTPS in production.');
  });

  it('rejects a mixed secure and insecure production origin list', () => {
    expect(() => loadApiConfiguration(productionEnvironment({
      CORS_ALLOWED_ORIGINS: 'https://app.example.com,http://legacy.example.com',
    }))).toThrow('CORS_ALLOWED_ORIGINS must use HTTPS in production.');
  });
});
