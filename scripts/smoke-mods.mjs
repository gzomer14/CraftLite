/**
 * Smoke test dos mods (M21): o caminho com mod e, principalmente, a volta ao
 * caminho sem mod.
 *
 * O que só um navegador prova: que o jogo **sem mod** baixa um único arquivo de
 * código (o `index.html` sobe o `main` direto); que ligar um mod pela tela
 * **Mods** passa a subir o ponto de entrada dos mods, que baixa o mod e depois o
 * mesmo `main`; que o worker com mods desenha o bloco do mod; e que desligar
 * devolve a página ao arquivo único e apaga a escolha do `localStorage`.
 *
 * Mesma infraestrutura do `smoke.mjs`: `dist/` num servidor estático do Node,
 * Chrome em headless dirigido pelo protocolo de depuração (`cdp.mjs`), cliques
 * de verdade nos botões, e `window.__craftlite` com `?smoke`.
 *
 * Uso: `npm run build && npm run smoke:mods`. Sai com código 1 se algum passo
 * falhar. Como root (container), aponte `CHROME` para um invólucro com
 * `--no-sandbox`.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { conectar } from './cdp.mjs';

const DIST = join(process.cwd(), 'dist');
const PORTA_CDP = Number(process.env.SMOKE_CDP_PORT ?? 9335);
/** O bloco e o item do mod de exemplo (`src/mods/exemplo/mod.ts`). */
const CRISTAL = 768;
const FRAGMENTO = 4096;

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
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

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

const HELPERS = `(() => {
  if (window.__smoke !== undefined) return true;
  const smoke = { erros: [], recusados: [] };
  window.__smoke = smoke;
  addEventListener('error', (e) => smoke.erros.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => smoke.erros.push('promise: ' + String(e.reason)));
  const warn = console.warn;
  console.warn = (...a) => { smoke.recusados.push(a.map(String).join(' ')); warn(...a); };
  smoke.botao = (raiz, texto) =>
    [...raiz.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(texto));
  smoke.tela = (id) => document.getElementById(id);
  smoke.scripts = () => performance.getEntriesByType('resource')
    .map((e) => new URL(e.name).pathname).filter((p) => p.endsWith('.js'));
  return true;
})()`;

/** Recarregou: a página nova não tem `__smoke`. */
const RECARREGOU = `window.__smoke === undefined && document.readyState === 'complete'
  && document.getElementById('title-screen') !== null`;

const passos = [];
function passo(nome, ok, detalhe = '') {
  passos.push({ nome, ok, detalhe });
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ' — ' + detalhe : ''}`);
  if (!ok) throw new Error(nome);
}

/** Marca ou desmarca o mod na tela Mods e aperta Recarregar. */
async function escolherMod(cdp, ligado) {
  await cdp.avaliar("__smoke.botao(__smoke.tela('title-screen'), 'Mods').click(), true");
  await ate(cdp, "!__smoke.tela('mods-screen').hidden", 10000);
  await cdp.avaliar(`(() => {
    const box = document.querySelector('#mods-screen input[data-mod="exemplo"]');
    box.checked = ${ligado}; box.dispatchEvent(new Event('change'));
    __smoke.botao(__smoke.tela('mods-screen'), 'Recarregar').click();
    return true;
  })()`);
  await ate(cdp, RECARREGOU, 30000);
  await cdp.avaliar(HELPERS);
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ não existe: rode `npm run build` antes.');
  process.exit(1);
}

const server = await servir();
const url = `http://127.0.0.1:${server.address().port}/?smoke`;
const perfil = mkdtempSync(join(tmpdir(), 'craftlite-smoke-mods-'));
const chrome = spawn(chromeBin(), [
  '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${perfil}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1280,720',
  '--lang=pt-BR', url,
], { stdio: 'ignore', env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } });

let cdp;
try {
  cdp = await conectar(PORTA_CDP);
  await cdp.enviar('Runtime.enable');

  // 1. Sem mod: um arquivo de código só.
  await ate(cdp, "document.readyState === 'complete' && document.getElementById('title-screen') !== null");
  await cdp.avaliar(HELPERS);
  const semMod = JSON.parse(await cdp.avaliar('JSON.stringify(__smoke.scripts())'));
  passo('sem mod, a página baixa um único arquivo de código', semMod.length === 1
    && semMod[0].includes('/a/'), semMod.join(' '));

  // 2. Ligar pela tela Mods.
  await escolherMod(cdp, true);
  const comMod = JSON.parse(await cdp.avaliar('JSON.stringify(__smoke.scripts())'));
  const texto = await cdp.avaliar(`(async () => {
    __smoke.botao(__smoke.tela('title-screen'), 'Mods').click();
    await new Promise((r) => setTimeout(r, 300));
    const t = __smoke.tela('mods-screen').innerText;
    __smoke.botao(__smoke.tela('mods-screen'), 'Voltar').click();
    return t;
  })()`);
  passo('ligado, sobe pelo ponto de entrada dos mods: o mesmo main, o boot e o mod',
    comMod.includes(semMod[0]) && comMod.filter((p) => p.includes('/m/')).length === 2
      && texto.includes('Ligados agora: Exemplo'), comMod.join(' '));

  // 3. Mundo com o mod: o cristal nasce, brilha como a pedra luminosa e é
  // desenhado pelo worker com mods.
  await cdp.avaliar(`(async () => {
    const s = window.__smoke;
    s.botao(s.tela('title-screen'), 'Jogar').click();
    await new Promise((r) => setTimeout(r, 500));
    const mundos = s.tela('worlds-screen');
    s.botao(mundos, 'Criar novo').click();
    await new Promise((r) => setTimeout(r, 400));
    const campos = [...mundos.querySelectorAll('input, select')].filter((c) => c.type !== 'file');
    const textos = campos.filter((c) => c.tagName === 'INPUT');
    const modo = campos.find((c) => c.tagName === 'SELECT' && [...c.options].some((o) => o.value === 'creative'));
    textos[0].value = 'Mods'; textos[0].dispatchEvent(new Event('input', { bubbles: true }));
    textos[1].value = 'smoke-mods'; textos[1].dispatchEvent(new Event('input', { bubbles: true }));
    modo.value = 'creative'; modo.dispatchEvent(new Event('change', { bubbles: true }));
    s.botao(mundos, 'Criar e jogar').click();
    return true;
  })()`);
  await ate(cdp, `(() => {
    const c = window.__craftlite;
    if (c === undefined) return false;
    c.player.flying = false;
    return c.player.onGround === true;
  })()`, 120000);
  const mundo = JSON.parse(await cdp.avaliar(`(() => {
    const { world, player, session, items } = window.__craftlite;
    const x = Math.floor(player.x) + 3, y = Math.floor(player.y) + 1, z = Math.floor(player.z);
    world.setBlock(x, y, z, ${CRISTAL}, 'player');
    session.systems.lighting.onBlockChanged(x, y, z, 0, ${CRISTAL});
    for (let i = 0; i < 40; i++) session.systems.tick(false);
    return JSON.stringify({
      bloco: world.getBlock(x, y, z), luz: world.getBlockLight(x - 1, y, z),
      item: items.get('exemplo:fragmento')?.id,
    });
  })()`));
  passo('o cristal do mod entra no mundo e brilha', mundo.bloco === CRISTAL && mundo.luz === 14
    && mundo.item === FRAGMENTO, JSON.stringify(mundo));

  // 4. Salvar e sair; desligar.
  await cdp.avaliar("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true })), true");
  await ate(cdp, "!__smoke.tela('pause-menu').hidden", 10000);
  await cdp.avaliar("__smoke.botao(__smoke.tela('pause-menu'), 'Salvar e Sair').click(), true");
  await ate(cdp, RECARREGOU, 30000);
  await cdp.avaliar(HELPERS);
  await escolherMod(cdp, false);
  const desligado = JSON.parse(await cdp.avaliar('JSON.stringify(__smoke.scripts())'));
  const chave = await cdp.avaliar("localStorage.getItem('craftlite.mods')");
  passo('desligado, volta a um único arquivo e a escolha sai do armazenamento',
    desligado.length === 1 && desligado[0] === semMod[0] && chave === null, desligado.join(' '));

  // 5. O mundo jogado com o mod pede o mod, e não abre sem ele.
  await cdp.avaliar("window.confirm = (m) => { __smoke.confirmou = m; return false; }; true");
  await cdp.avaliar(`(async () => {
    __smoke.botao(__smoke.tela('title-screen'), 'Jogar').click();
    await new Promise((r) => setTimeout(r, 800));
    __smoke.botao(__smoke.tela('worlds-screen'), 'Jogar').click();
    return true;
  })()`);
  await esperar(1500);
  const pedido = await cdp.avaliar('__smoke.confirmou ?? ""');
  const abriu = await cdp.avaliar('window.__craftlite !== undefined');
  passo('o mundo jogado com o mod pede o mod e não abre sem ele',
    pedido.includes('Exemplo') && !abriu, pedido.slice(0, 60));

  const erros = JSON.parse(await cdp.avaliar('JSON.stringify(__smoke.erros)'));
  passo('nenhum erro na página', erros.length === 0, erros.slice(0, 3).join(' | '));
  console.log(`\nsmoke dos mods: ${passos.length} passos, todos verdes`);
} catch (e) {
  console.error('\nsmoke dos mods FALHOU:', e.message);
  process.exitCode = 1;
} finally {
  cdp?.fechar();
  chrome.kill();
  server.close();
}
