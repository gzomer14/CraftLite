/**
 * Culling por conectividade de sections (M12, PROMPT.md §4.2: *"fortemente
 * recomendado — corta 60–80% do trabalho em cavernas"*).
 *
 * O frustum sozinho manda desenhar tudo que está na frente da câmera, inclusive
 * a montanha inteira atrás da parede de uma caverna. Aqui uma busca começa na
 * section da câmera e anda de vizinha em vizinha **só por onde dá para ver**:
 * entrar numa section pela face A e sair pela face B exige que A e B estejam
 * ligadas por ar (`world/mesh/visibility.ts`, calculado no worker). O que a
 * busca não alcança não vai para a lista de desenho.
 *
 * Duas regras seguram a busca:
 *
 * - **só para longe da câmera**: em cada eixo, anda-se para o lado em que a
 *   section está em relação à da câmera (ou para qualquer lado no mesmo plano).
 *   É geométrico, não depende do caminho: a busca nunca dá meia-volta;
 * - **cada section é visitada uma vez**, pela primeira face por onde a busca
 *   chega. Deixar reentrar por outra face (cada entrada liga a saídas
 *   diferentes) foi medido: na seed 11 com distância 8 alcança menos de 1% a
 *   mais, o teste por raios não achou nenhum bloco visível que a entrada única
 *   escondesse, e a busca custa o dobro (1,6–2,7 ms contra 0,8–1,4 ms no
 *   desktop). Ficou a entrada única.
 *
 * **A busca não depende de para onde a câmera olha.** Ela é refeita só quando
 * a câmera troca de section ou quando a conectividade muda; por quadro, o que
 * roda é o teste de frustum sobre as sections **com malha** que a busca
 * alcançou. A versão que podava pelo frustum dentro da busca custava 0,4–0,8 ms
 * **todo quadro** no desktop — num T0, cinco a dez vezes isso. Sem podar, a
 * busca alcança um pouco mais (é o conjunto de todas as direções), e isso só
 * erra a favor de desenhar.
 *
 * Malha nova **longe** da câmera (o anel carregando) não refaz a busca na hora:
 * ela espera `FAR_REFRESH_FRAMES` quadros e as de vários quadros saem numa busca
 * só. Durante o carregamento chega malha todo quadro, e sem isso a busca
 * rodaria todo quadro. Malha **perto** (cavar uma parede) refaz na hora — o
 * buraco novo tem que mostrar o que está do outro lado no mesmo quadro.
 *
 * Section que o worker nunca meshou (coluna só de ar, ou ainda na fila) conta
 * como transparente: na dúvida, desenha-se. Com a câmera acima do teto do
 * mundo, a busca começa por todas as sections do topo; abaixo do chão (só no
 * espectador), o culling se desliga.
 *
 * Nada aqui aloca por frame: a grade em volta da câmera e a fila são arrays
 * tipados, refeitos só quando a distância de render muda.
 */

import { chunkKey, SECTIONS_PER_COLUMN, SECTION_SIZE } from '../world/chunk';
import { VIS_ALL, VIS_PAIR } from '../world/mesh/visibility';
import type { Frustum } from '../core/math';

/** Passo de cada face, na ordem `FACE_*`: dx, dy, dz. */
const STEP = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
/** Face oposta. */
const OPPOSITE = [1, 0, 3, 2, 5, 4];
/** Bit do par (face de entrada `e`, face de saída `f`) na conectividade. */
const PAIR_BIT = new Int32Array(36);
for (let e = 0; e < 6; e++) {
  for (let f = 0; f < 6; f++) PAIR_BIT[e * 6 + f] = e === f ? 0 : 1 << VIS_PAIR[e * 6 + f];
}
/** Entrada da section da câmera: sai por qualquer face. */
const FROM_CAMERA = 6;

/** Folga além da distância de render: a histerese de descarga do pipeline. */
const GRID_MARGIN = 3;
/** Distância (em colunas) até onde malha nova refaz a busca no mesmo quadro. */
const NEAR_COLUMNS = 2;
/** Quadros que malha nova distante espera para refazer a busca. */
export const FAR_REFRESH_FRAMES = 15;

export class SectionCulling {
  /** Conectividade de cada section já meshada, por `sectionKey`. */
  private readonly visibility = new Map<number, number>();
  /** Sections que têm malha na GPU — só elas vão para a lista do quadro. */
  private readonly meshed = new Set<number>();

  private radius = -1;
  private side = 0;
  private stamp = 0;
  private visitedStamp = new Uint32Array(0);
  private queue = new Int32Array(0);
  private queueEntry = new Uint8Array(0);

  /** Células com malha alcançadas pela última busca. */
  private reached = new Int32Array(0);
  private reachedCount = 0;
  /** Onde a última busca começou; `NaN` força refazer. */
  private originCx = Number.NaN;
  private originCz = Number.NaN;
  private originSy = Number.NaN;
  /** A conectividade mudou perto da câmera: refaz no próximo quadro. */
  private stale = true;
  /** Mudou longe: refaz quando `farWait` chegar a zero. */
  private farPending = false;
  private farWait = 0;

  /** Sections com malha alcançadas **e** dentro do frustum no último `run`, por `sectionKey`. */
  visibleKeys = new Float64Array(0);
  visibleCount = 0;
  /** false quando o último `run` caiu no caminho sem culling (câmera abaixo do mundo). */
  culled = true;
  /** Quantas buscas já rodaram — o teste confere que girar a câmera não refaz. */
  searches = 0;

  /**
   * Guarda o que o worker disse de uma section que acabou de meshar: a
   * conectividade e se ela tem malha.
   */
  set(cx: number, cz: number, sy: number, visibility: number, hasMesh: boolean): void {
    const key = sectionKey(cx, cz, sy);
    const previous = this.visibility.get(key) ?? VIS_ALL;
    const hadMesh = this.meshed.has(key);
    if (previous === visibility && hadMesh === hasMesh) return;
    if (visibility === VIS_ALL) this.visibility.delete(key);
    else this.visibility.set(key, visibility);
    if (hasMesh) this.meshed.add(key);
    else this.meshed.delete(key);
    this.touched(cx, cz);
  }

  /** Esquece as sections de uma coluna descarregada. */
  releaseColumn(cx: number, cz: number): void {
    let changed = false;
    for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
      const key = sectionKey(cx, cz, sy);
      if (this.visibility.delete(key)) changed = true;
      if (this.meshed.delete(key)) changed = true;
    }
    if (changed) this.touched(cx, cz);
  }

  /** Algo mudou na coluna: refaz a busca agora (perto) ou daqui a pouco (longe). */
  private touched(cx: number, cz: number): void {
    if (Math.abs(cx - this.originCx) <= NEAR_COLUMNS && Math.abs(cz - this.originCz) <= NEAR_COLUMNS) {
      this.stale = true;
    } else if (!this.farPending) {
      this.farPending = true;
      this.farWait = FAR_REFRESH_FRAMES;
    }
  }

  clear(): void {
    this.visibility.clear();
    this.meshed.clear();
    this.stale = true;
  }

  /** Dimensiona a grade para a distância de render (em colunas). */
  setRadius(renderDistance: number): void {
    const radius = renderDistance + GRID_MARGIN;
    if (radius === this.radius) return;
    this.radius = radius;
    this.side = radius * 2 + 1;
    const cells = this.side * this.side * SECTIONS_PER_COLUMN;
    this.visitedStamp = new Uint32Array(cells);
    this.queue = new Int32Array(cells);
    this.queueEntry = new Uint8Array(cells);
    this.reached = new Int32Array(cells);
    this.visibleKeys = new Float64Array(cells);
    this.stamp = 0;
    this.stale = true;
  }

  /**
   * As sections a desenhar neste quadro: as com malha que a busca alcança,
   * cortadas pelo frustum. O resultado fica em `visibleKeys[0 .. visibleCount)`.
   */
  run(frustum: Frustum, camX: number, camY: number, camZ: number): void {
    if (this.radius < 0) this.setRadius(8);
    this.visibleCount = 0;
    const camCx = Math.floor(camX / SECTION_SIZE);
    const camCz = Math.floor(camZ / SECTION_SIZE);
    const camSy = Math.floor(camY / SECTION_SIZE);
    if (camSy < 0) {
      this.culled = false;
      return;
    }
    this.culled = true;

    // Acima do teto, qualquer altura é o mesmo ponto de partida.
    const originSy = Math.min(camSy, SECTIONS_PER_COLUMN);
    if (this.farPending) this.farWait--;
    const moved = camCx !== this.originCx || camCz !== this.originCz || originSy !== this.originSy;
    if (this.stale || moved || (this.farPending && this.farWait <= 0)) {
      this.originCx = camCx;
      this.originCz = camCz;
      this.originSy = originSy;
      this.search(camCx, camCz, originSy);
      this.stale = false;
      this.farPending = false;
    }

    const R = this.radius;
    const side = this.side;
    for (let i = 0; i < this.reachedCount; i++) {
      const cell = this.reached[i];
      const sy = cell % SECTIONS_PER_COLUMN;
      const column = (cell - sy) / SECTIONS_PER_COLUMN;
      const gx = column % side;
      const gz = (column - gx) / side;
      const cx = camCx + gx - R;
      const cz = camCz + gz - R;
      const x0 = cx * SECTION_SIZE;
      const y0 = sy * SECTION_SIZE;
      const z0 = cz * SECTION_SIZE;
      if (!frustum.intersectsAabb(x0, y0, z0, x0 + SECTION_SIZE, y0 + SECTION_SIZE, z0 + SECTION_SIZE)) continue;
      this.visibleKeys[this.visibleCount++] = sectionKey(cx, cz, sy);
    }
  }

  /** A busca em largura a partir da section da câmera. */
  private search(camCx: number, camCz: number, camSy: number): void {
    this.searches++;
    this.reachedCount = 0;
    this.stamp++;
    if (this.stamp === 0xffffffff) {
      this.visitedStamp.fill(0);
      this.stamp = 1;
    }
    const R = this.radius;
    const side = this.side;

    let head = 0;
    let tail = 0;
    if (camSy >= SECTIONS_PER_COLUMN) {
      // Acima do teto do mundo: tudo que se vê entra pelo topo.
      const sy = SECTIONS_PER_COLUMN - 1;
      for (let column = 0; column < side * side; column++) {
        const cell = column * SECTIONS_PER_COLUMN + sy;
        this.visitedStamp[cell] = this.stamp;
        this.queue[tail] = cell;
        this.queueEntry[tail++] = 2;
      }
    } else {
      const cell = (R * side + R) * SECTIONS_PER_COLUMN + camSy;
      this.visitedStamp[cell] = this.stamp;
      this.queue[tail] = cell;
      this.queueEntry[tail++] = FROM_CAMERA;
    }
    const topY = Math.min(camSy, SECTIONS_PER_COLUMN - 1);

    while (head < tail) {
      const cell = this.queue[head];
      const entry = this.queueEntry[head++];
      const sy = cell % SECTIONS_PER_COLUMN;
      const column = (cell - sy) / SECTIONS_PER_COLUMN;
      const gx = column % side;
      const gz = (column - gx) / side;
      const relX = gx - R;
      const relY = sy - topY;
      const relZ = gz - R;
      const key = sectionKey(camCx + relX, camCz + relZ, sy);
      if (this.meshed.has(key)) this.reached[this.reachedCount++] = cell;
      const vis = entry === FROM_CAMERA ? VIS_ALL : this.visibility.get(key) ?? VIS_ALL;

      for (let f = 0; f < 6; f++) {
        const sx = STEP[f * 3];
        const sY = STEP[f * 3 + 1];
        const sz = STEP[f * 3 + 2];
        // Só para longe da câmera (ou de lado, no mesmo plano).
        if ((sx !== 0 && sx * relX < 0) || (sY !== 0 && sY * relY < 0) || (sz !== 0 && sz * relZ < 0)) {
          continue;
        }
        if (entry !== FROM_CAMERA && (vis & PAIR_BIT[entry * 6 + f]) === 0) continue;

        const ny = sy + sY;
        if (ny < 0 || ny >= SECTIONS_PER_COLUMN) continue;
        const ngx = gx + sx;
        const ngz = gz + sz;
        if (ngx < 0 || ngz < 0 || ngx >= side || ngz >= side) continue;

        const next = (ngz * side + ngx) * SECTIONS_PER_COLUMN + ny;
        if (this.visitedStamp[next] === this.stamp) continue;
        this.visitedStamp[next] = this.stamp;
        this.queue[tail] = next;
        this.queueEntry[tail++] = OPPOSITE[f];
      }
    }
  }
}

/** Chave de section: a mesma do `ChunkRenderer` e das sections sujas do `World`. */
export function sectionKey(cx: number, cz: number, sy: number): number {
  return chunkKey(cx, cz) * SECTIONS_PER_COLUMN + sy;
}

/**
 * Faces que podem estar viradas para a câmera numa section de canto mínimo
 * `(x0, y0, z0)` (M12, culling por direção de face). Bit por `FACE_*`.
 *
 * Uma face +X de voxel fica no plano `x0 + lx + 1`, com `lx` de 0 a 15; ela só
 * é vista de quem está além desse plano. Se a câmera não passou de `x0`,
 * nenhuma face +X da section olha para ela. O teste usa a borda da section e
 * não a do voxel, então nunca esconde uma face visível: erra só a favor de
 * desenhar. Em terreno aberto, metade das laterais e todas as faces de baixo
 * caem aqui — é vértice que a GPU móvel deixa de transformar.
 */
export function facingFaces(
  x0: number, y0: number, z0: number, camX: number, camY: number, camZ: number,
): number {
  let faces = 0;
  if (camX > x0) faces |= 1 << 0;
  if (camX < x0 + SECTION_SIZE) faces |= 1 << 1;
  if (camY > y0) faces |= 1 << 2;
  if (camY < y0 + SECTION_SIZE) faces |= 1 << 3;
  if (camZ > z0) faces |= 1 << 4;
  if (camZ < z0 + SECTION_SIZE) faces |= 1 << 5;
  return faces;
}
