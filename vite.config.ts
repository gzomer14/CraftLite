import { defineConfig } from 'vite';
import { relative, resolve } from 'node:path';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

/** A sala na rede local (M20): o pedaço que o jogo baixa só ao abrir ou entrar numa sala. */
const NET_ENTRY = resolve(__dirname, 'src/net/room.ts');
let netChunkRef = '';

// Alvo es2017: roda em WebView do Android 7+ (ver doc 01 §1).
export default defineConfig(({ command }) => ({
  base: './',
  /*
   * No servidor de desenvolvimento, a sala vem do fonte; no build, o plugin
   * `craftlite-net-chunk` troca o nome pela URL do pedaço emitido.
   */
  define: command === 'serve' ? { __CRAFTLITE_NET_URL__: JSON.stringify('/src/net/room.ts') } : {},
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
      // Dois pontos de entrada (M21): o jogo, e o dos mods, que baixa os mods
      // e depois importa o jogo. O `index.html` escolhe entre os dois.
      input: {
        index: resolve(__dirname, 'index.html'),
        main: resolve(__dirname, 'src/main.ts'),
        modboot: resolve(__dirname, 'src/mods/boot.ts'),
        // Prova de conexão do M20 (M20.0): página à parte, sem o jogo.
        rede: resolve(__dirname, 'rede.html'),
      },
      output: {
        // `a/` é o jogo; `m/` é o que só baixa com mod ligado. O relatório de
        // tamanho e o precache do service worker separam pela pasta.
        // `n/` é a página de rede (M20.0), que o jogo também não baixa.
        entryFileNames: (chunk) => (chunk.name === 'modboot' ? 'm/[hash].js'
          : chunk.name === 'rede' ? 'n/[hash].js' : 'a/[hash].js'),
        // Pedaço compartilhado não tem fachada: vale o que ele contém.
        chunkFileNames: (chunk) => (isModChunk(chunk.facadeModuleId) ? 'm/[hash].js'
          : isNetChunk(chunk.facadeModuleId) || chunk.moduleIds.every((id) => isNetChunk(id))
            ? 'n/[hash].js' : 'a/[hash].js'),
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
    rollupOptions: {
      output: {
        // O worker com mods e tudo o que ele divide (o worker de sempre, como
        // pedaço, e cada mod) vão para `m/`: sem mod, nada disso é baixado.
        entryFileNames: (chunk) => (chunk.name === 'chunk.modworker'
          ? 'm/[name]-[hash].js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'm/[hash].js',
      },
    },
  },
  server: { host: true },
  plugins: [
    {
      /*
       * O pedaço de rede (M20). Ele é emitido daqui, "carregado depois do
       * `main`": o Rollup entrega o que ele usa a partir do próprio `main`, que
       * já está na memória. E o `game/netgate.ts` o importa por uma URL em
       * variável, que o Vite não embrulha em `__vitePreload` — esse ajudante,
       * usado também pelo ponto de entrada dos mods, viraria um pedaço
       * compartilhado que o jogo sozinho teria de baixar.
       */
      name: 'craftlite-net-chunk',
      apply: 'build',
      buildStart() {
        netChunkRef = this.emitFile({
          type: 'chunk', id: NET_ENTRY, implicitlyLoadedAfterOneOf: [resolve(__dirname, 'src/main.ts')],
          // Ninguém importa estas funções pelo nome: sem isto, o Rollup as jogaria fora.
          preserveSignature: 'exports-only',
        });
      },
      transform(code, id) {
        if (!id.endsWith('src/game/netgate.ts')) return null;
        return code.split('__CRAFTLITE_NET_URL__').join(`import.meta.ROLLUP_FILE_URL_${netChunkRef}`);
      },
    },
    {
      /*
       * Mods (M21). O `index.html` não tem `<script type="module" src>`: um
       * script de poucas linhas lê a lista de mods no `localStorage` e sobe o
       * jogo (`main`) ou o ponto de entrada dos mods (`modboot`) — e, se este
       * não carregar (ligado sem rede, fora do precache), o jogo sem mod. No build, os
       * dois caminhos de fonte viram os arquivos finais, e o `main` ganha um
       * `modulepreload` no `<head>` — a busca dele começa no mesmo instante em
       * que começava quando era a tag do `<head>`, e o jogo sem mod não espera
       * nem um arquivo a mais.
       */
      name: 'craftlite-mod-entry',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          if (!ctx.filename.endsWith('index.html')) return html;
          const files = new Map<string, string>();
          for (const chunk of Object.values(ctx.bundle ?? {})) {
            if (chunk.type === 'chunk' && chunk.isEntry) files.set(chunk.name, chunk.fileName);
          }
          const main = files.get('main');
          const modboot = files.get('modboot');
          if (main === undefined || modboot === undefined) {
            throw new Error('craftlite-mod-entry: faltou o pedaço main ou modboot no bundle');
          }
          // O `main` aparece duas vezes: o caminho sem mod e a volta para ele
          // quando o ponto de entrada dos mods não carrega (offline, sem cache).
          return html
            .split("'/src/main.ts'").join(`'./${main}'`)
            .replace("'/src/mods/boot.ts'", `'./${modboot}'`)
            .replace('</title>', `</title>\n<link rel="modulepreload" crossorigin href="./${main}">`);
        },
      },
    },
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
          // O que é de mod (`m/`) fica fora: entra no cache quando o jogador
          // liga o mod e o arquivo passa pela rede (stale-while-revalidate).
          // A sala na rede local (`n/`, M20) entra: numa rede Wi-Fi sem
          // internet, ela precisa funcionar sem nunca ter sido baixada antes.
          // Custa ~20 KB em segundo plano na instalação, fora da abertura.
          // A página de prova (`rede.html`) fica fora.
          const assets = listAssets(dist, dist)
            .filter((file) => file !== 'sw.js' && file !== 'index.html'
              && file !== 'manifest.webmanifest' && !file.startsWith('m/') && file !== 'rede.html')
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
}));

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

/** Pedaço que só existe por causa de um mod (`src/mods/<id>/`). */
function isModChunk(facade: string | null): boolean {
  return facade !== null && /[\\/]src[\\/]mods[\\/][^\\/]+[\\/]/.test(facade);
}

/** Pedaço da página de rede (`src/net/`). */
function isNetChunk(facade: string | null): boolean {
  return facade !== null && /[\\/]src[\\/]net[\\/]/.test(facade);
}
