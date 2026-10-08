import { defineConfig, type Plugin } from 'vite';
import { PAGE_SECURITY_HEADERS } from './shared/security';

function securityHeadersFile(): Plugin {
  return {
    name: 'bottle-security-headers',
    generateBundle() {
      const lines = Object.entries(PAGE_SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`);
      lines.push('  Strict-Transport-Security: max-age=31536000; includeSubDomains');
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: `/*\n${lines.join('\n')}\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [securityHeadersFile()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    sourcemap: false,
  },
});
