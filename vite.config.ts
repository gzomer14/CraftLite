import { defineConfig } from 'vite';
import { relative, resolve } from 'node:path';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

// Alvo es2017: roda em WebView do Android 7+ (ver doc 01 §1).
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  build: {
    target: 'es2017',
    // Um unico arquivo facilita medir o orcamento e reduz round-trips em 3G.
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 300,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        entryFileNames: 'a/[hash].js',
        chunkFileNames: 'a/[hash].js',
        assetFileNames: 'a/[hash][extname]',
      },
    },
    minify: 'esbuild',
  },
  esbuild: {
    legalComments: 'none',
  },
  worker: {
    format: 'es',
  },
  server: { host: true },
  plugins: [
    {
      // O service worker versiona o cache pelo build (doc 11 §7). Injetar o
      // hash aqui evita que o jogador fique preso numa versão antiga.
      name: 'craftlite-sw-version',
      apply: 'build',
      closeBundle(): void {
        const dist = resolve(__dirname, 'dist');
        const path = resolve(dist, 'sw.js');
        try {
          const source = readFileSync(path, 'utf8');
          const version = Date.now().toString(36);
          // A lista de assets vai para o precache do SW: sem ela, "instalei o
          // PWA" não significava "funciona offline" — o bundle só entrava no
          // cache depois de uma partida com rede.
          const assets = listAssets(dist, dist)
            .filter((file) => file !== 'sw.js' && file !== 'index.html'
              && file !== 'manifest.webmanifest')
            .map((file) => `./${file}`);
          writeFileSync(
            path,
            source
              .replace('self.__CRAFTLITE_VERSION__', JSON.stringify(version))
              .replace('self.__CRAFTLITE_ASSETS__', JSON.stringify(assets)),
          );
        } catch {
          // Sem sw.js no dist (build de biblioteca, por exemplo): nada a fazer.
        }
      },
    },
  ],
});

/** Todos os arquivos de `dir`, em caminhos relativos a `root`, com `/`. */
function listAssets(dir: string, root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listAssets(full, root));
    else out.push(relative(root, full).split('\\').join('/'));
  }
  return out;
}
