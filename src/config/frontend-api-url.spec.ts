import { describe, expect, it } from 'vitest';
import { productionApiBaseUrl, validateProductionApiBaseUrl } from './frontend-api-url.js';

describe('frontend production API URL', () => {
  it('requires a configured HTTPS API URL for production builds', () => {
    expect(() => productionApiBaseUrl('production', undefined)).toThrow(/VITE_API_BASE_URL is required/);
    expect(productionApiBaseUrl('production', 'https://api.flowforge.example')).toBe('https://api.flowforge.example');
  });

  it('rejects loopback API URLs in production', () => {
    for (const value of [
      'https://localhost:3000',
      'https://127.0.0.1:3000',
      'https://127.10.20.30:3000',
      'https://[::1]:3000',
      'https://api.localhost:3000',
      'https://localhost.:3000',
    ]) {
      expect(() => validateProductionApiBaseUrl(value)).toThrow(/loopback/);
    }
  });

  it('rejects non-HTTPS and malformed API URLs in production', () => {
    expect(() => validateProductionApiBaseUrl('http://api.flowforge.example')).toThrow(/HTTPS/);
    expect(() => validateProductionApiBaseUrl('not a url')).toThrow(/absolute HTTPS URL/);
  });

  it('preserves the local development fallback without requiring production configuration', () => {
    expect(productionApiBaseUrl('development', undefined)).toBeUndefined();
    expect(productionApiBaseUrl('development', 'http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000');
  });
});
