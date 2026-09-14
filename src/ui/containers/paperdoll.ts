/**
 * Boneco do jogador na tela de inventário (doc 08 §3.5).
 *
 * O doc pede "um canvas WebGL pequeno (ou reusa o principal com scissor)" e
 * abre a exceção: *"Em T0, pode ser um sprite estático"*. **Este é o caminho da
 * exceção, para todos os tiers**, e o motivo é declarado aqui: um segundo
 * contexto WebGL num aparelho de 2 GB custa um pool de buffers, um programa e
 * uma cópia do atlas de entidade; um `scissor` no principal obrigaria o passe
 * de mobs a rodar com outra matriz no meio do frame de jogo, atrás de uma tela
 * de interface que já pausou a câmera. O que o jogador precisa ver — o que ele
 * está vestindo — cabe num desenho 2D das faces frontais.
 *
 * O desenho é ortográfico de frente, parte por parte, com as faces que o
 * próprio modelo já mapeia (`data/mobmodels.ts` + `render/skingen.ts`). Nada de
 * arte nova: a skin é gerada por código como a de qualquer mob (doc 13 §1).
 *
 * A cabeça acompanha o ponteiro, que é o que o doc pede — por deslocamento, não
 * por rotação: girar exigiria as faces laterais e um rasterizador.
 */

import { MODELS, faceRect, type PartDef } from '../../data/mobmodels';
import { MOB_SKINS } from '../../data/mobskins';
import { generateSkin } from '../../render/skingen';

/** Modelo do jogador: o mesmo humanoide dos mobs. */
const MODEL = MODELS.humanoid;
/** Pixels de canvas por unidade de modelo (1/16 de bloco). */
const PIXELS_PER_UNIT = 2;
/** Margem em unidades, para o braço não encostar na borda. */
const MARGIN = 2;
/** Meia largura do desenho em unidades: braço a braço mais a margem. */
const HALF_WIDTH = 8 + MARGIN;
/** Deslocamento máximo da cabeça ao seguir o ponteiro, em unidades. */
const HEAD_TRACK = 1.5;

export const DOLL_WIDTH_UNITS = HALF_WIDTH * 2;
export const DOLL_HEIGHT_UNITS = MODEL.height + MARGIN * 2;

/** Peça do modelo coberta por cada slot de armadura, na ordem dos slots. */
const ARMOR_PARTS: readonly (readonly string[])[] = [
  ['head'],
  ['body', 'armRight', 'armLeft'],
  ['legRight', 'legLeft'],
  ['legRight', 'legLeft'],
];
/** Fração vertical da peça que cada slot de armadura pinta: [de, até]. */
const ARMOR_SPAN: readonly (readonly [number, number])[] = [
  [0, 1],      // elmo: a cabeça inteira
  [0, 1],      // peitoral: torso e braços inteiros
  [0, 0.55],   // calça: a coxa
  [0.7, 1],    // bota: o pé
];

export interface DrawPart {
  part: PartDef;
  /** Canto superior esquerdo no canvas, em unidades. */
  x: number;
  y: number;
  /** Retângulo da face frontal na skin: x, y, w, h. */
  src: Float32Array;
  /** Profundidade para ordenar do fundo para a frente. */
  depth: number;
}

/**
 * O boneco. Uma instância por tela; `draw` só toca no canvas quando alguma
 * coisa muda, como o resto do HUD.
 */
export class PaperDoll {
  readonly element: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly parts: DrawPart[] = [];
  /** A skin desenhada uma vez num canvas, para servir de fonte do `drawImage`. */
  private readonly source: HTMLCanvasElement | null = null;
  /** Olhar da cabeça, −1..1 em cada eixo. */
  private lookX = 0;
  private lookY = 0;
  /** Última assinatura desenhada, para não repintar à toa. */
  private lastKey = '';

  constructor() {
    this.element = document.createElement('canvas');
    this.element.className = 'paperdoll';
    this.element.width = DOLL_WIDTH_UNITS * PIXELS_PER_UNIT;
    this.element.height = DOLL_HEIGHT_UNITS * PIXELS_PER_UNIT;
    this.element.setAttribute('aria-hidden', 'true');

    this.ctx = get2d(this.element);
    this.buildParts();

    this.source = buildSkinCanvas();

    // Seguir o ponteiro é enfeite: se o canvas não existe, nada disso importa.
    if (this.ctx !== null) {
      this.element.addEventListener('pointermove', (e) => this.trackPointer(e));
      this.element.addEventListener('pointerleave', () => {
        this.lookX = 0; this.lookY = 0; this.lastKey = '';
      });
    }
  }

  /** Monta a lista de peças já projetada, uma vez. */
  private buildParts(): void {
    for (const drawn of projectParts()) this.parts.push(drawn);
  }

  private trackPointer(e: PointerEvent): void {
    const rect = this.element.getBoundingClientRect?.();
    if (rect === undefined || rect.width === 0 || rect.height === 0) return;
    this.lookX = clamp11(((e.clientX - rect.left) / rect.width) * 2 - 1);
    this.lookY = clamp11(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.lastKey = '';
  }

  /**
   * Redesenha o boneco.
   *
   * `armor` traz a cor de cada peça vestida (ou `null` no slot vazio), na ordem
   * elmo/peitoral/calça/bota — quem sabe traduzir item em cor é a tela, que já
   * faz isso para os slots.
   */
  draw(armor: readonly (string | null)[]): void {
    const ctx = this.ctx;
    const source = this.source;
    if (ctx === null || source === null) return;

    const key = `${armor.join('|')}|${this.lookX.toFixed(2)}|${this.lookY.toFixed(2)}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    ctx.clearRect(0, 0, this.element.width, this.element.height);
    ctx.imageSmoothingEnabled = false;

    for (const entry of this.parts) {
      const tracking = entry.part.name === 'head';
      const dx = tracking ? this.lookX * HEAD_TRACK : 0;
      const dy = tracking ? this.lookY * HEAD_TRACK * 0.6 : 0;
      const x = (entry.x + dx) * PIXELS_PER_UNIT;
      const y = (entry.y + dy) * PIXELS_PER_UNIT;
      const w = entry.part.box[3] * PIXELS_PER_UNIT;
      const h = entry.part.box[4] * PIXELS_PER_UNIT;

      ctx.drawImage(
        source, entry.src[0], entry.src[1], entry.src[2], entry.src[3], x, y, w, h,
      );

      // Armadura por cima, translúcida: ela cobre a peça, não a substitui.
      for (let slot = 0; slot < armor.length; slot++) {
        const color = armor[slot];
        if (color === null || !ARMOR_PARTS[slot]?.includes(entry.part.name)) continue;
        const span = ARMOR_SPAN[slot];
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = color;
        ctx.fillRect(x, y + h * span[0], w, h * (span[1] - span[0]));
        ctx.globalAlpha = 1;
      }
    }
  }
}

/**
 * Projeta o modelo do jogador em vista frontal ortográfica, do fundo para a
 * frente. Pura de propósito: é a única parte do boneco que dá para conferir
 * sem canvas, e é onde um erro de sinal esconderia o jogador de cabeça para
 * baixo ou espelhado.
 */
export function projectParts(): DrawPart[] {
  const out: DrawPart[] = [];
  for (const part of MODEL.parts) {
    const src = new Float32Array(4);
    faceRect(part, 'front', src);
    const px = part.pivot[0] + part.box[0];
    const py = part.pivot[1] + part.box[1];
    const pz = part.pivot[2] + part.box[2];
    /*
     * Vista de frente: a câmera está em +Z olhando para −Z, e nessa orientação
     * a **direita de quem olha é o +X do modelo**. Como a direita do mob é −X
     * (ver o cabeçalho de `data/mobmodels.ts`), o braço direito do jogador
     * aparece à esquerda da tela — que é o que se vê olhando alguém de frente.
     */
    out.push({
      part,
      x: HALF_WIDTH + px,
      y: MARGIN + (MODEL.height - (py + part.box[4])),
      src,
      depth: pz + part.box[5],
    });
  }
  // Do fundo para a frente: o que tem z maior está mais perto de quem olha.
  out.sort((a, b) => a.depth - b.depth);
  return out;
}

/** −1..1. */
function clamp11(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Contexto 2D, ou `null` fora do navegador (o ambiente de teste é Node). */
function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext?.('2d') ?? null;
  } catch {
    return null;
  }
}

/**
 * A skin do jogador num canvas, pronta para servir de fonte do `drawImage`.
 *
 * Gerada uma vez por carregamento e compartilhada: o boneco é sempre o mesmo
 * jogador. A receita vive em `data/mobskins.ts` junto com as dos mobs, e **não
 * entra no atlas de entidade** — ele só sobe as skins que algum mob usa.
 */
let skinCanvas: HTMLCanvasElement | null | undefined;
function buildSkinCanvas(): HTMLCanvasElement | null {
  if (skinCanvas !== undefined) return skinCanvas;
  skinCanvas = null;
  const recipe = MOB_SKINS.player;
  if (recipe === undefined) return null;
  try {
    const size = MODEL.skinSize;
    const pixels = generateSkin(MODEL, recipe, 0);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = get2d(canvas);
    if (ctx === null) return null;
    const image = ctx.createImageData(size, size);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    skinCanvas = canvas;
  } catch {
    // Sem canvas 2D o boneco simplesmente não aparece; a tela continua inteira.
    skinCanvas = null;
  }
  return skinCanvas;
}
