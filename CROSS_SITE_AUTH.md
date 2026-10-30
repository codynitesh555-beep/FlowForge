# Browser authentication across Vercel and Render

FlowForge's default Vercel (`*.vercel.app`) and Render (`*.onrender.com`)
domains are cross-site. The API refresh token therefore uses a production
cookie with `SameSite=None; Secure; HttpOnly`, no `Domain` attribute, and the
restricted `/v1/auth` path. Frontend code cannot read the refresh token; do not
copy it into localStorage or sessionStorage.

The browser must make credentialed requests (`credentials: include`). Refresh
requests must also send `X-FlowForge-CSRF: 1`. Because this is a non-simple
header, browsers preflight the request; API CORS allows credentials and this
header only for explicitly configured origins. The API independently checks
that `Origin` exactly matches an entry in `CORS_ALLOWED_ORIGINS` and rejects a
missing or untrusted origin. Registration, login, and logout also require an
allowlisted Origin. Do not use wildcard origins.

This design prevents another website from using an ambient refresh cookie to
rotate a session: HTML forms cannot set the required header, and an untrusted
site cannot pass the exact-origin check or credentialed CORS preflight. The
header value is a CSRF request marker, not a secret or authentication token.
This does not protect against script execution on the allowlisted frontend
(XSS) or a compromised allowed origin.

Some browsers or privacy modes block third-party cookies even with
`SameSite=None; Secure`. In those browsers, refresh-cookie persistence across
the default Vercel and Render domains may not work. Test target browsers before
release. If broad browser support is required, use frontend and API custom
domains under the same registrable domain or introduce a same-origin backend
proxy/BFF; neither is provisioned by this repository.

Swagger UI and OpenAPI JSON remain available in development and test, and are
disabled in production. Production API responses use a restrictive Helmet
Content Security Policy (`default-src 'none'` plus framing/object/base
restrictions); the API does not serve the frontend. The development Swagger UI
continues to use Helmet without CSP so its interactive assets can load.
