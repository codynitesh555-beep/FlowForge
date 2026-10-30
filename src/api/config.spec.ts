import { describe, expect, it } from 'vitest';
import { loadApiConfiguration } from './config.js';

const productionEnvironment = (overrides: Record<string, string> = {}) => ({
  NODE_ENV: 'production',
  PORT: '10000',
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

  it('binds on all interfaces and uses Render’s injected PORT in production', () => {
    const configuration = loadApiConfiguration(productionEnvironment({
      PORT: '18080',
      API_PORT: '3000',
    }));

    expect(configuration.host).toBe('0.0.0.0');
    expect(configuration.port).toBe(18080);
  });

  it('requires PORT in production', () => {
    const { PORT: _port, ...withoutPort } = productionEnvironment();

    expect(() => loadApiConfiguration(withoutPort)).toThrow('PORT is required in production.');
  });

  it('rejects a production API_HOST that would bind only to loopback', () => {
    expect(() => loadApiConfiguration(productionEnvironment({ API_HOST: '127.0.0.1' })))
      .toThrow('API_HOST must be 0.0.0.0 in production.');
  });
});

describe('API development configuration', () => {
  const developmentEnvironment = (overrides: Record<string, string> = {}) => ({
    NODE_ENV: 'development',
    ACCESS_TOKEN_SECRET: 'a-secure-random-development-secret-with-at-least-32-characters',
    ...overrides,
  });

  it('preserves loopback host and port defaults', () => {
    const configuration = loadApiConfiguration(developmentEnvironment());

    expect(configuration.host).toBe('127.0.0.1');
    expect(configuration.port).toBe(3000);
  });

  it('continues to honor development API_HOST and API_PORT', () => {
    const configuration = loadApiConfiguration(developmentEnvironment({ API_HOST: '0.0.0.0', API_PORT: '4321', PORT: '9000' }));

    expect(configuration.host).toBe('0.0.0.0');
    expect(configuration.port).toBe(4321);
  });
});
