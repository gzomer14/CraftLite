/**
 * Teste de aceitação do M32 (interface nova): **nenhuma tela rola** num
 * celular deitado.
 *
 * Abre cada tela do jogo — título, opções (cada aba), mods, texturas, mundos,
 * criar, mochila, livro de receitas, bancada, fornalha, baú, encantamento,
 * bigorna, preparo, pausa, conquistas, estatísticas, criativo e morte — em
 * 640×360 (T0 deitado) e 844×390 (celular comum deitado), e falha se:
 *
 * - a página ou a raiz da tela rolam;
 * - algum elemento rola que não esteja na lista `LISTAS` abaixo;
 * - alguma caixa visível — painel, botão, o ✕, a própria lista — passa da
 *   borda da tela (cortada, que é rolar sem barra).
 *
 * As `LISTAS` são as caixas que **rolam por dentro de propósito**, com a
 * moldura parada em volta: a lista de receitas, as conquistas, a lista de uma
 * aba de opções e a grade do criativo. O que está dentro delas não precisa
 * caber na tela — precisa caber a caixa.
 *
 * Mesmo arranjo do `smoke.mjs`: serve o `dist/`, sobe o Chrome em headless e
 * dirige a página pelo protocolo de depuração. Os cliques de menu são nos
 * botões de verdade; o que não tem botão sem teclado (pausa, morte, abrir uma
 * bancada) vai pelo gancho `?smoke`.
 *
 * Uso: `npm run build && npm run ui:fit`. Sai com código 1 se alguma tela não couber.
 *
 * **A fonte importa.** O Chrome do CI (Ubuntu) cai na DejaVu Sans, bem mais larga que a Inter
 * ou a Roboto: a primeira rodada do PR #12 falhou lá e passava aqui. Para medir como o CI, aponte
 * o `FONTCONFIG_FILE` para um `fonts.conf` que prefira a DejaVu Sans para `system-ui` e
 * `sans-serif` (e rejeite a Inter) antes do `npm run ui:fit`.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { conectar } from './cdp.mjs';
import { chromeBin, chromeFlags } from './chrome.mjs';

const DIST = join(process.cwd(), 'dist');
const PORTA_CDP = Number(process.env.UI_FIT_CDP_PORT ?? 9338);
const TAMANHOS = [[640, 360], [844, 390]];

/** Caixas que rolam por dentro de propósito (ver o comentário do topo). */
const LISTAS = [
  '.recipe-book .list',
  '#pause-menu .achievements',
  '#options-screen .opt-pane',
  '#creative-screen .items',
];

const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

/** Servidor estático mínimo do `dist/`. */
function servir() {
  const server = createServer((req, res) => {
    const caminho = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    let arquivo = join(DIST, caminho);
    if (!arquivo.startsWith(DIST)) { res.writeHead(403).end(); return; }
    if (existsSync(arquivo) && statSync(arquivo).isDirectory()) arquivo = join(arquivo, 'index.html');
    if (!existsSync(arquivo)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' });
    res.end(readFileSync(arquivo));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ate(cdp, expressao, limite = 60000, passo = 300) {
  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    const v = await cdp.avaliar(expressao).catch(() => false);
    if (v) return v;
    await esperar(passo);
  }
  throw new Error(`tempo esgotado esperando: ${expressao.slice(0, 80)}`);
}

/** Script de página: achar botão pelo texto e medir a tela aberta. */
const HELPERS = `(() => {
  if (window.__fit !== undefined) return true;
  const fit = { erros: [] };
  window.__fit = fit;
  addEventListener('error', (e) => fit.erros.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => fit.erros.push('promise: ' + String(e.reason)));
  fit.botao = (raiz, texto) =>
    [...raiz.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(texto));
  fit.clicar = (seletor, texto) => {
    const raiz = document.querySelector(seletor);
    const b = texto === undefined ? raiz : fit.botao(raiz, texto);
    if (b === null || b === undefined) throw new Error('sem botão: ' + seletor + ' ' + (texto ?? ''));
    b.click();
    return true;
  };
  const nome = (el) => el.id ? '#' + el.id : (typeof el.className === 'string' && el.className !== ''
    ? el.tagName.toLowerCase() + '.' + el.className.trim().split(/\\s+/).join('.') : el.tagName.toLowerCase());
  /** Problemas da tela \`id\`, ou lista vazia se ela cabe. */
  fit.medir = (id, listas) => {
    const raiz = document.getElementById(id);
    if (raiz === null || raiz.hidden) return ['tela ' + id + ' não está aberta'];
    const dentroDeLista = (el) => listas.some((s) => el.closest(s) !== null);
    const problemas = [];
    const doc = document.scrollingElement;
    if (doc.scrollHeight > innerHeight + 1) problemas.push('a página rola: ' + doc.scrollHeight + ' > ' + innerHeight);
    for (const el of [raiz, ...raiz.querySelectorAll('*')]) {
      if (el.getClientRects().length === 0) continue;
      const st = getComputedStyle(el);
      const rola = (st.overflowY === 'auto' || st.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2;
      if (rola && !listas.some((s) => el.matches(s))) {
        problemas.push(nome(el) + ' rola: ' + el.clientHeight + '/' + el.scrollHeight);
      }
      /*
       * Fora da tela é rolar sem barra. Vale para **toda** caixa visível —
       * inclusive a própria lista, que tem de caber inteira —, menos o que
       * está dentro de uma lista: ali o que sobra rola de propósito.
       */
      if (el.type === 'file' || (el.parentElement !== null && dentroDeLista(el.parentElement))) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1) {
        const rotulo = (el.getAttribute('aria-label') || el.textContent || el.placeholder || '').trim().slice(0, 30);
        problemas.push(nome(el) + ' "' + rotulo + '" fora da tela: ' + Math.round(r.top) + '…' + Math.round(r.bottom)
          + ' × ' + Math.round(r.left) + '…' + Math.round(r.right));
      }
    }
    return problemas;
  };
  return true;
})()`;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ não existe: rode `npm run build` antes.');
  process.exit(1);
}

const server = await servir();
const url = `http://127.0.0.1:${server.address().port}/?smoke`;
const perfil = mkdtempSync(join(tmpdir(), 'craftlite-ui-fit-'));
const chrome = spawn(chromeBin(), [...chromeFlags(),
  '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${perfil}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1280,720',
  '--lang=pt-BR', url,
  // Os botões são achados pelo texto em português: ver `smoke.mjs`.
], { stdio: 'ignore', env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } });

const falhas = [];
let telas = 0;
let cdp;

async function tamanho(w, h) {
  await cdp.enviar('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 2, mobile: true,
    screenOrientation: { type: 'landscapePrimary', angle: 90 },
  });
  await cdp.avaliar("dispatchEvent(new Event('resize')), true");
  await esperar(350);
}

/** Mede a tela `id` nos dois tamanhos e volta ao primeiro. */
async function conferir(nome, id) {
  telas++;
  for (const [w, h] of TAMANHOS) {
    await tamanho(w, h);
    const problemas = JSON.parse(await cdp.avaliar(`JSON.stringify(__fit.medir(${JSON.stringify(id)}, ${JSON.stringify(LISTAS)}))`));
    const ok = problemas.length === 0;
    console.log(`${ok ? '✓' : '✗'} ${nome} em ${w}×${h}${ok ? '' : ' — ' + problemas.slice(0, 4).join('; ')}`);
    if (!ok) falhas.push(`${nome} ${w}×${h}`);
  }
  await tamanho(...TAMANHOS[0]);
}

const js = (corpo) => cdp.avaliar(`(() => { ${corpo}; return true; })()`);

try {
  cdp = await conectar(PORTA_CDP);
  await cdp.enviar('Runtime.enable');
  await cdp.enviar('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await ate(cdp, "document.readyState === 'complete' && document.getElementById('title-screen') !== null");
  await cdp.avaliar(HELPERS);
  await tamanho(...TAMANHOS[0]);

  // Antes do mundo: título e o que sai dele.
  await conferir('título', 'title-screen');
  await js("__fit.clicar('#title-screen', 'Opções')");
  for (const aba of ['Vídeo', 'Som', 'Controles', 'Jogo', 'Acessibilidade', 'Idioma']) {
    await js(`__fit.clicar('#options-screen .opt-tabs', ${JSON.stringify(aba)})`);
    await conferir(`opções › ${aba}`, 'options-screen');
  }
  await js("__fit.clicar('#options-screen .cl-close')");
  await js("__fit.clicar('#title-screen', 'Mods')");
  await conferir('mods', 'mods-screen');
  await js("__fit.clicar('#mods-screen .cl-close')");
  await js("__fit.clicar('#title-screen', 'Texturas')");
  await ate(cdp, "!document.getElementById('packs-screen').hidden", 10000);
  await conferir('texturas', 'packs-screen');
  await js("__fit.clicar('#packs-screen .cl-close')");

  // Sem mundo ainda, JOGAR leva à lista.
  await js("__fit.clicar('#title-screen', 'Jogar')");
  await ate(cdp, "!document.getElementById('worlds-screen').hidden", 10000);
  await conferir('mundos (vazio)', 'worlds-screen');
  await js("__fit.clicar('#worlds-screen', 'Criar novo')");
  await esperar(300);
  await conferir('criar mundo', 'worlds-screen');
  await js("__fit.clicar('#worlds-screen .more-toggle')");
  await esperar(200);
  await conferir('criar mundo › mais opções', 'worlds-screen');
  await js("__fit.clicar('#worlds-screen', 'Criar e jogar')");
  await ate(cdp, '(() => { const c = window.__craftlite; if (!c) return false; c.player.flying = false; return c.player.onGround === true; })()', 120000);
  await esperar(1500);
  await cdp.avaliar(HELPERS);

  // No mundo: as janelas de contêiner.
  await js(`const { session, items } = window.__craftlite;
    ['oak_planks', 'stick', 'cobblestone', 'iron_ingot', 'bread', 'torch', 'diamond_pickaxe', 'oak_log', 'coal']
      .forEach((n, i) => session.inventory.set(i, { item: items.get(n).id, count: 12, damage: 0 }))`);
  await js('window.__craftlite.session.workbench.toggleInventory()');
  await ate(cdp, "!document.getElementById('container-screen').hidden", 10000);
  await conferir('mochila', 'container-screen');
  await js("__fit.clicar('#container-screen .book-toggle')");
  await conferir('mochila › receitas', 'container-screen');
  await js("__fit.clicar('#container-screen .cl-close')");

  for (const [nome, bloco] of [['bancada', 'crafting_table'], ['fornalha', 'furnace'], ['baú', 'chest'],
    ['encantamento', 'enchanting_table'], ['bigorna', 'anvil'], ['preparo', 'brewing_stand']]) {
    await js(`const { world, session, player, items } = window.__craftlite;
      const x = Math.floor(player.x) + 2, y = Math.floor(player.y), z = Math.floor(player.z);
      const id = items.get(${JSON.stringify(bloco)}).placesBlock;
      world.setBlock(x, y, z, id, 'player');
      session.tiles.create(x, y, z, id);
      session.workbench.open(x, y, z)`);
    await ate(cdp, "!document.getElementById('container-screen').hidden", 10000);
    await conferir(nome, 'container-screen');
    await js("__fit.clicar('#container-screen .cl-close')");
  }

  // Pausa e as duas folhas dela.
  await js('window.__craftlite.flow.togglePause()');
  await conferir('pausa', 'pause-menu');
  await js("__fit.clicar('#pause-menu .pause-tiles', 'Conquistas')");
  await conferir('pausa › conquistas', 'pause-menu');
  await js("__fit.clicar('#pause-menu .back')");
  await js("__fit.clicar('#pause-menu .pause-tiles', 'Estatísticas')");
  await conferir('pausa › estatísticas', 'pause-menu');
  await js("__fit.clicar('#pause-menu .back')");
  await js("__fit.clicar('#pause-menu', 'Continuar')");

  // Criativo.
  await js(`const c = window.__craftlite; c.player.mode = 'creative'; c.flow.toggleInventory()`);
  await ate(cdp, "!document.getElementById('creative-screen').hidden", 10000);
  await conferir('criativo', 'creative-screen');
  await js("__fit.clicar('#creative-screen .cl-close')");
  await js("window.__craftlite.player.mode = 'survival'");

  // Morte.
  await js("window.__craftlite.session.survival.damage(500, 'void', true)");
  await ate(cdp, "!document.getElementById('death-screen').hidden", 10000);
  await conferir('morte', 'death-screen');
  await js("__fit.clicar('#death-screen', 'Reaparecer')");

  const erros = JSON.parse(await cdp.avaliar('JSON.stringify(__fit.erros)'));
  if (erros.length > 0) {
    console.log(`✗ erros na página: ${erros.join(' | ')}`);
    falhas.push('erros na página');
  }
  console.log(`\nencaixe: ${telas} telas × ${TAMANHOS.length} tamanhos — ${falhas.length === 0 ? 'nenhuma rola' : `${falhas.length} falha(s)`}`);
  if (falhas.length > 0) process.exitCode = 1;
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  cdp?.fechar?.();
  chrome.kill();
  server.close();
}
