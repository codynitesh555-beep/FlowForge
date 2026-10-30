import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { productionApiBaseUrl } from './src/config/frontend-api-url.js';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, 'web', 'VITE_');
  productionApiBaseUrl(mode, environment.VITE_API_BASE_URL);

  return {
    root: 'web',
    plugins: [react()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { outDir: '../dist/web', emptyOutDir: true },
  };
});
