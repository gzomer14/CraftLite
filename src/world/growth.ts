/**
 * Crescimento de plantação e umidade da terra arada (doc 14 — M6).
 *
 * **Não é um random tick à moda do original.** Sortear voxels por section custa
 * caro em T0 e desperdiça 99,9% dos sorteios em pedra: aqui o mundo mantém um
 * **registro das posições que crescem**, alimentado pelo evento de mudança de
 * bloco e por uma varredura única quando um chunk entra. O tick percorre esse
 * registro em rodízio, com orçamento duro por tick — a mesma disciplina dos
 * fluidos (doc 03 §9) e do A* dos mobs (doc 07 §3).
 *
 * Consequência declarada: uma roça gigante cresce mais devagar por planta, e
 * nunca derruba o frame. É o trade-off certo para o aparelho-alvo.
 */

import {
  AIR, BLOCK_BY_NAME, DIRT, FARMLAND, GRASS_BLOCK, PODZOL, WATER,
  blockIdOf, defOf, makeState, stateBitsOf,
} from '../data/blocks';
import { cropOfState, type CropDef } from '../data/crops';
import { plantOfState, type PlantDef } from '../data/plants';
import { TREE_MAX_HEIGHT, growTree, type TreeRng, type TreeWriter } from './trees';
import { WORLD_HEIGHT } from './chunk';
import type { BlockSource, World } from './world';

/** Ticks de uma varredura completa do registro (2 s). */
export const SWEEP_TICKS = 40;
/** Teto de posições visitadas por tick — o orçamento duro. */
export const MAX_PER_TICK = 16;
/** Umidade máxima da terra arada (bits de estado 0..7, doc 04 §2.5). */
export const MAX_MOISTURE = 7;
/** Raio horizontal em que a água molha a terra. */
const WATER_RANGE = 4;
/** Luz mínima para a plantação crescer. */
const MIN_LIGHT = 9;
/** Fração da chance de crescer quando a terra está seca. */
const DRY_PENALTY = 0.5;
/** Luz mínima acima da terra para a grama pegar nela (doc 03 §9: "luz ≥ 4"). */
const GRASS_MIN_LIGHT = 4;
/** Chance de a grama pegar numa terra vizinha, por visita. */
const GRASS_SPREAD_CHANCE = 0.1;
/** Chão em que muda vira árvore. */
const TREE_SOIL = new Set<number>([
  GRASS_BLOCK, DIRT, PODZOL, BLOCK_BY_NAME.get('coarse_dirt')?.id ?? DIRT,
]);

/** Limite de coordenada horizontal que a chave de posição comporta. */
const XZ_MASK = 0xfffff;
const XZ_SIGN = 0x80000;

export interface GrowthEvents {
  /** A plantação perdeu o suporte e caiu — quem ouve dropa os itens. */
  onCropBroken?(x: number, y: number, z: number, state: number): void;
  /** A plantação avançou de idade — usado para o som e para o save. */
  onGrown?(x: number, y: number, z: number, state: number): void;
  /**
   * Um bloco mudou por crescimento que não é idade de roça: árvore nascendo,
   * cana subindo, grama pegando. A luz precisa saber — uma copa faz sombra.
   */
  onChanged?(x: number, y: number, z: number, previous: number, state: number): void;
}

export class Growth {
  private readonly world: World;
  private readonly events: GrowthEvents;
  /** Posições registradas, em rodízio. */
  private readonly keys: number[] = [];
  /** Chave → índice em `keys`, para remover em O(1) trocando com o último. */
  private readonly index = new Map<number, number>();
  private cursor = 0;
  /** Aleatório do jogo; os testes injetam um determinístico. */
  random: () => number = Math.random;

  /** Quantas posições foram visitadas no último tick (overlay de debug). */
  lastVisited = 0;

  constructor(world: World, events: GrowthEvents = {}) {
    this.world = world;
    this.events = events;
  }

  get registered(): number {
    return this.keys.length;
  }

  /** Liga o registro ao mundo: toda mudança de bloco entra ou sai daqui. */
  attach(): () => void {
    return this.world.onBlockChange((change) => {
      this.onBlockChanged(
        change.x, change.y, change.z, change.previous, change.state, change.source,
      );
    });
  }

  /** Registra a posição se o bloco dela cresce; remove se não cresce mais. */
  track(x: number, y: number, z: number): void {
    if (isGrowing(this.world.getBlock(x, y, z))) this.add(key(x, y, z));
    else this.remove(key(x, y, z));
  }

  /**
   * Varre uma coluna recém-carregada atrás de terra arada e plantação.
   *
   * Só olha as sections cuja **paleta** contém um id que cresce: sem esse
   * filtro seriam 32 mil consultas por chunk, das quais nenhuma útil no caso
   * comum de um chunk sem roça nenhuma.
   */
  scanChunk(chunk: {
    cx: number; cz: number;
    sections: { paletteLen: number; palette: Uint16Array; getByIndex(i: number): number }[];
  }): void {
    for (let sy = 0; sy < chunk.sections.length; sy++) {
      const section = chunk.sections[sy];
      let interesting = false;
      for (let p = 0; p < section.paletteLen; p++) {
        if (isGrowing(section.palette[p])) { interesting = true; break; }
      }
      if (!interesting) continue;

      for (let i = 0; i < 4096; i++) {
        if (!isGrowing(section.getByIndex(i))) continue;
        const x = chunk.cx * 16 + (i & 15);
        const z = chunk.cz * 16 + ((i >> 4) & 15);
        const y = sy * 16 + (i >> 8);
        this.add(key(x, y, z));
      }
    }
  }

  /** Esquece tudo que estava registrado nesta coluna (chunk descarregado). */
  forgetChunk(cx: number, cz: number): void {
    for (let i = this.keys.length - 1; i >= 0; i--) {
      const k = this.keys[i];
      if ((unpackX(k) >> 4) === cx && (unpackZ(k) >> 4) === cz) this.remove(k);
    }
  }

  /**
   * Um tick: visita uma fatia do registro. A fatia é dimensionada para fechar
   * uma volta a cada `SWEEP_TICKS`, respeitando o teto por tick.
   */
  tick(): void {
    const total = this.keys.length;
    if (total === 0) {
      this.lastVisited = 0;
      return;
    }
    const slice = Math.min(MAX_PER_TICK, Math.max(1, Math.ceil(total / SWEEP_TICKS)));
    let visited = 0;
    for (let n = 0; n < slice && this.keys.length > 0; n++) {
      if (this.cursor >= this.keys.length) this.cursor = 0;
      const k = this.keys[this.cursor];
      const kept = this.visit(unpackX(k), unpackY(k), unpackZ(k));
      // `visit` que remove já trouxe outra chave para este índice.
      if (kept) this.cursor++;
      visited++;
    }
    this.lastVisited = visited;
  }

  // --- interno --------------------------------------------------------------

  /** Devolve false quando a posição saiu do registro. */
  private visit(x: number, y: number, z: number): boolean {
    const state = this.world.getBlock(x, y, z);
    const id = blockIdOf(state);

    if (id === FARMLAND) {
      this.tickFarmland(x, y, z, state);
      return true;
    }
    if (id === DIRT) return this.tickDirt(x, y, z);
    const plant = plantOfState(state);
    if (plant !== undefined) {
      if (plant.kind === 'tree') this.tickSapling(x, y, z, plant);
      else this.tickColumn(x, y, z, state, plant);
      return true;
    }
    const crop = cropOfState(state);
    if (crop === undefined) {
      this.remove(key(x, y, z));
      return false;
    }
    this.tickCrop(x, y, z, state, crop);
    return true;
  }

  /** Molha com água por perto; seca sem ela e, no fim, volta a ser terra. */
  private tickFarmland(x: number, y: number, z: number, state: number): void {
    const moisture = stateBitsOf(state);
    if (this.hasWaterNear(x, y, z)) {
      if (moisture < MAX_MOISTURE) {
        this.world.setBlock(x, y, z, makeState(FARMLAND, MAX_MOISTURE), 'physics');
      }
      return;
    }
    if (moisture > 0) {
      this.world.setBlock(x, y, z, makeState(FARMLAND, moisture - 1), 'physics');
      return;
    }
    // Terra seca só volta a ser terra comum se não tiver nada plantado nela.
    if (cropOfState(this.world.getBlock(x, y + 1, z)) !== undefined) return;
    this.world.setBlock(x, y, z, makeState(DIRT), 'physics');
  }

  /** Avança a idade se houver luz; cai se a terra sumiu debaixo dela. */
  private tickCrop(x: number, y: number, z: number, state: number, crop: CropDef): void {
    const soil = this.world.getBlock(x, y - 1, z);
    if (blockIdOf(soil) !== FARMLAND) {
      this.breakCrop(x, y, z, state);
      return;
    }

    const age = stateBitsOf(state);
    if (age >= crop.maxAge) return;

    const light = Math.max(
      this.world.getBlockLight(x, y, z), this.world.getSkyLight(x, y, z),
    );
    if (light < MIN_LIGHT) return;

    const moist = stateBitsOf(soil) > 0;
    const chance = crop.growChance * (moist ? 1 : DRY_PENALTY);
    if (this.random() >= chance) return;

    const next = makeState(blockIdOf(state), age + 1);
    this.world.setBlock(x, y, z, next, 'physics');
    this.events.onGrown?.(x, y, z, next);
  }

  /**
   * Muda que vira árvore (doc 03 §9). Precisa de luz, de chão de terra e de
   * **espaço**: o tronco inteiro tem que caber, senão ela espera — é o que
   * impede a árvore de atravessar o teto da casa de quem plantou dentro.
   */
  private tickSapling(x: number, y: number, z: number, plant: PlantDef): void {
    const kind = plant.tree;
    if (kind === undefined) return;
    if (!TREE_SOIL.has(blockIdOf(this.world.getBlock(x, y - 1, z)))) return;
    if (this.lightAt(x, y, z) < MIN_LIGHT) return;
    if (this.random() >= plant.chance) return;

    const height = TREE_MAX_HEIGHT[kind];
    if (y + height >= WORLD_HEIGHT) return;
    for (let dy = 1; dy < height; dy++) {
      const cell = this.world.getBlock(x, y + dy, z);
      if (blockIdOf(cell) !== AIR && !defOf(cell).replaceable) return;
    }
    growTree(this.treeWriter, this.treeRng, kind, x, y, z);
  }

  /**
   * Cana e cacto: só o **topo** da coluna cresce, até a altura da tabela. A
   * cana pede água encostada no chão em que foi plantada; o cacto pede os
   * lados livres, como no gênero.
   */
  private tickColumn(x: number, y: number, z: number, state: number, plant: PlantDef): void {
    if (blockIdOf(this.world.getBlock(x, y + 1, z)) !== AIR) return;
    const id = blockIdOf(state);
    let height = 1;
    while (blockIdOf(this.world.getBlock(x, y - height, z)) === id) height++;
    if (height >= (plant.maxHeight ?? 3)) return;
    if (plant.needsWater) {
      const soilY = y - height;
      let wet = false;
      for (let d = 0; d < 4 && !wet; d++) {
        const nx = x + SIDES[d * 2];
        const nz = z + SIDES[d * 2 + 1];
        if (blockIdOf(this.world.getBlock(nx, soilY, nz)) === WATER) wet = true;
      }
      if (!wet) return;
    }
    if (plant.needsClearSides) {
      for (let d = 0; d < 4; d++) {
        if (defOf(this.world.getBlock(x + SIDES[d * 2], y + 1, z + SIDES[d * 2 + 1])).solid) return;
      }
    }
    if (this.random() >= plant.chance) return;
    const next = makeState(id);
    if (this.world.setBlock(x, y + 1, z, next, 'physics')) {
      this.events.onChanged?.(x, y + 1, z, AIR, next);
    }
  }

  /**
   * Terra que vira grama (doc 03 §9, "Espalhamento: grass block → dirt
   * adjacente com luz ≥ 4").
   *
   * **Não varre o mundo.** A terra entra no registro por evento — quando o
   * jogador a expõe, a coloca, ou quando uma grama vizinha acabou de pegar —, e
   * sai quando não há grama perto ou quando algo opaco a cobre. É por isso que
   * um caminho pisado volta a ficar verde e que a terra gerada no fundo de uma
   * caverna não custa nada.
   *
   * Devolve false quando a posição saiu do registro.
   */
  private tickDirt(x: number, y: number, z: number): boolean {
    const above = defOf(this.world.getBlock(x, y + 1, z));
    if (above.opaque || !this.hasGrassNear(x, y, z)) {
      this.remove(key(x, y, z));
      return false;
    }
    if (this.lightAt(x, y + 1, z) < GRASS_MIN_LIGHT) return true;
    if (this.random() >= GRASS_SPREAD_CHANCE) return true;
    const next = makeState(GRASS_BLOCK);
    if (this.world.setBlock(x, y, z, next, 'physics')) {
      this.events.onChanged?.(x, y, z, makeState(DIRT), next);
    }
    // Virou grama: sai do registro, e `onTerrainChanged` já chamou as vizinhas.
    this.remove(key(x, y, z));
    return false;
  }

  /** Grama num cubo 3×3×3 em volta (a regra do gênero, de um degrau acima a um abaixo). */
  private hasGrassNear(x: number, y: number, z: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          if (blockIdOf(this.world.getBlock(x + dx, y + dy, z + dz)) === GRASS_BLOCK) return true;
        }
      }
    }
    return false;
  }

  /** Registra as terras em volta que podem pegar grama. */
  private trackDirtAround(x: number, y: number, z: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          if (blockIdOf(this.world.getBlock(nx, ny, nz)) !== DIRT) continue;
          if (defOf(this.world.getBlock(nx, ny + 1, nz)).opaque) continue;
          this.add(key(nx, ny, nz));
        }
      }
    }
  }

  /**
   * Registra uma terra descoberta **só se houver grama por perto**: cavar um
   * poço em terra expõe um bloco por golpe, e nenhum deles vai pegar grama.
   */
  private trackDirt(x: number, y: number, z: number): void {
    if (defOf(this.world.getBlock(x, y + 1, z)).opaque) return;
    if (!this.hasGrassNear(x, y, z)) return;
    this.add(key(x, y, z));
  }

  private lightAt(x: number, y: number, z: number): number {
    return Math.max(this.world.getBlockLight(x, y, z), this.world.getSkyLight(x, y, z));
  }

  /**
   * Escritor de árvore pelo `world.setBlock` (ver `trees.ts`). O tronco passa
   * por cima da muda e do que for substituível; a folha só entra no ar.
   */
  private readonly treeWriter: TreeWriter = {
    trunk: (x, y, z, state) => {
      const previous = this.world.getBlock(x, y, z);
      if (blockIdOf(previous) !== AIR && !defOf(previous).replaceable) return;
      if (this.world.setBlock(x, y, z, state, 'physics')) {
        this.events.onChanged?.(x, y, z, previous, state);
      }
    },
    leaf: (x, y, z, state) => {
      if (blockIdOf(this.world.getBlock(x, y, z)) !== AIR) return;
      if (this.world.setBlock(x, y, z, state, 'physics')) {
        this.events.onChanged?.(x, y, z, makeState(AIR), state);
      }
    },
  };

  /** Sorteio da forma da árvore, sobre o aleatório do jogo (injetável nos testes). */
  private readonly treeRng: TreeRng = {
    nextInt: (n) => Math.floor(this.random() * n),
    nextFloat: () => this.random(),
  };

  /** Arranca a plantação sem suporte. */
  private breakCrop(x: number, y: number, z: number, state: number): void {
    this.world.setBlock(x, y, z, AIR, 'physics');
    this.events.onCropBroken?.(x, y, z, state);
  }

  /** Água num quadrado de raio 4 na mesma altura (a terra fica encharcada). */
  private hasWaterNear(x: number, y: number, z: number): boolean {
    for (let dz = -WATER_RANGE; dz <= WATER_RANGE; dz++) {
      for (let dx = -WATER_RANGE; dx <= WATER_RANGE; dx++) {
        if (blockIdOf(this.world.getBlock(x + dx, y, z + dz)) === WATER) return true;
      }
    }
    return false;
  }

  private onBlockChanged(
    x: number, y: number, z: number, previous: number, state: number, source: BlockSource,
  ): void {
    if (isGrowing(state)) this.add(key(x, y, z));
    else if (isGrowing(previous)) this.remove(key(x, y, z));

    if (source !== 'gen') this.onTerrainChanged(x, y, z, state);

    // Tirou o chão da plantação: ela cai na hora, não na próxima varredura.
    const above = this.world.getBlock(x, y + 1, z);
    if (cropOfState(above) !== undefined && blockIdOf(state) !== FARMLAND) {
      this.breakCrop(x, y + 1, z, above);
    }
  }

  /**
   * O lado da grama numa mudança feita em jogo.
   *
   * - bloco opaco em cima da grama: ela vira terra na hora (sem luz, não há
   *   grama — e esperar a varredura deixaria o chão verde debaixo da casa);
   * - grama nova (colocada ou que acabou de pegar): as terras em volta entram
   *   no registro;
   * - terra nova, ou terra que ficou descoberta: entra no registro.
   */
  private onTerrainChanged(x: number, y: number, z: number, state: number): void {
    const id = blockIdOf(state);
    const def = defOf(state);
    const below = this.world.getBlock(x, y - 1, z);
    const belowId = blockIdOf(below);

    if (def.opaque && belowId === GRASS_BLOCK) {
      const dirt = makeState(DIRT);
      if (this.world.setBlock(x, y - 1, z, dirt, 'physics')) {
        this.events.onChanged?.(x, y - 1, z, below, dirt);
      }
    }
    if (id === GRASS_BLOCK) {
      this.trackDirtAround(x, y, z);
    } else if (id === DIRT) {
      this.trackDirt(x, y, z);
    } else if (!def.opaque && belowId === DIRT) {
      this.trackDirt(x, y - 1, z);
    }
  }

  private add(k: number): void {
    if (this.index.has(k)) return;
    this.index.set(k, this.keys.length);
    this.keys.push(k);
  }

  private remove(k: number): void {
    const at = this.index.get(k);
    if (at === undefined) return;
    const last = this.keys.length - 1;
    if (at !== last) {
      this.keys[at] = this.keys[last];
      this.index.set(this.keys[at], at);
    }
    this.keys.pop();
    this.index.delete(k);
  }
}

/** Direções horizontais: +X, −X, +Z, −Z. */
const SIDES = new Int8Array([1, 0, -1, 0, 0, 1, 0, -1]);

/** true se o bloco entra no registro de crescimento. */
export function isGrowing(state: number): boolean {
  return blockIdOf(state) === FARMLAND || cropOfState(state) !== undefined
    || plantOfState(state) !== undefined;
}

export function key(x: number, y: number, z: number): number {
  return ((x & XZ_MASK) * (XZ_MASK + 1) + (z & XZ_MASK)) * 128 + (y & 127);
}

function unpackY(k: number): number {
  return k % 128;
}

function unpackZ(k: number): number {
  return signed(Math.floor(k / 128) % (XZ_MASK + 1));
}

function unpackX(k: number): number {
  return signed(Math.floor(k / (128 * (XZ_MASK + 1))));
}

function signed(v: number): number {
  return v >= XZ_SIGN ? v - (XZ_MASK + 1) : v;
}
