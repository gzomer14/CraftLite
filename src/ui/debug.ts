/**
 * Overlay de debug (F3 no teclado, 3 dedos no toque). Formato do doc 02 §6.
 *
 * Existe desde o M0 de propósito: sem ele, otimizar é chutar. Custa uma
 * atualização de `textContent` a cada 250 ms e um canvas 2D de 120×40.
 *
 * O texto é montado em um array de linhas pré-alocado e só vira string na hora
 * de escrever — o overlay não deve criar lixo por frame.
 */

import { FRAME_HISTORY, type LoopStats } from '../core/loop';
import type { Preset, Tier } from '../core/tier';
import type { GlCaps } from '../render/gl';

const GRAPH_W = FRAME_HISTORY;
const GRAPH_H = 40;
const UPDATE_MS = 250;

/** Nomes das direções, indexados por (yaw normalizado × 4). */
const FACINGS = ['norte (+Z)', 'oeste (-X)', 'sul (-Z)', 'leste (+X)'] as const;

export interface DebugSource {
  stats: LoopStats;
  camera: { renderX: number; renderY: number; renderZ: number; yaw: number };
  drawCalls: number;
  vertices: number;
  renderScale: number;
  /**
   * Estado do pipeline de chunks. `loaded`/`total` são **colunas do anel**, na
   * mesma unidade — misturar sections visíveis com colunas carregadas aqui já
   * fez um relatório de campo ser lido como pipeline travado quando o mundo
   * estava saudável.
   */
  chunks: {
    loaded: number; total: number; queued: number;
    generating: number; meshing: number; visibleSections: number;
  };
  /** Teto de FPS configurado; 0 = seguir o display. */
  maxFps: number;
  biome: string;
  blockLight: number;
  skyLight: number;
  /** Entidades vivas e trabalho de IA no último tick (doc 07 §3). */
  entities: { mobs: number; items: number; arrows: number; paths: number };
  /** Hora do dia, do ciclo dia/noite. */
  clock: string;
  /** Sons já sintetizados; 0 = áudio ainda não ligou. */
  sounds: number;
}

export class DebugOverlay {
  private readonly root: HTMLDivElement;
  private readonly pre: HTMLPreElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly g2d: CanvasRenderingContext2D | null;
  private readonly lines: string[] = ['', '', '', '', '', '', '', ''];
  private readonly header: string;
  private readonly targetMs: number;
  private lastUpdate = 0;
  private visible = false;
  /** Estimativa da taxa do display, medida nos primeiros quadros. */
  private displayHz = 0;
  private hzSamples = 0;
  private hzSince = 0;

  constructor(tier: Tier, preset: Preset, caps: GlCaps, atlasLayers: number, atlasMs: number) {
    this.targetMs = 1000 / preset.targetFps;
    // Sem marcar o marco: ficaria desatualizado a cada entrega.
    this.header =
      `CraftLite  ·  tier T${tier} (${preset.label})  ·  ${caps.webgl2 ? 'WebGL2' : 'WebGL1'}  ·  ` +
      `RD ${preset.renderDistance}  ·  atlas ${atlasLayers} camadas em ${atlasMs.toFixed(1)}ms`;

    this.root = document.createElement('div');
    this.root.id = 'debug';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.hidden = true;

    this.pre = document.createElement('pre');
    this.canvas = document.createElement('canvas');
    this.canvas.width = GRAPH_W;
    this.canvas.height = GRAPH_H;
    this.canvas.className = 'graph';
    this.g2d = this.canvas.getContext('2d', { alpha: false });

    this.root.append(this.pre, this.canvas);
    document.body.appendChild(this.root);
    injectStyle();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.hidden = !this.visible;
    this.lastUpdate = 0;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /**
   * Mede a taxa de atualização do display. Chamado todo frame, inclusive com o
   * overlay fechado — é barato e o número precisa estar pronto quando abrir.
   */
  sampleDisplayRate(now: number): void {
    if (this.hzSince === 0) { this.hzSince = now; return; }
    this.hzSamples++;
    const elapsed = now - this.hzSince;
    if (elapsed >= 1000) {
      const measured = (this.hzSamples * 1000) / elapsed;
      // Arredonda para os valores comuns de painel.
      this.displayHz = [30, 48, 60, 75, 90, 120, 144, 165, 240]
        .reduce((best, hz) => (Math.abs(hz - measured) < Math.abs(best - measured) ? hz : best), 60);
      this.hzSamples = 0;
      this.hzSince = now;
    }
  }

  /** Chamado todo frame; só toca no DOM a cada 250 ms. */
  update(now: number, src: DebugSource): void {
    if (!this.visible) return;
    if (now - this.lastUpdate < UPDATE_MS) return;
    this.lastUpdate = now;

    const s = src.stats;
    const cam = src.camera;
    const facing = FACINGS[((Math.round(cam.yaw / (Math.PI / 2)) % 4) + 4) % 4];
    const cx = Math.floor(cam.renderX / 16);
    const cz = Math.floor(cam.renderZ / 16);
    const mem = readHeapMb();

    const l = this.lines;
    l[0] = this.header;
    // O rAF segue a taxa do display, então mostrar os dois lado a lado evita a
    // confusão de ver 100 FPS num jogo "de 60".
    const cap = src.maxFps > 0 ? `teto ${src.maxFps}` : `display ~${this.displayHz}Hz`;
    l[1] =
      `fps ${s.fps.toFixed(0)} (${s.frameMs.toFixed(1)}ms)  |  ${cap}  |  ` +
      `escala ${src.renderScale.toFixed(2)}` + (mem > 0 ? `  |  mem ${mem}MB` : '');
    l[2] =
      `XYZ ${cam.renderX.toFixed(1)} / ${cam.renderY.toFixed(1)} / ${cam.renderZ.toFixed(1)}` +
      `   chunk ${cx} ${Math.floor(cam.renderY / 16)} ${cz}`;
    l[3] = `bioma: ${src.biome}   luz: b${src.blockLight} s${src.skyLight}   olhando: ${facing}`;
    const c = src.chunks;
    l[4] =
      `C: ${c.loaded}/${c.total} colunas, ${c.queued} na fila, ` +
      `${c.generating} gerando, ${c.meshing} meshando`;
    l[5] =
      `V: ${formatCount(src.vertices)} vértices, ${src.drawCalls} draw calls, ` +
      `${c.visibleSections} sections visíveis`;
    const e = src.entities;
    l[6] =
      `E: ${e.mobs} mobs, ${e.items} itens, ${e.arrows} flechas, ${e.paths} caminhos/tick` +
      `   ${src.clock}` + (src.sounds > 0 ? `   ${src.sounds} sons` : '');
    l[7] =
      `T: tick ${s.tickMs.toFixed(1)}ms  mesh-upload ${s.pumpMs.toFixed(1)}ms  ` +
      `render ${s.renderMs.toFixed(1)}ms`;

    this.pre.textContent = l.join('\n');
    this.drawGraph(s);
  }

  /** Gráfico dos últimos 120 frames; a linha vermelha é o alvo do tier. */
  private drawGraph(s: LoopStats): void {
    const g = this.g2d;
    if (g === null) return;
    const scale = GRAPH_H / (this.targetMs * 2);

    g.fillStyle = '#101319';
    g.fillRect(0, 0, GRAPH_W, GRAPH_H);

    for (let i = 0; i < GRAPH_W; i++) {
      // Lê em ordem cronológica: o índice atual é o mais antigo do buffer.
      const ms = s.history[(s.historyIndex + i) % GRAPH_W];
      if (ms === 0) continue;
      const h = Math.min(GRAPH_H, ms * scale);
      g.fillStyle = ms > this.targetMs * 1.5 ? '#e05a4a' : ms > this.targetMs ? '#e0c04a' : '#6c9c3f';
      g.fillRect(i, GRAPH_H - h, 1, h);
    }

    const targetY = GRAPH_H - this.targetMs * scale;
    g.fillStyle = '#ffffff40';
    g.fillRect(0, targetY, GRAPH_W, 1);
  }
}

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
}

/** `performance.memory` só existe no Chrome; ausente, o campo some da linha. */
function readHeapMb(): number {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  if (perf.memory === undefined) return 0;
  return Math.round(perf.memory.usedJSHeapSize / 1048576);
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#debug{position:fixed;top:0;left:0;padding:6px 8px;pointer-events:none;z-index:5;
  font:12px/1.45 ui-monospace,"Courier New",monospace;color:#fff;text-shadow:1px 1px 0 #000;
  background:#00000059;max-width:100%}
#debug pre{margin:0 0 4px;white-space:pre-wrap}
#debug .graph{display:block;image-rendering:pixelated;width:240px;height:80px;
  border:1px solid #ffffff33}
@media (max-width:480px){#debug{font-size:10px}#debug .graph{width:180px;height:60px}}
`;
  document.head.appendChild(css);
}
