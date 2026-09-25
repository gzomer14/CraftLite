/**
 * Smoke test de navegador (doc 14, "Testes obrigatórios"): *"carregar a página,
 * criar mundo, andar 10 s, quebrar um bloco, salvar, recarregar, verificar que o
 * bloco continua quebrado"*.
 *
 * Não existia até 2026-09-22 — os 1800 testes do vitest rodam sem GL nem DOM, e
 * nenhum deles abre o jogo de verdade. Este abre: serve o `dist/` num servidor
 * estático do próprio Node, sobe o Chrome instalado em headless e dirige a
 * página pelo protocolo de depuração (`cdp.mjs`), como o `soak`.
 *
 * O jogo expõe `window.__craftlite` **só** com `?smoke` na URL (ver `main.ts`):
 * é por ele que o teste mira o bloco e confere o mundo depois de recarregar.
 * Os cliques de menu são de verdade, nos botões da tela.
 *
 * Uso: `npm run build && npm run smoke`. Sai com código 1 se algum passo falhar.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { conectar } from './cdp.mjs';

const DIST = join(process.cwd(), 'dist');
const PORTA_CDP = Number(process.env.SMOKE_CDP_PORT ?? 9334);

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

const passos = [];
function passo(nome, ok, detalhe = '') {
  passos.push({ nome, ok, detalhe });
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ' — ' + detalhe : ''}`);
  if (!ok) throw new Error(nome);
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ não existe: rode `npm run build` antes.');
  process.exit(1);
}

const server = await servir();
const url = `http://127.0.0.1:${server.address().port}/?smoke`;
const perfil = mkdtempSync(join(tmpdir(), 'craftlite-smoke-'));
const chrome = spawn(chromeBin(), [
  '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${perfil}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1280,720',
  '--autoplay-policy=no-user-gesture-required',
  '--lang=pt-BR', url,
  /*
   * Os cliques acham os botões pelo texto em português, e o idioma do jogo
   * segue o do navegador (M17): numa máquina em inglês ele abriria em inglês.
   * No Linux, quem decide o `navigator.language` do Chrome é o `LANG` do
   * ambiente — o `--lang` sozinho não basta.
   */
], { stdio: 'ignore', env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } });

let cdp;
try {
  cdp = await conectar(PORTA_CDP);
  await cdp.enviar('Runtime.enable');

  // 1. Carregar a página.
  await ate(cdp, "document.readyState === 'complete' && document.getElementById('title-screen') !== null");
  await cdp.avaliar(HELPERS);
  passo('a página carrega até a tela de título', true);

  // 2. Criar mundo (criativo, seed fixa), pelos botões de verdade.
  await cdp.avaliar(`(async () => {
    const s = window.__smoke;
    const titulo = document.getElementById('title-screen');
    s.botao(titulo, 'Jogar').click();
    await new Promise((r) => setTimeout(r, 500));
    const mundos = document.getElementById('worlds-screen');
    s.botao(mundos, 'Criar novo').click();
    await new Promise((r) => setTimeout(r, 400));
    const campos = [...mundos.querySelectorAll('input, select')].filter((c) => c.type !== 'file');
    const textos = campos.filter((c) => c.tagName === 'INPUT');
    const modo = campos.find((c) => c.tagName === 'SELECT' && [...c.options].some((o) => o.value === 'creative'));
    textos[0].value = 'Smoke'; textos[0].dispatchEvent(new Event('input', { bubbles: true }));
    textos[1].value = 'smoke-2026'; textos[1].dispatchEvent(new Event('input', { bubbles: true }));
    modo.value = 'creative'; modo.dispatchEvent(new Event('change', { bubbles: true }));
    s.botao(mundos, 'Criar e jogar').click();
    return true;
  })()`);
  // "Pisa" é `onGround`: o jogo só solta o jogador na gravidade quando o
  // terreno do nascimento chegou, e antes disso ele fica parado no ar. O
  // criativo nasce voando (doc 06 §9) — o voo é desligado para ele pousar.
  await ate(cdp, `(() => {
    const c = window.__craftlite;
    if (c === undefined) return false;
    c.player.flying = false;
    return c.player.onGround === true;
  })()`, 120000);
  passo('cria o mundo e o jogador pisa em chão carregado', true);

  // 3. Andar 10 s.
  const antes = JSON.parse(await cdp.avaliar('JSON.stringify([__craftlite.player.x, __craftlite.player.z])'));
  // Anda como gente: pula degrau (um toque de espaço por vez, longe do
  // anterior — dois em 300 ms ligam o voo) e vira 90° se empacar num tronco.
  const inicio = Date.now();
  let volta = 0;
  while (Date.now() - inicio < 10000) {
    await cdp.avaliar("__smoke.tecla('keydown', 'KeyW')");
    if (volta % 3 === 1) {
      await cdp.avaliar("__smoke.tecla('keydown', 'Space')");
      await esperar(120);
      await cdp.avaliar("__smoke.tecla('keyup', 'Space')");
    }
    if (volta % 6 === 5) await cdp.avaliar('__craftlite.player.yaw += Math.PI / 2');
    volta++;
    await esperar(400);
  }
  await cdp.avaliar("__smoke.tecla('keyup', 'KeyW')");
  const depois = JSON.parse(await cdp.avaliar('JSON.stringify([__craftlite.player.x, __craftlite.player.z])'));
  const andou = Math.hypot(depois[0] - antes[0], depois[1] - antes[1]);
  passo('anda 10 s', andou > 2, `${andou.toFixed(1)} blocos`);

  // 4. Quebrar um bloco: o que está debaixo dos pés, pelo caminho da interação.
  const alvo = JSON.parse(await cdp.avaliar(`(() => {
    const { session, player, world } = window.__craftlite;
    player.pitch = Math.PI / 2 - 0.01;
    session.interaction.updateTarget();
    const t = session.interaction.state.target;
    if (t === null) return 'null';
    const pos = [t.x, t.y, t.z];
    session.interaction.tickBreaking(true, null);
    return JSON.stringify({ pos, agora: world.getBlock(pos[0], pos[1], pos[2]) });
  })()`));
  passo('quebra um bloco', alvo !== null && alvo.agora === 0, JSON.stringify(alvo?.pos));

  // 5. Salvar e sair pela pausa.
  await cdp.avaliar(`(async () => {
    __smoke.tecla('keydown', 'Escape'); __smoke.tecla('keyup', 'Escape');
    return true;
  })()`);
  await ate(cdp, "__smoke.visivel('pause-menu') !== null", 10000);
  await cdp.avaliar("__smoke.botao(document.getElementById('pause-menu'), 'Salvar e Sair').click(), true");
  // "Salvar e Sair" grava e **recarrega a página** (`main.ts`): é a saída do
  // jogo para o título. A página nova não tem `__smoke` — é assim que se sabe
  // que a recarga aconteceu, e não só que o título apareceu.
  await ate(cdp, `window.__smoke === undefined && document.readyState === 'complete'
    && document.getElementById('title-screen') !== null`, 30000);
  passo('salva, sai e a página recarrega até o título', true);

  // 6. Voltar ao mesmo mundo.
  await cdp.avaliar(HELPERS);
  await cdp.avaliar(`(async () => {
    const s = window.__smoke;
    s.botao(document.getElementById('title-screen'), 'Jogar').click();
    await new Promise((r) => setTimeout(r, 800));
    s.botao(document.getElementById('worlds-screen'), 'Jogar').click();
    return true;
  })()`);
  const [x, y, z] = alvo.pos;
  const bloco = await ate(cdp, `(() => {
    const c = window.__craftlite; if (c === undefined) return false;
    if (!c.world.isLoaded(${x}, ${z})) return false;
    return 'id:' + c.world.getBlock(${x}, ${y}, ${z});
  })()`, 90000);
  passo('depois de recarregar, o bloco continua quebrado', bloco === 'id:0', bloco);

  const erros = JSON.parse(await cdp.avaliar('JSON.stringify(window.__smoke.erros)'));
  passo('nenhum erro na página', erros.length === 0, erros.slice(0, 3).join(' | '));
  console.log(`\nsmoke: ${passos.length} passos, todos verdes`);
} catch (e) {
  console.error('\nsmoke FALHOU:', e.message);
  process.exitCode = 1;
} finally {
  cdp?.fechar();
  chrome.kill();
  server.close();
}
