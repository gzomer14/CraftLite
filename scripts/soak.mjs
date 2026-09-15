/**
 * Teste de sessão longa (PROMPT.md §11): duas horas sem crash, sem perda de
 * progresso e sem travas.
 *
 * Roda o jogo publicado num Chrome **headless** e deixa o jogador voando em
 * linha reta no criativo — que é o pior caso do pipeline, porque nunca para de
 * gerar chunk novo. A cada 30 s guarda uma amostra do overlay de depuração.
 *
 * Headless de propósito: numa aba comum o jogo **para** quando ela deixa de
 * estar visível (é o que `visibilitychange` faz, e está certo), então o teste
 * exigiria a janela em primeiro plano por duas horas.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

const URL_JOGO = process.env.SOAK_URL ?? 'https://gzomer14.github.io/CraftLite/';
const MINUTOS = Number(process.env.SOAK_MIN ?? 120);
const PORTA = Number(process.env.SOAK_PORT ?? 9333);
const SAIDA = process.env.SOAK_OUT ?? join(process.cwd(), 'soak.json');

const perfil = mkdtempSync(join(tmpdir(), 'craftlite-soak-'));
const chrome = spawn(chromeBin(), [
  '--headless=new',
  // GPU de verdade no headless: sem isto cai no SwiftShader e o FPS não vale nada.
  '--use-gl=angle', '--use-angle=gl-egl',
  `--remote-debugging-port=${PORTA}`,
  `--user-data-dir=${perfil}`,
  '--no-first-run', '--no-default-browser-check',
  '--window-size=1280,720',
  '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
  '--js-flags=--expose-gc',
  URL_JOGO,
], { stdio: 'ignore' });

const fim = Date.now() + MINUTOS * 60000;
let cdp;
try {
  cdp = await conectar(PORTA);
  await cdp.enviar('Runtime.enable');
  await cdp.enviar('Log.enable').catch(() => {});

  // Espera o jogo existir antes de instalar o agente.
  await esperarPagina(cdp);
  const agente = readFileSync(new URL('./soak-agent.js', import.meta.url), 'utf8');
  console.log('agente:', await cdp.avaliar(agente));

  const gpu = await cdp.avaliar(`(() => {
    const c = document.createElement('canvas').getContext('webgl2')
      ?? document.createElement('canvas').getContext('webgl');
    if (c === null) return 'sem WebGL';
    const d = c.getExtension('WEBGL_debug_renderer_info');
    return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'renderizador não informado';
  })()`);
  console.log('gpu:', gpu);

  while (Date.now() < fim) {
    await new Promise((r) => setTimeout(r, 60000));
    const estado = await cdp.avaliar(`JSON.stringify({
      fase: window.__soak.fase, pronto: window.__soak.pronto,
      n: window.__soak.amostras.length,
      ultima: window.__soak.amostras.at(-1) ?? null,
      erros: window.__soak.erros.slice(-3),
    })`).catch((e) => JSON.stringify({ fatal: String(e) }));
    const s = JSON.parse(estado);
    console.log(new Date().toISOString(), estado);
    writeFileSync(SAIDA + '.parcial', estado);
    if (s.fatal !== undefined) break;
  }

  const tudo = await cdp.avaliar('JSON.stringify(window.__soak)');
  writeFileSync(SAIDA, tudo);
  console.log('gravado em', SAIDA, '-', JSON.parse(tudo).amostras.length, 'amostras');
} catch (e) {
  console.error('falhou:', e);
  process.exitCode = 1;
} finally {
  cdp?.fechar();
  chrome.kill();
}

async function esperarPagina(c) {
  for (let i = 0; i < 120; i++) {
    const pronto = await c.avaliar(
      "document.readyState === 'complete' && document.getElementById('title-screen') !== null",
    ).catch(() => false);
    if (pronto === true) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('a tela de título não apareceu');
}
