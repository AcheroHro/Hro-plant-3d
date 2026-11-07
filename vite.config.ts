import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Genera /sw.js en el build con la lista de archivos a guardar en el teléfono para trabajar sin
 * señal: el JS/CSS del build, el motor SQLite (wasm), las specs integradas y los íconos.
 */
function serviceWorker(): Plugin {
  return {
    name: 'achero-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const pub = readdirSync(resolve(__dirname, 'public')).filter(
        (f) => !f.includes('-debug') && /\.(wasm|pspc|pspx|json|png|svg|ico)$/.test(f)
      );
      const urls = ['/', '/index.html', ...pub.map((f) => `/${f}`), ...built.filter((f) => f !== 'index.html').map((f) => `/${f}`)];
      const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const source = readFileSync(resolve(__dirname, 'pwa/sw.js'), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify([...new Set(urls)], null, 1));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      this.emitFile({ type: 'asset', fileName: 'version.txt', source: version });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorker()],
  define: {
    __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' '))
  },
  server: {
    port: 3000,
    open: false,
    host: true
  },
  preview: {
    port: 4173,
    host: true
  }
});
