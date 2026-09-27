/**
 * Prova de conexão (M20.0): a página `rede.html`.
 *
 * Responde a única pergunta que decide o desenho do M20 e que só se responde
 * em aparelho real: **dois navegadores na mesma rede Wi-Fi se ligam direto, sem
 * servidor nenhum?** Sem jogo: abre a sala, troca os códigos pela tela, liga,
 * mede e escreve um relatório para o jogador copiar e mandar de volta.
 *
 * O que se mede depois de ligar, sempre com o anfitrião puxando:
 * - ida e volta no canal confiável (500 mensagens, uma de cada vez);
 * - perda no canal rápido (300 mensagens a cada 10 ms, sem retransmissão);
 * - velocidade no canal confiável (4 MB em pedaços de 16 KB), que diz se
 *   mandar chunk modificado pela rede é viável.
 *
 * É um ponto de entrada à parte do jogo e só importa de `src/net/`: o jogo não
 * baixa um byte disto (`tests/net.test.ts` cobra).
 */

import { decodeCode, encodeCode, groupCode } from './base32';
import { Link, type PairInfo } from './link';
import { PROBE_TEXT } from './probetext';
import { encodeQr, paintQr } from './qr';
import { canScan, scanQr } from './scan';
import { decodeSignal, encodeSignal, type Signal } from './signal';

const T = PROBE_TEXT[navigator.language.toLowerCase().startsWith('pt') ? 'pt' : 'en'];
const PROBE_VERSION = 1;
const CONNECT_TIMEOUT_MS = 20000;

// Mensagens da medição: o primeiro byte é o tipo.
const PING = 1;
const PONG = 2;
const FAST_PING = 3;
const FAST_PONG = 4;
const BULK = 5;
const BULK_END = 6;
const BULK_ACK = 7;
const RESULT = 8;

interface Results {
  rtt: { min: number; median: number; p95: number; max: number } | null;
  fast: { sent: number; received: number; medianMs: number | null } | null;
  mbPerSecond: number | null;
}

interface Report {
  probe: number;
  role: 'host' | 'guest';
  userAgent: string;
  camera: boolean;
  offerBytes?: number;
  answerBytes?: number;
  candidates?: { local: string[]; remote: string[] };
  connectMs?: number;
  pair?: PairInfo | null;
  results?: Results;
  outcome: 'connected' | 'failed' | 'dropped' | 'pending';
  log: string[];
}

const app = document.getElementById('app') as HTMLDivElement;
let camera = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== '') e.textContent = text;
  if (cls !== '') e.className = cls;
  return e;
}

function button(text: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', text, cls);
  b.addEventListener('click', onClick);
  return b;
}

function clear(): void {
  app.textContent = '';
}

async function copy(text: string, area?: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sem contexto seguro (http na rede local) não há área de transferência:
    // seleciona o texto para o jogador copiar à mão.
    area?.select();
    return false;
  }
}

// --- telas -------------------------------------------------------------------

function start(): void {
  clear();
  app.append(
    el('h1', T.title),
    el('p', T.intro),
    button(T.host, () => void hostFlow(), 'primary'),
    button(T.guest, () => guestFlow()),
    el('p', camera ? T.cameraYes : T.cameraNo, 'muted'),
  );
}

/** QR grande e o código em texto, com botão de copiar. */
function showCode(bytes: Uint8Array): void {
  const code = encodeCode(bytes);
  const canvas = el('canvas');
  paintQr(canvas, encodeQr(code), Math.min(360, window.innerWidth - 32));
  const text = el('p', groupCode(code), 'code');
  const copied = el('span', '', 'muted');
  app.append(canvas, el('p', T.code, 'muted'), text,
    button(T.copy, () => void copy(groupCode(code)).then((ok) => { copied.textContent = ok ? T.copied : ''; })),
    copied);
}

/**
 * Um campo para colar o código e, se houver câmera, o botão de ler. Chama
 * `use` com o sinal decodificado; erro de digitação fica na tela.
 */
function readCode(expect: Signal['role'], use: (signal: Signal) => void): void {
  const area = el('textarea');
  area.placeholder = T.paste;
  area.rows = 3;
  const error = el('p', '', 'error');
  const apply = (text: string): void => {
    const bytes = decodeCode(text);
    const signal = bytes === null ? null : decodeSignal(bytes);
    if (signal === null) {
      error.textContent = T.badCode;
      return;
    }
    if (signal.role !== expect) {
      error.textContent = T.wrongRole;
      return;
    }
    error.textContent = '';
    use(signal);
  };
  if (camera) {
    const video = el('video');
    video.hidden = true;
    const stop = { cancelled: false };
    const cancel = button(T.cancel, () => { stop.cancelled = true; });
    cancel.hidden = true;
    const scan = button(T.scan, () => {
      stop.cancelled = false;
      video.hidden = false;
      cancel.hidden = false;
      scanQr(video, stop).then((text) => {
        video.hidden = true;
        cancel.hidden = true;
        if (text !== null) apply(text);
      }).catch((e: unknown) => {
        video.hidden = true;
        cancel.hidden = true;
        error.textContent = String(e);
      });
    }, 'primary');
    app.append(scan, cancel, video);
  }
  app.append(area, button(expect === 'answer' ? T.connect : T.next, () => apply(area.value)), error);
}

async function hostFlow(): Promise<void> {
  clear();
  const status = el('p', T.preparing);
  app.append(el('h1', T.host), status);
  const report: Report = baseReport('host');
  const { link, offer } = await Link.host();
  const offerBytes = encodeSignal(offer);
  report.offerBytes = offerBytes.length;
  report.candidates = { local: offer.candidates.map((c) => c.kind), remote: [] };
  status.textContent = T.hostShow;
  showCode(offerBytes);
  app.append(el('p', T.hostRead));
  readCode('answer', (answer) => {
    report.answerBytes = encodeSignal(answer).length;
    report.candidates = { local: offer.candidates.map((c) => c.kind), remote: answer.candidates.map((c) => c.kind) };
    const began = performance.now();
    clear();
    const line = el('p', T.connecting);
    app.append(el('h1', T.host), line);
    const timer = setTimeout(() => failed(link, report), CONNECT_TIMEOUT_MS);
    link.onOpen = () => {
      clearTimeout(timer);
      report.connectMs = Math.round(performance.now() - began);
      void connected(link, report, true);
    };
    link.onClose = () => {
      clearTimeout(timer);
      failed(link, report);
    };
    link.accept(answer).catch((e: unknown) => {
      link.log.push(`accept: ${String(e)}`);
      failed(link, report);
    });
  });
}

function guestFlow(): void {
  clear();
  app.append(el('h1', T.guest), el('p', T.guestRead));
  const report: Report = baseReport('guest');
  readCode('offer', (offer) => {
    void (async () => {
      clear();
      const status = el('p', T.preparing);
      app.append(el('h1', T.guest), status);
      const { link, answer } = await Link.guest(offer);
      const answerBytes = encodeSignal(answer);
      report.offerBytes = encodeSignal(offer).length;
      report.answerBytes = answerBytes.length;
      report.candidates = { local: answer.candidates.map((c) => c.kind), remote: offer.candidates.map((c) => c.kind) };
      const began = performance.now();
      status.textContent = T.guestShow;
      showCode(answerBytes);
      app.append(el('p', T.waiting, 'muted'));
      link.onOpen = () => {
        report.connectMs = Math.round(performance.now() - began);
        void connected(link, report, false);
      };
      link.onClose = () => failed(link, report);
    })().catch((e: unknown) => {
      app.append(el('p', String(e), 'error'));
    });
  });
}

// --- depois de ligar ---------------------------------------------------------

async function connected(link: Link, report: Report, host: boolean): Promise<void> {
  clear();
  report.outcome = 'connected';
  const title = el('h1', T.connected, 'ok');
  const status = el('p', T.measuring);
  const table = el('div', '', 'results');
  app.append(title, status, table);
  const area = reportArea(report, link);
  report.pair = await link.pair();
  const showResults = (results: Results): void => {
    report.results = results;
    table.textContent = '';
    const row = (label: string, value: string): void => {
      table.append(el('span', label, 'muted'), el('span', value));
    };
    if (report.pair !== null && report.pair !== undefined) {
      row(T.pair, `${report.pair.local.type}/${report.pair.local.kind} ↔ ${report.pair.remote.type}/${report.pair.remote.kind}`);
    }
    if (results.rtt !== null) {
      row(T.rtt, `${results.rtt.median.toFixed(1)} ms (min ${results.rtt.min.toFixed(1)}, p95 ${results.rtt.p95.toFixed(1)})`);
    }
    if (results.fast !== null) {
      const lost = results.fast.sent - results.fast.received;
      row(T.loss, `${lost} / ${results.fast.sent} (${((100 * lost) / results.fast.sent).toFixed(1)}%)`);
    }
    if (results.mbPerSecond !== null) row(T.speed, `${results.mbPerSecond.toFixed(2)} MB/s`);
    status.textContent = '';
    area.refresh();
  };
  link.onClose = () => {
    report.outcome = 'dropped';
    status.textContent = T.closed;
    area.refresh();
  };
  if (host) {
    const results = await measure(link);
    link.send(Uint8Array.from([RESULT, ...new TextEncoder().encode(JSON.stringify(results))]), true);
    showResults(results);
  } else {
    let bulk = 0;
    link.onMessage = (data, reliable) => {
      const bytes = new Uint8Array(data);
      const type = bytes[0];
      if (type === PING) {
        bytes[0] = PONG;
        link.send(bytes, true);
      } else if (type === FAST_PING) {
        bytes[0] = FAST_PONG;
        link.send(bytes, false);
      } else if (type === BULK) {
        bulk += bytes.length;
      } else if (type === BULK_END) {
        link.send(tagged32(BULK_ACK, bulk), true);
      } else if (type === RESULT && reliable) {
        showResults(JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as Results);
      }
    };
    area.refresh();
  }
}

function tagged32(type: number, value: number): Uint8Array {
  const out = new Uint8Array(5);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, value);
  return out;
}

/** As três medições, uma depois da outra. */
async function measure(link: Link): Promise<Results> {
  const waiting = new Map<string, (t: number) => void>();
  let bulkAck: ((n: number) => void) | null = null;
  link.onMessage = (data) => {
    const bytes = new Uint8Array(data);
    if (bytes[0] === PONG || bytes[0] === FAST_PONG) {
      const key = `${bytes[0]}:${new DataView(data).getUint32(1)}`;
      waiting.get(key)?.(performance.now());
      waiting.delete(key);
    } else if (bytes[0] === BULK_ACK) {
      bulkAck?.(new DataView(data).getUint32(1));
    }
  };

  // Ida e volta, uma de cada vez.
  const rtts: number[] = [];
  for (let i = 0; i < 500 && link.isOpen; i++) {
    const sent = performance.now();
    const back = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      waiting.set(`${PONG}:${i}`, (t) => { clearTimeout(timer); resolve(t); });
      link.send(tagged32(PING, i), true);
    });
    if (back !== null) rtts.push(back - sent);
  }
  rtts.sort((a, b) => a - b);
  const rtt = rtts.length === 0 ? null : {
    min: rtts[0], median: rtts[Math.floor(rtts.length / 2)],
    p95: rtts[Math.floor(rtts.length * 0.95)], max: rtts[rtts.length - 1],
  };

  // Canal rápido: 300 mensagens a cada 10 ms, sem esperar resposta.
  const fastTimes: number[] = [];
  const fastSent = 300;
  for (let i = 0; i < fastSent && link.isOpen; i++) {
    const sent = performance.now();
    waiting.set(`${FAST_PONG}:${i}`, (t) => fastTimes.push(t - sent));
    link.send(tagged32(FAST_PING, i), false);
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 1500));
  fastTimes.sort((a, b) => a - b);
  const fast = {
    sent: fastSent, received: fastTimes.length,
    medianMs: fastTimes.length === 0 ? null : fastTimes[Math.floor(fastTimes.length / 2)],
  };

  // Velocidade: 4 MB no canal confiável, respeitando o buffer do canal.
  const total = 4 * 1024 * 1024;
  const chunk = new Uint8Array(16 * 1024);
  chunk[0] = BULK;
  const channel = link.reliable;
  channel.bufferedAmountLowThreshold = 1024 * 1024;
  const began = performance.now();
  for (let sent = 0; sent < total && link.isOpen; sent += chunk.length) {
    if (channel.bufferedAmount > 4 * 1024 * 1024) {
      await new Promise<void>((resolve) => {
        channel.addEventListener('bufferedamountlow', () => resolve(), { once: true });
      });
    }
    link.send(chunk, true);
  }
  const received = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 30000);
    bulkAck = (n) => { clearTimeout(timer); resolve(n); };
    link.send(Uint8Array.from([BULK_END]), true);
  });
  const seconds = (performance.now() - began) / 1000;
  const mbPerSecond = received === null ? null : received / (1024 * 1024) / seconds;
  return { rtt, fast, mbPerSecond };
}

function failed(link: Link, report: Report): void {
  if (report.outcome === 'connected') return;
  report.outcome = 'failed';
  clear();
  app.append(el('h1', T.failed, 'error'), el('p', T.hints));
  reportArea(report, link).refresh();
  link.close();
}

function baseReport(role: Report['role']): Report {
  return { probe: PROBE_VERSION, role, userAgent: navigator.userAgent, camera, outcome: 'pending', log: [] };
}

/** O relatório em texto, com botão de copiar e de recomeçar. */
function reportArea(report: Report, link: Link): { refresh: () => void } {
  const area = el('textarea', '', 'report');
  area.readOnly = true;
  area.rows = 10;
  const copied = el('span', '', 'muted');
  app.append(el('h2', T.report), el('p', T.reportHelp, 'muted'), area,
    button(T.copy, () => void copy(area.value, area).then((ok) => { copied.textContent = ok ? T.copied : ''; })),
    copied, button(T.again, () => { link.close(); start(); }));
  const refresh = (): void => {
    report.log = link.log.slice();
    area.value = JSON.stringify(report, null, 1);
  };
  refresh();
  return { refresh };
}

void canScan().then((yes) => {
  camera = yes;
  start();
});
