/**
 * Orquestra os passes de render (doc 01 §5.3) e o dimensionamento do canvas.
 *
 * Ordem: céu → terreno opaco (front-to-back) → cutout → translúcido.
 * Entidades, partículas e item na mão entram nos marcos seguintes, nos pontos
 * já reservados em `render()`.
 */

import { Camera } from './camera';
import { ChunkRenderer } from './chunkrenderer';
import { CloudsPass } from './clouds';
import { Particles } from './particles';
import { SelectionPass } from './selection';
import { SkyPass } from './sky';
import { dimensionOf } from '../data/dimensions';
import { TerrainPass, type SkyParams } from './terrain';
import type { Atlas } from './atlas';
import type { GlContext } from './gl';
import type { Preset } from '../core/tier';
import { clamp, type Mat4 } from '../core/math';

/** O que o render precisa saber sobre o bloco mirado neste frame. */
export interface HighlightState {
  visible: boolean;
  x: number;
  y: number;
  z: number;
  /** 0..9, ou −1 se não está sendo quebrado. */
  stage: number;
  /** Brilho médio da textura do bloco mirado (0..1), para tingir a fissura. */
  brightness: number;
  /**
   * Caixa envolvente da forma do bloco mirado, em fração de bloco.
   *
   * Quem preenche é `main.ts`, com `boundsFor`. O contorno e a rachadura saem
   * do tamanho do que está sendo mirado — uma laje acende meia caixa, uma
   * tocha acende um poste.
   */
  bounds: Float32Array;
}

/**
 * Fator de "dia" no Nether: constante e baixo. Zero apagaria o terreno todo,
 * porque a luz do céu é o que o shader usa como iluminação global.
 */
const NETHER_DAY_FACTOR = 0.35;

export class Renderer {
  readonly ctx: GlContext;
  readonly camera = new Camera();
  readonly chunks: ChunkRenderer;

  private readonly terrain: TerrainPass;
  private readonly sky: SkyPass;
  private readonly selection: SelectionPass;
  readonly particles: Particles;
  readonly clouds: CloudsPass;

  /** Bloco mirado neste frame. Mutado no lugar pelo chamador. */
  readonly highlight: HighlightState = {
    visible: false, x: 0, y: 0, z: 0, stage: -1, brightness: 1,
    bounds: new Float32Array([0, 0, 0, 1, 1, 1]),
  };

  /** Itens no chão, preenchidos pelo chamador antes do render. */
  itemRenderer: { render: (viewProj: Mat4, view: Mat4) => number; pending: number } | null = null;
  /** Mobs e flechas, preenchidos pelo chamador antes do render. */
  mobRenderer: { render: (viewProj: Mat4, sky: SkyParams) => number; pending: number } | null = null;
  /** Item na mão em primeira pessoa; `null` desliga o passe. */
  handRenderer: {
    render: (aspect: number, alpha: number, light: number) => number;
  } | null = null;
  /** Luz do bloco onde o jogador está (0..1), para a mão escurecer na caverna. */
  handLight = 1;
  /**
   * Piso de luz ambiente, do controle de Brilho (doc 08 §6). O `update` mexe
   * no resto do `skyParams` a cada frame, então o valor escolhido pelo jogador
   * mora aqui e é reaplicado lá.
   */
  minSkyLight = 0.06;
  /**
   * Névoa do doc 08 §3.11: `off` sem névoa, `near` densa, `far` o padrão.
   *
   * Multiplica a densidade calculada a partir da distância de render — ela
   * continua sendo a base, porque é ela que esconde a borda do mundo carregado.
   */
  fogMode: 'off' | 'near' | 'far' = 'far';
  /**
   * Clarão do relâmpago, 0..1 (doc 03 §8). Quem zera por acessibilidade é o
   * `Weather`, não este campo: aqui ele só é aplicado.
   */
  skyFlash = 0;
  /** Contorno do bloco mirado em alto contraste (doc 08 §6). */
  set highContrastOutline(value: boolean) {
    this.selection.highContrast = value;
  }
  /** Cor fixa de céu e névoa da dimensão; `null` = céu com ciclo de dia. */
  private fogOverride: readonly [number, number, number] | null = null;
  /** Piso de luz da dimensão, 0..1 (o Nether nunca é preto absoluto). */
  private ambient = 0;
  /** Dimensão com céu: sem céu não há nuvem para desenhar. */
  private hasSky = true;
  /** Tick do dia do último `setDayTime`, que as nuvens usam para andar. */
  private dayTime = 0;
  /** Densidade de névoa da distância de render, antes do modo do jogador. */
  private baseFogDensity = 0.006;
  private readonly skyParams: SkyParams = {
    fogColor: new Float32Array(3),
    fogDensity: 0.006,
    dayFactor: 1,
    minSkyLight: 0.06,
  };

  /** Escala de resolução, mexida pela escala dinâmica (doc 02 §5.7). */
  renderScale: number;
  private readonly maxDpr: number;

  width = 1;
  height = 1;
  drawCalls = 0;
  vertices = 0;

  constructor(ctx: GlContext, atlas: Atlas, preset: Preset) {
    this.ctx = ctx;
    this.terrain = new TerrainPass(ctx, atlas);
    this.sky = new SkyPass(ctx);
    this.selection = new SelectionPass(ctx, atlas);
    this.particles = new Particles(ctx, preset);
    this.clouds = new CloudsPass(ctx);
    this.clouds.mode = preset.clouds;
    this.chunks = new ChunkRenderer(ctx);
    this.renderScale = preset.renderScale;
    this.maxDpr = preset.maxDpr;

    this.setRenderDistance(preset.renderDistance);

    const gl = ctx.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearDepth(1);

    this.resize();
  }

  /**
   * Ajusta o plano distante e a névoa à distância de render, em chunks.
   *
   * Os dois andam juntos: o plano distante curto corta o terreno antes da
   * névoa escondê-lo, e a névoa fixa apaga o que o plano distante deixou ver.
   * Fica num método só para que mudar a opção em jogo não esqueça um dos dois.
   */
  setRenderDistance(distance: number): void {
    const blocks = Math.max(1, distance) * 16;
    this.camera.far = Math.max(160, blocks + 64);
    // Densa o bastante para esconder a borda do mundo carregado, mas não tanto
    // que apague o terreno visível: ~85% da distância de render.
    this.baseFogDensity = 1.0 / (blocks * 0.85);
    this.applyFog();
  }

  /**
   * Aplica o modo de névoa sobre a densidade da distância de render.
   *
   * `off` não zera de verdade: zero apagaria a mistura no shader e deixaria o
   * terreno recortado contra o céu na borda do mundo carregado. O que ele faz é
   * empurrar a névoa para muito longe — o efeito que o jogador quer ("quero ver
   * longe") sem o artefato que ele não pediu.
   */
  applyFog(): void {
    const factor = this.fogMode === 'off' ? 0.25 : this.fogMode === 'near' ? 1.8 : 1;
    this.skyParams.fogDensity = this.baseFogDensity * factor;
  }

  resize(): void {
    const canvas = this.ctx.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    const w = Math.max(1, Math.round(cssW * dpr * this.renderScale));
    const h = Math.max(1, Math.round(cssH * dpr * this.renderScale));
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    this.width = w;
    this.height = h;
  }

  setRenderScale(scale: number): void {
    const next = clamp(scale, 0.6, 1);
    if (Math.abs(next - this.renderScale) < 0.001) return;
    this.renderScale = next;
    this.resize();
  }

  /**
   * Dimensão desenhada (M7). No Nether não há ciclo de dia: o céu é a cor de
   * `data/dimensions.ts` e o piso de luz sobe, senão a dimensão sem céu fica
   * preta a três metros do jogador.
   */
  setDimension(dimension: number): void {
    const def = dimensionOf(dimension);
    this.fogOverride = def.fog;
    this.ambient = def.ambientLight / 15;
    this.hasSky = def.hasSky;
  }

  /** `dayTime` em ticks do dia (0..23999). */
  /**
   * `rain` é 0..1 (doc 03 §8). Ele acinzenta o céu e o fog no mesmo passo:
   * escurecer só o céu deixaria o terreno distante brilhando na tempestade.
   */
  setDayTime(dayTime: number, dayFactor: number, rain = 0): void {
    this.dayTime = dayTime;
    this.sky.update(dayTime);
    this.sky.applyRain(rain);
    this.skyParams.minSkyLight = Math.max(this.minSkyLight, this.ambient);

    const override = this.fogOverride;
    if (override !== null) {
      // Dimensão sem céu: fator de dia fixo e o horizonte pintado por tabela.
      this.skyParams.dayFactor = NETHER_DAY_FACTOR;
      this.sky.override(override);
      this.skyParams.fogColor.set(this.sky.horizon);
      return;
    }
    this.skyParams.dayFactor = dayFactor * (1 - rain * 0.45);
    /*
     * O raio clareia céu, névoa e iluminação global no mesmo passo.
     *
     * Clarear só o céu deixaria o terreno preto contra um flash branco, que é
     * o oposto do efeito: o que o relâmpago faz é **iluminar a paisagem** por
     * um instante.
     */
    if (this.skyFlash > 0) {
      const t = Math.min(1, this.skyFlash) * 0.75;
      for (let c = 0; c < 3; c++) {
        this.sky.zenith[c] += (1 - this.sky.zenith[c]) * t;
        this.sky.horizon[c] += (1 - this.sky.horizon[c]) * t;
      }
      this.skyParams.dayFactor = Math.max(this.skyParams.dayFactor, t);
    }
    // O fog usa a cor do horizonte: se divergir, o terreno distante fica
    // recortado contra o céu.
    this.skyParams.fogColor.set(this.sky.horizon);
  }

  render(alpha: number): void {
    const gl = this.ctx.gl;
    this.resize();
    this.camera.update(alpha, this.width / this.height);

    gl.viewport(0, 0, this.width, this.height);
    // Limpa na cor do horizonte, não em preto: se um frame chegar antes do
    // passe de céu (troca de resolução, contexto recriado), o jogador vê o céu
    // por um instante em vez de um flash preto.
    const fog = this.skyParams.fogColor;
    gl.clearColor(fog[0], fog[1], fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 1. céu
    this.sky.render(this.camera.viewProj, this.skyParams.dayFactor);

    // Culling + montagem da lista de desenho.
    this.chunks.buildDrawLists(
      this.camera.frustum, this.camera.renderX, this.camera.renderY, this.camera.renderZ,
    );

    let calls = 0;

    // 2. terreno opaco, front-to-back (early-Z ajuda muito em GPU mobile)
    this.terrain.begin(this.camera.viewProj, this.skyParams, false);
    calls += this.chunks.draw('opaque', this.setOriginOpaque);
    this.terrain.end();

    // 2b. cutout (folhas, vidro): mesmo passe, com alpha test
    this.terrain.begin(this.camera.viewProj, this.skyParams, true);
    calls += this.chunks.draw('cutout', this.setOriginCutout);
    this.terrain.end();

    // 2c. nuvens: depois do terreno opaco, para a montanha na frente escondê-las
    // e o chão sumir por baixo de quem voa acima delas. Sem céu, sem nuvem.
    if (this.hasSky) {
      calls += this.clouds.render(
        this.camera.viewProj, this.camera.renderX, this.camera.renderZ,
        this.dayTime, this.skyParams.dayFactor,
      );
    }

    // 3. entidades: mobs, flechas e itens no chão
    if (this.mobRenderer !== null && this.mobRenderer.pending > 0) {
      calls += this.mobRenderer.render(this.camera.viewProj, this.skyParams);
    }
    if (this.itemRenderer !== null && this.itemRenderer.pending > 0) {
      calls += this.itemRenderer.render(this.camera.viewProj, this.camera.view);
    }

    // 3b. contorno do bloco mirado e rachadura de quebra
    if (this.highlight.visible) {
      const h = this.highlight;
      this.selection.drawOutline(this.camera.viewProj, h.x, h.y, h.z, h.bounds);
      calls++;
      if (h.stage >= 0) {
        this.selection.drawCrack(
          this.camera.viewProj, h.x, h.y, h.z, h.stage, h.brightness, h.bounds,
        );
        calls++;
      }
    }

    // 4. translúcido (água), back-to-front, sem depth write
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    this.terrain.begin(this.camera.viewProj, this.skyParams, false);
    calls += this.chunks.draw('translucent', this.setOriginOpaque);
    this.terrain.end();
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // 5. partículas
    if (this.particles.active > 0) {
      this.particles.render(this.camera.viewProj, this.camera.view, alpha);
      calls++;
    }

    // 6. item na mão: por último e com a profundidade limpa, para nunca
    // atravessar parede (doc 01 §191).
    if (this.handRenderer !== null) {
      calls += this.handRenderer.render(this.width / this.height, alpha, this.handLight);
    }

    this.drawCalls = calls;
    this.vertices = this.chunks.vertices;
  }

  /** Bound uma vez: passar um closure novo por section alocaria por frame. */
  private readonly setOriginOpaque = (x: number, y: number, z: number): void => {
    this.terrain.setOrigin(x, y, z, false);
  };

  private readonly setOriginCutout = (x: number, y: number, z: number): void => {
    this.terrain.setOrigin(x, y, z, true);
  };

  dispose(): void {
    this.chunks.dispose();
    this.clouds.dispose();
    this.sky.dispose();
    this.selection.dispose();
    this.particles.dispose();
  }
}
