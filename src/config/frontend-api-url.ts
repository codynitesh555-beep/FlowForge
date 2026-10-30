import { isIP } from 'node:net';

export function validateProductionApiBaseUrl(value: string | undefined): string {
  if (!value || value !== value.trim()) {
    throw new Error('VITE_API_BASE_URL is required for production builds.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('VITE_API_BASE_URL must be an absolute HTTPS URL in production.');
  }

  const trailingSlash = url.pathname === '/' ? value.endsWith('/') : url.pathname.endsWith('/');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || trailingSlash) {
    throw new Error('VITE_API_BASE_URL must be an HTTPS API base URL without credentials, query, or trailing slash.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipv4Parts = hostname.split('.').map(Number);
  const isIpv4Loopback = isIP(hostname) === 4 && ipv4Parts[0] === 127;
  const normalizedHostname = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (hostname.endsWith('.') || normalizedHostname === 'localhost' || normalizedHostname.endsWith('.localhost') || isIpv4Loopback || hostname === '::1') {
    throw new Error('VITE_API_BASE_URL must not target a loopback host in production.');
  }

  return value;
}

export function productionApiBaseUrl(mode: string, value: string | undefined): string | undefined {
  return mode === 'production' ? validateProductionApiBaseUrl(value) : value;
}
