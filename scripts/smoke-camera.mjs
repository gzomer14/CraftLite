/**
 * Smoke test da câmera (M20): o convidado lê o QR do anfitrião pela webcam,
 * com o leitor próprio (`src/net/qrread.ts`).
 *
 * O Chromium de teste não tem `BarcodeDetector`, como o Chrome no Windows e no
 * Linux — então é exatamente o caminho do computador: câmera → canvas → leitor.
 * A "webcam" é a câmera falsa do Chrome, alimentada por um vídeo `.y4m` que
 * este script filma: o QR tirado do canvas da página do anfitrião, inclinado
 * como um celular na mão, borrado e com ruído de sensor. Sem dependência.
 *
 * Uso: `npm run build && npm run smoke:camera`.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { conectar } from './cdp.mjs';

const DIST = join(process.cwd(), 'dist');
const W = 640;
const H = 480;

function chromeBin() {
  const env = process.env.CHROME;
  if (env !== undefined && env !== '') return env;
  for (const c of ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (existsSync(c)) return c;
  }
  throw new Error('Chrome não encontrado — aponte com a variável CHROME');
}

function servir() {
  const server = createServer((req, res) => {
    const caminho = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    const arquivo = join(DIST, caminho);
    if (!arquivo.startsWith(DIST) || !existsSync(arquivo) || statSync(arquivo).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': extname(arquivo) === '.html' ? 'text/html' : 'text/javascript' });
    res.end(readFileSync(arquivo));
  });
  // `localhost` é contexto seguro: sem isso, o navegador nem oferece a câmera.
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cdp, expressao, limite = 30000) {
  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    const v = await cdp.avaliar(expressao).catch(() => false);
    if (v) return v;
    await esperar(200);
  }
  throw new Error(`tempo esgotado esperando: ${expressao.slice(0, 80)}`);
}
const clicar = (texto) => `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith(${JSON.stringify(texto)}));
  if (b === undefined) return false;
  b.click();
  return true;
})()`;

function abrirChrome(porta, url, extra) {
  return spawn(chromeBin(), [
    '--headless=new', `--remote-debugging-port=${porta}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'craftlite-cam-'))}`,
    '--no-first-run', '--no-default-browser-check', '--lang=pt-BR', ...extra, url,
  ], { stdio: 'ignore', env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } });
}

/** Homografia do quadrado unitário para o quadrilátero `q`. */
function quadrado(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx3 = x0 - x1 + x2 - x3; const dy3 = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2; const dx2 = x3 - x2; const dy1 = y1 - y2; const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const a13 = (dx3 * dy2 - dx2 * dy3) / den; const a23 = (dx1 * dy3 - dx3 * dy1) / den;
  const m = [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1];
  const [a, b, c, d, e, f, g, h, i] = m;
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
}

/** O QR (cinza, `size`×`size`) filmado: inclinado, borrado, com ruído. */
function filmar(qr, size) {
  const inv = quadrado([[190, 70], [470, 95], [455, 410], [175, 425]]);
  let quadro = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const w = inv[6] * x + inv[7] * y + inv[8];
      const u = (inv[0] * x + inv[1] * y + inv[2]) / w;
      const v = (inv[3] * x + inv[4] * y + inv[5]) / w;
      quadro[y * W + x] = u >= 0 && u < 1 && v >= 0 && v < 1 ? qr[Math.floor(v * size) * size + Math.floor(u * size)] : 95;
    }
  }
  const borrado = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += quadro[(y + dy) * W + x + dx];
      borrado[y * W + x] = s / 9;
    }
  }
  quadro = borrado;
  let semente = 3;
  const partes = [Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)];
  const croma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  for (let f = 0; f < 10; f++) {
    const lum = Buffer.alloc(W * H);
    for (let i = 0; i < lum.length; i++) {
      semente = (semente * 1664525 + 1013904223) >>> 0;
      lum[i] = Math.max(0, Math.min(255, quadro[i] + ((semente / 4294967296) - 0.5) * 24));
    }
    partes.push(Buffer.from('FRAME\n'), lum, croma);
  }
  return Buffer.concat(partes);
}

const passos = [];
function passo(nome, ok, detalhe = '') {
  passos.push(nome);
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ' — ' + detalhe : ''}`);
  if (!ok) throw new Error(nome);
}

if (!existsSync(join(DIST, 'rede.html'))) {
  console.error('dist/rede.html não existe: rode `npm run build` antes.');
  process.exit(1);
}

const server = await servir();
const url = `http://localhost:${server.address().port}/rede.html`;
const chromes = [];
let host;
let guest;
try {
  chromes.push(abrirChrome(9361, url, []));
  host = await conectar(9361);
  await host.enviar('Runtime.enable');
  await ate(host, "document.querySelectorAll('button').length >= 2");
  await host.avaliar(clicar('Abrir a sala'));
  const oferta = await ate(host, "document.querySelector('.code')?.textContent ?? false");
  // O QR como a página o desenhou: o canvas, em cinza.
  const qr = JSON.parse(await host.avaliar(`(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const g = [];
    for (let i = 0; i < d.length; i += 4) g.push(d[i] > 127 ? 225 : 30);
    return JSON.stringify({ size: c.width, g });
  })()`));
  passo('o anfitrião mostra o QR da sala', qr.size > 100, `${oferta.replace(/-/g, '').length} letras, QR de ${qr.size} px`);

  const video = join(mkdtempSync(join(tmpdir(), 'craftlite-y4m-')), 'qr.y4m');
  writeFileSync(video, filmar(qr.g, qr.size));
  chromes.push(abrirChrome(9362, url, [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`,
  ]));
  guest = await conectar(9362);
  await guest.enviar('Runtime.enable');
  await ate(guest, "document.querySelectorAll('button').length >= 2");
  const semDetector = await guest.avaliar("typeof BarcodeDetector === 'undefined'");
  await guest.avaliar(clicar('Entrar numa sala'));
  const botao = await ate(guest, `[...document.querySelectorAll('button')].some((b) => b.textContent.startsWith('Ler com a câmera'))`, 10000);
  passo('o convidado tem o botão da câmera, sem BarcodeDetector', botao === true && semDetector === true);

  const t0 = Date.now();
  await guest.avaliar(clicar('Ler com a câmera'));
  const resposta = await ate(guest, "document.querySelector('.code')?.textContent ?? false", 30000);
  passo('o leitor próprio lê o QR inclinado e borrado, e a resposta aparece', resposta.length > 40, `${Date.now() - t0} ms`);
  console.log(`\nsmoke da câmera: ${passos.length} passos, todos verdes`);
} catch (e) {
  console.error('\nsmoke da câmera FALHOU:', e.message);
  const texto = await guest?.avaliar("document.getElementById('app').innerText").catch(() => '');
  if (texto) console.error(`--- convidado:\n${texto.slice(0, 800)}`);
  process.exitCode = 1;
} finally {
  host?.fechar();
  guest?.fechar();
  for (const c of chromes) c.kill();
  server.close();
}
