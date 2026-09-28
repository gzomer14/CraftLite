/**
 * Quanto custa tocar nas telas de inventário num aparelho fraco (T0).
 *
 * Abre um mundo, a mochila e o livro de receitas num Chrome headless com a CPU
 * **6× mais lenta** (`Emulation.setCPUThrottlingRate`) e mede, até o segundo
 * quadro depois da ação: abrir o livro, tocar numa receita, tocar num slot.
 *
 * Existe por causa do relato de 2026-09-28 no J7 Metal: cada toque levava 5–10 s,
 * porque a folha de sprites ia ao CSS como `data:` URL de ~480 mil caracteres
 * (~3 000 ms por ação aqui). Com `blob:` URL, ~100 ms. O orçamento é 600 ms.
 *
 * Uso: `npm run build && npm run bench:ui` (`CHROME` aponta o navegador).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { conectar } from './cdp.mjs';

const DIST = join(process.cwd(), 'dist');
const PORTA_CDP = Number(process.env.BENCH_CDP_PORT ?? 9336);

function chromeBin() {
  const env = process.env.CHROME;
  if (env !== undefined && env !== '') return env;
  for (const caminho of [
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ]) {
    if (existsSync(caminho)) return caminho;
  }
  throw new Error('Chrome não encontrado — aponte com a variável CHROME');
}

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

/** Script de página: helpers e o registro de erros, instalado a cada carga. */
const HELPERS = `(() => {
  if (window.__smoke !== undefined) return true;
  const smoke = { erros: [] };
  window.__smoke = smoke;
  addEventListener('error', (e) => smoke.erros.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => smoke.erros.push('promise: ' + String(e.reason)));
  smoke.tecla = (tipo, code) =>
    window.dispatchEvent(new KeyboardEvent(tipo, { code, key: code, bubbles: true }));
  smoke.botao = (raiz, texto) =>
    [...raiz.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(texto));
  smoke.visivel = (id) => { const e = document.getElementById(id); return e !== null && !e.hidden ? e : null; };
  return true;
})()`;

const server = await servir();
const url = `http://127.0.0.1:${server.address().port}/?smoke`;
const chrome = spawn(chromeBin(), [
  '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bench-'))}`,
  '--no-first-run', '--window-size=1280,720', '--lang=pt-BR', url,
], { stdio: 'ignore', env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } });
const cdp = await conectar(PORTA_CDP);
try {
  await cdp.enviar('Runtime.enable');
  await ate(cdp, "document.readyState === 'complete' && document.getElementById('title-screen') !== null");
  await cdp.avaliar(HELPERS);
  await cdp.avaliar(`(async () => {
    const s = window.__smoke;
    s.botao(document.getElementById('title-screen'), 'Jogar').click();
    await new Promise((r) => setTimeout(r, 500));
    const mundos = document.getElementById('worlds-screen');
    s.botao(mundos, 'Criar novo').click();
    await new Promise((r) => setTimeout(r, 400));
    const textos = [...mundos.querySelectorAll('input')].filter((c) => c.type !== 'file');
    textos[0].value = 'Bench'; textos[0].dispatchEvent(new Event('input', { bubbles: true }));
    s.botao(mundos, 'Criar e jogar').click();
    return true;
  })()`);
  await ate(cdp, "window.__craftlite !== undefined && window.__craftlite.player.onGround === true", 120000);
  // Madeira na mochila: há receitas disponíveis.
  await cdp.avaliar(`(() => { const c = window.__craftlite; c.session.inventory.set(0, { item: c.items.get('oak_log').id, count: 16, damage: 0 }); return true; })()`);
  await cdp.avaliar("__smoke.tecla('keydown', 'KeyE'); __smoke.tecla('keyup', 'KeyE'); true");
  await ate(cdp, "__smoke.visivel('container-screen') !== null", 10000);
  const medir = `(async () => {
    const tela = document.getElementById('container-screen');
    const livro = [...tela.querySelectorAll('button')].find((b) => /Receitas/.test(b.textContent));
    const quadro = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const tempos = {};
    let t = performance.now();
    livro.click(); await quadro();
    tempos.abrirLivro = Math.round(performance.now() - t);
    const receita = tela.querySelector('.recipe-book .recipe:not(.missing)') ?? tela.querySelector('.recipe-book .recipe');
    t = performance.now();
    receita.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    receita.click(); await quadro();
    tempos.tocarReceita = Math.round(performance.now() - t);
    const slot = tela.querySelector('.slot');
    t = performance.now();
    slot.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, isPrimary: true }));
    slot.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, isPrimary: true }));
    await quadro();
    tempos.tocarSlot = Math.round(performance.now() - t);
    livro.click(); await quadro();
    tempos.botoes = tela.querySelectorAll('.recipe-book .recipe').length;
    return JSON.stringify(tempos);
  })()`;
  await cdp.enviar('Emulation.setCPUThrottlingRate', { rate: 6 });
  const rodadas = [];
  for (let i = 0; i < 3; i++) rodadas.push(JSON.parse(await cdp.avaliar(medir)));
  const pior = Math.max(...rodadas.flatMap((r) => [r.abrirLivro, r.tocarReceita, r.tocarSlot]));
  for (const r of rodadas) console.log(`abrir o livro ${r.abrirLivro} ms · tocar numa receita ${r.tocarReceita} ms · tocar num slot ${r.tocarSlot} ms (${r.botoes} receitas)`);
  const sheet = await cdp.avaliar("getComputedStyle(document.documentElement).getPropertyValue('--item-sheet').trim().slice(0, 9)");
  console.log(`folha de sprites no CSS: ${sheet}…`);
  console.log(`
pior ação, CPU 6× mais lenta: ${pior} ms (orçamento 600 ms) — ${pior <= 600 ? 'ok' : 'ESTOUROU'}`);
  if (pior > 600) process.exitCode = 1;
} finally {
  cdp.fechar?.();
  chrome.kill();
  server.close();
}
