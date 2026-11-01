import type { Plugin } from 'vite';
import horaires from './static/horaires.json' with { type: 'json' };
import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Deux cibles de build (même principe que ParcPilote) :
 * - par défaut : PWA installable (service worker, manifeste, CSP stricte script-src 'self') ;
 * - "single" : un seul fichier HTML autonome (aperçu hébergé). Les scripts y sont en ligne,
 *   la CSP de la page hôte s'applique alors.
 *
 * Aucune requête vers un tiers : connect-src limité à 'self' (EXG-01, EXG-05).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Service worker généré au build : met en cache la coquille de l'appli (fonctionnement hors ligne). */
function serviceWorker(): Plugin {
  // horaires.json : horaires théoriques régénérés à chaque publication (scripts/extraire_horaires.py).
  const PUBLIC_FILES = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'horaires.json'];
  return {
    name: 'chassebonsplans-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = ['./', './index.html', ...Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => `./${f}`), ...PUBLIC_FILES.map((f) => `./${f}`)];
      const unique = [...new Set(files)];
      let h = 2166136261;
      // Le contenu des horaires entre dans la version : des horaires renouvelés installent un nouveau cache.
      for (const ch of unique.join('|') + JSON.stringify(horaires)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      const version = (h >>> 0).toString(36);
      const source = `/* Chasse aux bons plans — service worker généré au build. */
const CACHE = 'chassebonsplans-${version}';
const PRECACHE = ${JSON.stringify(unique)};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('chassebonsplans-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))));
    return;
  }
  event.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

function pwaHtml(isSingle: boolean): Plugin {
  return {
    name: 'chassebonsplans-html',
    transformIndexHtml(html) {
      if (isSingle) {
        return html.replace(/\s*<!--PWA-HEAD-->[\s\S]*?<!--\/PWA-HEAD-->/, '');
      }
      return html
        .replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}">`)
        .replace(/<!--\/?PWA-HEAD-->/g, '');
    },
  };
}

export default defineConfig(({ mode }) => {
  const isSingle = mode === 'single';
  return {
    base: './',
    plugins: [preact(), pwaHtml(isSingle), ...(isSingle ? [viteSingleFile()] : [serviceWorker()])],
    define: {
      __PWA__: JSON.stringify(!isSingle),
    },
    publicDir: isSingle ? false : 'static',
    build: {
      outDir: isSingle ? 'dist-single' : 'dist',
      target: 'es2022',
      sourcemap: false,
      assetsInlineLimit: isSingle ? 100_000_000 : 4096,
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
