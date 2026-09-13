/**
 * Portal do Nether: moldura, ignição e destino (doc 14 — M7).
 *
 * Tudo aqui é **função de mundo**, sem sessão, sem render e sem estado global —
 * o que permite testar "acender o portal" e "achar onde sair do outro lado"
 * sem GL nem DOM, que é a regra de teste do projeto.
 *
 * A moldura é a do gênero: obsidiana em volta de um vão de 2 a 21 de largura por
 * 3 a 21 de altura, num dos dois eixos horizontais. Os **cantos não contam** —
 * é isso que permite a moldura de 10 obsidianas que todo jogador conhece.
 */

import { AIR, BLOCK_BY_NAME, blockIdOf, defOf, makeState } from '../data/blocks';
import { DIM_NETHER, DIM_OVERWORLD, scaleCoordinate } from '../data/dimensions';
import { WORLD_HEIGHT } from '../world/chunk';
import type { World } from '../world/world';

const OBSIDIAN = blockId('obsidian');
const PORTAL = blockId('nether_portal');

function blockId(name: string): number {
  const def = BLOCK_BY_NAME.get(name);
  if (def === undefined) throw new Error(`Bloco de portal ausente: ${name}`);
  return def.id;
}

/** Vão mínimo e máximo do portal, em blocos. */
export const MIN_WIDTH = 2;
export const MIN_HEIGHT = 3;
export const MAX_SPAN = 21;

/** Eixo do portal nos bits de estado: 0 = ao longo de X, 1 = ao longo de Z. */
export const AXIS_X = 0;
export const AXIS_Z = 1;

/** O vão encontrado dentro de uma moldura válida. */
export interface PortalArea {
  axis: number;
  /** Canto de menor coordenada do **vão** (não da moldura). */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}

/**
 * Acende o portal a partir de um bloco do vão.
 *
 * Devolve a área acesa, ou `null` se não há moldura válida em nenhum dos dois
 * eixos. Tenta X antes de Z apenas por determinismo — uma moldura só é válida
 * em um eixo.
 */
export function ignitePortal(world: World, x: number, y: number, z: number): PortalArea | null {
  const area = findPortalArea(world, x, y, z, AXIS_X)
    ?? findPortalArea(world, x, y, z, AXIS_Z);
  if (area === null) return null;
  fillPortal(world, area);
  return area;
}

/**
 * Procura a moldura que contém `(x,y,z)` no eixo dado.
 *
 * O caminho é: crescer o vão a partir do ponto (baixo, cima, dois lados) e só
 * então conferir que tudo em volta é obsidiana. Crescer primeiro evita percorrer
 * a moldura inteira de uma construção que nem é portal.
 */
export function findPortalArea(
  world: World, x: number, y: number, z: number, axis: number,
): PortalArea | null {
  if (!isHollow(world, x, y, z)) return null;

  const bottom = growVertical(world, x, y, z, -1);
  const top = growVertical(world, x, y, z, 1);
  const height = top - bottom + 1;
  if (height < MIN_HEIGHT || height > MAX_SPAN) return null;
  if (!isObsidian(world, x, bottom - 1, z) || !isObsidian(world, x, top + 1, z)) return null;

  const dx = axis === AXIS_X ? 1 : 0;
  const dz = axis === AXIS_X ? 0 : 1;
  const low = growSideways(world, x, z, bottom, top, -dx, -dz);
  const high = growSideways(world, x, z, bottom, top, dx, dz);
  const width = high - low + 1;
  if (width < MIN_WIDTH || width > MAX_SPAN) return null;

  const baseX = axis === AXIS_X ? low : x;
  const baseZ = axis === AXIS_X ? z : low;
  const area: PortalArea = { axis, x: baseX, y: bottom, z: baseZ, width, height };
  return hasFrame(world, area) ? area : null;
}

/** Quantos blocos o vão cresce na vertical a partir de `y`, na direção `step`. */
function growVertical(world: World, x: number, y: number, z: number, step: number): number {
  let cursor = y;
  while (cursor + step >= 0 && cursor + step < WORLD_HEIGHT
    && isHollow(world, x, cursor + step, z)
    && Math.abs(cursor + step - y) < MAX_SPAN) {
    cursor += step;
  }
  return cursor;
}

/** Idem na horizontal: a coluna inteira precisa estar vazia para o vão crescer. */
function growSideways(
  world: World, x: number, z: number, bottom: number, top: number, dx: number, dz: number,
): number {
  const start = dx !== 0 ? x : z;
  let cursor = start;
  for (let step = 1; step < MAX_SPAN; step++) {
    const cx = x + dx * step;
    const cz = z + dz * step;
    if (!columnHollow(world, cx, cz, bottom, top)) break;
    cursor = dx !== 0 ? cx : cz;
  }
  return cursor;
}

function columnHollow(world: World, x: number, z: number, bottom: number, top: number): boolean {
  for (let y = bottom; y <= top; y++) if (!isHollow(world, x, y, z)) return false;
  return true;
}

/** Confere a moldura em volta do vão: laterais, base e topo, sem os cantos. */
function hasFrame(world: World, area: PortalArea): boolean {
  const dx = area.axis === AXIS_X ? 1 : 0;
  const dz = area.axis === AXIS_X ? 0 : 1;

  for (let i = 0; i < area.width; i++) {
    const x = area.x + dx * i;
    const z = area.z + dz * i;
    if (!isObsidian(world, x, area.y - 1, z)) return false;
    if (!isObsidian(world, x, area.y + area.height, z)) return false;
  }
  for (let j = 0; j < area.height; j++) {
    const y = area.y + j;
    if (!isObsidian(world, area.x - dx, y, area.z - dz)) return false;
    if (!isObsidian(world, area.x + dx * area.width, y, area.z + dz * area.width)) return false;
  }
  return true;
}

/** Preenche o vão com blocos de portal. */
export function fillPortal(world: World, area: PortalArea): void {
  const state = makeState(PORTAL, area.axis);
  const dx = area.axis === AXIS_X ? 1 : 0;
  const dz = area.axis === AXIS_X ? 0 : 1;
  for (let j = 0; j < area.height; j++) {
    for (let i = 0; i < area.width; i++) {
      world.setBlock(area.x + dx * i, area.y + j, area.z + dz * i, state, 'player');
    }
  }
}

/** Apaga o portal inteiro a partir de um bloco dele — a moldura fica. */
export function extinguishPortal(world: World, x: number, y: number, z: number): number {
  if (blockIdOf(world.getBlock(x, y, z)) !== PORTAL) return 0;
  const air = makeState(AIR);
  const stack: number[] = [x, y, z];
  let removed = 0;
  while (stack.length > 0) {
    const cz = stack.pop() as number;
    const cy = stack.pop() as number;
    const cx = stack.pop() as number;
    if (blockIdOf(world.getBlock(cx, cy, cz)) !== PORTAL) continue;
    world.setBlock(cx, cy, cz, air, 'player');
    removed++;
    stack.push(
      cx + 1, cy, cz, cx - 1, cy, cz,
      cx, cy + 1, cz, cx, cy - 1, cz,
      cx, cy, cz + 1, cx, cy, cz - 1,
    );
  }
  return removed;
}

/** Vazio para o portal: ar ou outro bloco de portal (reacender não quebra). */
function isHollow(world: World, x: number, y: number, z: number): boolean {
  const id = blockIdOf(world.getBlock(x, y, z));
  return id === AIR || id === PORTAL;
}

function isObsidian(world: World, x: number, y: number, z: number): boolean {
  return blockIdOf(world.getBlock(x, y, z)) === OBSIDIAN;
}

/** true se o bloco é um portal aceso. */
export function isPortalBlock(state: number): boolean {
  return blockIdOf(state) === PORTAL;
}

/** Para o outro lado: divide por 8 indo, multiplica voltando (doc de dimensões). */
export function destinationOf(
  x: number, z: number, from: number,
): { x: number; z: number; dimension: number } {
  const to = from === DIM_NETHER ? DIM_OVERWORLD : DIM_NETHER;
  return { x: scaleCoordinate(x, from, to), z: scaleCoordinate(z, from, to), dimension: to };
}

/**
 * Procura um portal já aceso perto de `(x,z)`, em qualquer altura.
 *
 * É o que faz a viagem de ida e volta cair sempre no mesmo par de portais em vez
 * de cavar um novo a cada travessia. A busca é em espiral por coluna: com raio
 * 16 são 1089 colunas × 128 alturas no pior caso, mas o caso comum acha na
 * primeira dezena de colunas e sai.
 */
export function findNearbyPortal(
  world: World, x: number, z: number, radius: number,
): { x: number; y: number; z: number } | null {
  for (let r = 0; r <= radius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        // Só a casca do anel: o miolo já foi visto nos raios anteriores.
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const cx = x + dx;
        const cz = z + dz;
        if (!world.isLoaded(cx, cz)) continue;
        for (let y = 1; y < WORLD_HEIGHT - 1; y++) {
          if (isPortalBlock(world.getBlock(cx, y, cz))) return { x: cx, y, z: cz };
        }
      }
    }
  }
  return null;
}

// --- chegada do outro lado --------------------------------------------------

/** Vão do portal que a chegada constrói quando não há nenhum por perto. */
const BUILD_WIDTH = 2;
const BUILD_HEIGHT = 3;
/** Raio de colunas em que a chegada procura um portal já existente. */
export const SEARCH_RADIUS = 12;

/**
 * Garante um portal em volta de `(x,z)` e devolve por onde o jogador sai.
 *
 * Primeiro procura um já aceso — é o que faz a ida e a volta caírem no mesmo
 * par em vez de cavar um portal novo a cada travessia. Não achando, escava a
 * moldura: **o jogador nunca pode chegar sem saída**, nem no meio da lava nem
 * dentro da rocha.
 */
export function arriveAt(
  world: World, x: number, z: number, dimension: number,
): { x: number; y: number; z: number } | null {
  const existing = findNearbyPortal(world, x, z, SEARCH_RADIUS);
  if (existing !== null) return { x: existing.x + 0.5, y: existing.y, z: existing.z + 0.5 };

  const y = landingHeight(world, x, z, dimension);
  if (y < 0) return null;
  buildPortalAt(world, x, y, z);
  return { x: x + 0.5, y, z: z + 0.5 };
}

/**
 * Altura em que a moldura sai.
 *
 * Duas passadas, nesta ordem: **um salão** (chão sólido com o vão livre acima)
 * e, se não houver nenhum, **qualquer chão sólido** — aí a moldura é escavada
 * na rocha, e é por isso que `buildPortalAt` limpa o espaço antes de construir.
 *
 * A busca vai de cima para baixo: descer encontra o primeiro salão, subir
 * encontraria o mar de lava primeiro. Devolve −1 só quando a coluna inteira é
 * ar ou lava, e aí a viagem é abortada — chegar dentro da lava não é chegar.
 */
export function landingHeight(
  world: World, x: number, z: number, dimension: number,
): number {
  const from = dimension === DIM_NETHER ? WORLD_HEIGHT - 8 : WORLD_HEIGHT - 2;
  const to = dimension === DIM_NETHER ? NETHER_FLOOR : 1;

  let carved = -1;
  for (let y = from; y > to; y--) {
    if (!isSolid(world, x, y - 1, z)) continue;
    if (carved < 0) carved = y;

    let clear = true;
    for (let h = 0; h <= BUILD_HEIGHT && clear; h++) {
      for (let d = -1; d <= BUILD_WIDTH && clear; d++) {
        if (!isHollow(world, x + d, y + h, z)) clear = false;
      }
    }
    if (clear) return y;
  }
  return carved;
}

/** Piso mínimo da chegada no Nether: acima do mar de lava, com folga. */
const NETHER_FLOOR = 36;

/**
 * Escava a moldura de obsidiana e acende.
 *
 * A moldura é construída **por cima do que estiver lá**: chegar do outro lado
 * não pode falhar porque havia netherrack no caminho.
 */
export function buildPortalAt(world: World, x: number, y: number, z: number): PortalArea {
  const obsidian = makeState(OBSIDIAN);
  const air = makeState(AIR);

  // Vão limpo, mais uma folga de um bloco de cada lado para o jogador caber.
  for (let j = -1; j <= BUILD_HEIGHT; j++) {
    for (let i = -1; i <= BUILD_WIDTH; i++) {
      for (let d = -1; d <= 1; d++) {
        world.setBlock(x + i, y + j, z + d, air, 'player');
      }
    }
  }
  // Moldura no eixo X, sem os cantos: base, topo e laterais.
  for (let i = -1; i <= BUILD_WIDTH; i++) {
    world.setBlock(x + i, y - 1, z, obsidian, 'player');
    world.setBlock(x + i, y + BUILD_HEIGHT, z, obsidian, 'player');
  }
  for (let j = 0; j < BUILD_HEIGHT; j++) {
    world.setBlock(x - 1, y + j, z, obsidian, 'player');
    world.setBlock(x + BUILD_WIDTH, y + j, z, obsidian, 'player');
  }
  // Chão firme sob o vão: sair do portal e cair não é chegada.
  for (let i = -1; i <= BUILD_WIDTH; i++) {
    for (let d = -1; d <= 1; d++) {
      if (!isSolid(world, x + i, y - 1, z + d)) {
        world.setBlock(x + i, y - 1, z + d, obsidian, 'player');
      }
    }
  }

  const area: PortalArea = {
    axis: AXIS_X, x, y, z, width: BUILD_WIDTH, height: BUILD_HEIGHT,
  };
  fillPortal(world, area);
  return area;
}

function isSolid(world: World, x: number, y: number, z: number): boolean {
  return defOf(world.getBlock(x, y, z)).solid;
}
