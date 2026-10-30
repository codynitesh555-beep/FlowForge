import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Set the production file before the compiled entry point imports dotenv/config.
// When deployment injects secrets directly, dotenv leaves those values intact.
process.env.DOTENV_CONFIG_PATH ??= resolve(process.cwd(), '.env.production.local');
await import(pathToFileURL(resolve(process.cwd(), 'dist/api/main.js')).href);
