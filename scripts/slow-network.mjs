/**
 * Tempo até a tela de título em rede lenta (PROMPT.md §11, critério 1).
 *
 * Mede de verdade: o Chrome headless é estrangulado por CDP
 * (`Network.emulateNetworkConditions`) com os mesmos perfis que o DevTools
 * usa, e o cronômetro para quando a tela de título fica visível — que é o que
 * o critério pede, e não o `load` do documento.
 *
 * Cache desligado e perfil novo a cada medida: senão a segunda leitura sai do
 * service worker e mede zero.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conectar } from './cdp.mjs';

/**
 * O Chrome instalado na máquina. `CHROME` no ambiente vence — em distro que
 * chama o binário de outro jeito, é a única coisa que precisa mudar.
 */
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

const URL_JOGO = process.env.URL ?? 'https://gzomer14.github.io/CraftLite/';

/** Perfis do DevTools, em bits/s e ms de latência. */
const PERFIS = [
  { nome: 'sem limite', download: -1, upload: -1, latencia: 0 },
  { nome: '3G rápido', download: 1.6 * 1024 * 1024 / 8 * 8, upload: 750 * 1024 / 8 * 8, latencia: 562.5 },
  { nome: '3G lento', download: 400 * 1024 / 8 * 8, upload: 400 * 1024 / 8 * 8, latencia: 2000 },
];

const CRONOMETRO = `
  window.__tTitulo = null;
  (() => {
    // Sondagem e não MutationObserver: este script roda **antes** do documento
    // existir, e \`document.documentElement\` ainda é nulo aqui.
    const marcar = () => {
      const t = document.getElementById('title-screen');
      if (t !== null && !t.hidden) {
        if (window.__tTitulo === null) window.__tTitulo = performance.now();
        return true;
      }
      return false;
    };
    const iv = setInterval(() => { if (marcar()) clearInterval(iv); }, 16);
  })();
`;

const resultados = [];
for (const perfil of PERFIS) {
  const porta = 9400 + PERFIS.indexOf(perfil);
  const dir = mkdtempSync(join(tmpdir(), 'craftlite-rede-'));
  const chrome = spawn(chromeBin(), [
    '--headless=new', '--use-gl=angle', '--use-angle=gl-egl',
    `--remote-debugging-port=${porta}`, `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,720',
    '--enable-unsafe-swiftshader', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const cdp = await conectar(porta);
    await cdp.enviar('Page.enable');
    await cdp.enviar('Network.enable');
    await cdp.enviar('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.enviar('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: perfil.download < 0 ? -1 : perfil.download / 8,
      uploadThroughput: perfil.upload < 0 ? -1 : perfil.upload / 8,
      latency: perfil.latencia,
    });
    await cdp.enviar('Page.addScriptToEvaluateOnNewDocument', { source: CRONOMETRO });

    await cdp.enviar('Page.navigate', { url: URL_JOGO });
    const limite = Date.now() + 120000;
    let ms = null;
    while (Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 250));
      ms = await cdp.avaliar('window.__tTitulo').catch(() => null);
      if (typeof ms === 'number') break;
    }
    const bytes = await cdp.avaliar(`JSON.stringify((() => {
      const n = performance.getEntriesByType('navigation')[0];
      const r = performance.getEntriesByType('resource');
      return {
        doc: n.encodedBodySize, transfer: n.transferSize + r.reduce((a, x) => a + x.transferSize, 0),
        recursos: r.map((x) => ({ n: x.name.split('/').pop(), t: x.transferSize, ms: +x.responseEnd.toFixed(0) })),
        load: +n.loadEventEnd.toFixed(0),
      };
    })())`).catch(() => null);
    resultados.push({ perfil: perfil.nome, tituloMs: ms === null ? null : Math.round(ms), rede: bytes });
    console.log(perfil.nome, '→', ms === null ? 'não carregou' : Math.round(ms) + ' ms', bytes);
    cdp.fechar();
  } catch (e) {
    console.error(perfil.nome, 'falhou:', String(e));
  } finally {
    chrome.kill();
    // O perfil fica: o Chrome ainda segura arquivos dele no instante do kill.
  }
}
console.log('\nRESUMO', JSON.stringify(resultados.map((r) => ({ perfil: r.perfil, tituloMs: r.tituloMs })), null, 1));
