/**
 * Smoke test da prova de conexão (M20.0): dois navegadores se ligam pela
 * página `rede.html`, trocando os códigos como uma pessoa faria.
 *
 * Sobe **dois** Chrome headless com perfis separados — dois "aparelhos" na
 * mesma máquina —, abre a página nos dois, clica em *Abrir a sala* num e em
 * *Entrar numa sala* no outro, copia o código de um para o campo do outro e
 * volta com a resposta. Passa se os dois disserem *Conectados!* e o anfitrião
 * terminar as medições.
 *
 * O que ele **não** prova: que dois aparelhos numa rede Wi-Fi de verdade se
 * alcançam. Na mesma máquina, o caminho é a interface local. Por padrão o
 * Chrome esconde o IP atrás de um nome mDNS (`….local`), e um container sem
 * multicast não resolve esse nome; `SMOKE_NET_MDNS=1` mantém o mDNS ligado
 * para quem roda numa máquina de verdade.
 *
 * Uso: `npm run build && npm run smoke:net`. Como root (container), aponte
 * `CHROME` para um invólucro com `--no-sandbox`.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { conectar } from './cdp.mjs';

const DIST = join(process.cwd(), 'dist');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json' };

function chromeBin() {
  const env = process.env.CHROME;
  if (env !== undefined && env !== '') return env;
  for (const caminho of ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (existsSync(caminho)) return caminho;
  }
  throw new Error('Chrome não encontrado — aponte com a variável CHROME');
}

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

async function ate(cdp, expressao, limite = 30000) {
  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    const v = await cdp.avaliar(expressao).catch(() => false);
    if (v) return v;
    await esperar(250);
  }
  throw new Error(`tempo esgotado esperando: ${expressao.slice(0, 80)}`);
}

/** Clica no botão cujo texto começa com `texto`. */
const clicar = (texto) => `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith(${JSON.stringify(texto)}));
  if (b === undefined) return false;
  b.click();
  return true;
})()`;

/** Cola o código no campo e aperta o botão ao lado. */
const colar = (codigo, botao) => `(() => {
  const area = document.querySelector('textarea:not(.report)');
  area.value = ${JSON.stringify(codigo)};
  return ${clicar(botao)};
})()`;

const passos = [];
function passo(nome, ok, detalhe = '') {
  passos.push({ nome, ok });
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ' — ' + detalhe : ''}`);
  if (!ok) throw new Error(nome);
}

if (!existsSync(join(DIST, 'rede.html'))) {
  console.error('dist/rede.html não existe: rode `npm run build` antes.');
  process.exit(1);
}

const server = await servir();
const url = `http://127.0.0.1:${server.address().port}/rede.html`;
const mdns = process.env.SMOKE_NET_MDNS === '1';
const chromes = [9341, 9342].map((porta) => spawn(chromeBin(), [
  '--headless=new', `--remote-debugging-port=${porta}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'craftlite-net-'))}`,
  '--no-first-run', '--no-default-browser-check', '--lang=pt-BR',
  ...(mdns ? [] : ['--disable-features=WebRtcHideLocalIpsWithMdns']),
  url,
], { stdio: 'ignore', env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } }));

let anfitriao;
let convidado;
try {
  anfitriao = await conectar(9341);
  convidado = await conectar(9342);
  for (const cdp of [anfitriao, convidado]) {
    await cdp.enviar('Runtime.enable');
    await ate(cdp, "document.querySelectorAll('button').length >= 2");
  }
  passo('a página abre nos dois navegadores', true, mdns ? 'mDNS ligado' : 'IP à vista (sem mDNS)');

  await anfitriao.avaliar(clicar('Abrir a sala'));
  const oferta = await ate(anfitriao, "document.querySelector('.code')?.textContent ?? false");
  passo('o anfitrião mostra o código da sala', oferta.length > 40, `${oferta.replace(/-/g, '').length} caracteres`);

  await convidado.avaliar(clicar('Entrar numa sala'));
  await ate(convidado, "document.querySelector('textarea') !== null");
  await convidado.avaliar(colar(oferta, 'Continuar'));
  const resposta = await ate(convidado, "document.querySelector('.code')?.textContent ?? false");
  passo('o convidado lê o código e mostra a resposta', resposta.length > 40, `${resposta.replace(/-/g, '').length} caracteres`);

  await anfitriao.avaliar(colar(resposta, 'Conectar'));
  await ate(anfitriao, "document.querySelector('h1.ok') !== null", 30000);
  await ate(convidado, "document.querySelector('h1.ok') !== null", 30000);
  passo('os dois dizem "Conectados!"', true);

  const lerRelatorio = (cdp) => cdp.avaliar("document.querySelector('textarea.report')?.value ?? '{}'").then(JSON.parse);
  await ate(anfitriao, "JSON.parse(document.querySelector('textarea.report').value).results !== undefined", 60000);
  await ate(convidado, "JSON.parse(document.querySelector('textarea.report').value).results !== undefined", 10000);
  const doAnfitriao = await lerRelatorio(anfitriao);
  const doConvidado = await lerRelatorio(convidado);
  const r = doAnfitriao.results;
  passo('o anfitrião mede ida e volta, perda e velocidade', r.rtt !== null && r.fast !== null && r.mbPerSecond !== null,
    `ida e volta ${r.rtt?.median.toFixed(2)} ms, perda ${r.fast.sent - r.fast.received}/${r.fast.sent}, ${r.mbPerSecond?.toFixed(1)} MB/s`);
  passo('o convidado recebe os mesmos números', JSON.stringify(doConvidado.results) === JSON.stringify(r));
  passo('o caminho é direto, entre candidatos host', doAnfitriao.pair?.local.type === 'host' && doAnfitriao.pair?.remote.type === 'host',
    `${doAnfitriao.pair?.local.kind} ↔ ${doAnfitriao.pair?.remote.kind}`);
  console.log(`\nsmoke da rede: ${passos.length} passos, todos verdes`);
} catch (e) {
  console.error('\nsmoke da rede FALHOU:', e.message);
  for (const [nome, cdp] of [['anfitrião', anfitriao], ['convidado', convidado]]) {
    const texto = await cdp?.avaliar("document.getElementById('app').innerText").catch(() => '');
    if (texto) console.error(`\n--- ${nome}:\n${texto.slice(0, 1500)}`);
  }
  process.exitCode = 1;
} finally {
  anfitriao?.fechar();
  convidado?.fechar();
  for (const chrome of chromes) chrome.kill();
  server.close();
}
