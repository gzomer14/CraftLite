/**
 * Tabelas planas derivadas de `BLOCKS`, indexadas por id.
 *
 * O greedy meshing consulta essas propriedades milhões de vezes por segundo.
 * Ler `BLOCKS[id].opaque` significa um acesso a objeto e um miss de cache por
 * consulta; um `Uint8Array` indexado por id não.
 */

import { BLOCKS, AIR, WATER, LAVA, texOf } from '../../data/blocks';
import {
  SHAPE_BUTTON, SHAPE_CARPET, SHAPE_CROSS, SHAPE_DOOR, SHAPE_FENCE, SHAPE_FENCE_GATE, SHAPE_FLAT,
  SHAPE_LADDER, SHAPE_LEVER, SHAPE_NONE, SHAPE_PAINTING, SHAPE_PANE, SHAPE_PISTON,
  SHAPE_BED, SHAPE_CHEST, SHAPE_PISTON_HEAD, SHAPE_PLATE, SHAPE_RAIL, SHAPE_REPEATER, SHAPE_SIGN, SHAPE_SLAB,
  SHAPE_STAIRS, SHAPE_TORCH, SHAPE_TRAPDOOR,
} from './shapes';
import { layerOf, type LayerIndex } from '../../render/layers';
import { TINT_FOLIAGE, TINT_GRASS, TINT_NONE, TINT_WATER } from '../../render/vertex';

export const LAYER_NONE = 0;
export const LAYER_OPAQUE = 1;
export const LAYER_CUTOUT = 2;
export const LAYER_TRANSLUCENT = 3;

/** Como o mesher de blocos complexos desenha o bloco (doc 04 §3). */
export const CPLX_NONE = 0;
/** Dois quads em X, dos dois lados: planta, muda, plantação, tocha, teia. */
export const CPLX_CROSS = 1;
/** Lista de caixas vinda de `shapes.ts`: laje, escada, cerca, porta, placa… */
export const CPLX_BOXES = 2;
/**
 * Um quad só, deitado ou inclinado: o trilho (M7).
 *
 * Vale a exceção porque o trilho é a **única** forma do jogo que precisa de um
 * plano inclinado, e caixa alinhada aos eixos não representa rampa. De quebra,
 * um quad custa 1/6 do que a caixa achatada custava.
 */
export const CPLX_RAIL = 3;
/**
 * Poste inclinável com topo próprio: a tocha (M8).
 *
 * Não cabe em `CPLX_BOXES` porque a tocha de parede é **torta** — a única
 * geometria do jogo, junto com a rampa de trilho, que não é caixa alinhada aos
 * eixos. E não cabe em `CPLX_CROSS` porque cruz é o que ela era e o que
 * ninguém reconhecia como tocha.
 */
export const CPLX_TORCH = 4;
/**
 * Caixa com uma tampa que **gira**: o baú (M8).
 *
 * O doc 14 dizia que tampa de baú "exige rotação, e a geometria do jogo é de
 * caixas alinhadas aos eixos (doc 04 §3) — precisa de um segundo formato de
 * vértice para existir". **Não precisa.** O mesher já escreve quad de quatro
 * cantos arbitrários (`addPolyQuad`), que é como a tocha de parede fica torta e
 * como a rampa de trilho existe; o que o formato de vértice guarda é posição,
 * não transformação. A tampa girada é a mesma caixa com os oito cantos
 * rodados na CPU, na hora de meshar.
 *
 * O corpo e a tranca continuam saindo de `boxesFor`, que é o que a física e o
 * contorno leem: abrir o baú não muda onde se esbarra nem onde se mira.
 */
export const CPLX_CHEST = 5;

/**
 * Quantas idades cabem na tabela de textura por estado (doc 04 §2.5).
 *
 * Eram 8 até o M6, quando a plantação era o único cliente. O pó de redstone
 * tem 16 níveis de energia e precisa de 16 entradas — que **não** viram 16
 * texturas: `dustStages()` repete nomes, e camada de atlas é resolvida por
 * nome. O custo é 16 × 2 B por bloco na tabela plana, ~4 KB no total.
 */
export const MAX_STAGES = 16;

/** Como cada `shape` da tabela de blocos é desenhada. */
const COMPLEX_BY_SHAPE: Record<string, number> = {
  cross: CPLX_CROSS,
  torch: CPLX_TORCH,
  bed: CPLX_BOXES,
  chest: CPLX_CHEST,
  slab: CPLX_BOXES,
  carpet: CPLX_BOXES,
  flat: CPLX_BOXES,
  stairs: CPLX_BOXES,
  fence: CPLX_BOXES,
  fence_gate: CPLX_BOXES,
  trapdoor: CPLX_BOXES,
  door: CPLX_BOXES,
  pane: CPLX_BOXES,
  ladder: CPLX_BOXES,
  sign: CPLX_BOXES,
  painting: CPLX_BOXES,
  lever: CPLX_BOXES,
  button: CPLX_BOXES,
  plate: CPLX_BOXES,
  repeater: CPLX_BOXES,
  piston: CPLX_BOXES,
  piston_head: CPLX_BOXES,
  rail: CPLX_RAIL,
};

/** `SHAPE_*` de `shapes.ts` para cada `shape` da tabela de blocos. */
const SHAPE_ID_BY_NAME: Record<string, number> = {
  cross: SHAPE_CROSS,
  torch: SHAPE_TORCH,
  bed: SHAPE_BED,
  chest: SHAPE_CHEST,
  slab: SHAPE_SLAB,
  carpet: SHAPE_CARPET,
  flat: SHAPE_FLAT,
  stairs: SHAPE_STAIRS,
  fence: SHAPE_FENCE,
  fence_gate: SHAPE_FENCE_GATE,
  trapdoor: SHAPE_TRAPDOOR,
  door: SHAPE_DOOR,
  pane: SHAPE_PANE,
  ladder: SHAPE_LADDER,
  sign: SHAPE_SIGN,
  painting: SHAPE_PAINTING,
  lever: SHAPE_LEVER,
  button: SHAPE_BUTTON,
  plate: SHAPE_PLATE,
  repeater: SHAPE_REPEATER,
  piston: SHAPE_PISTON,
  piston_head: SHAPE_PISTON_HEAD,
  rail: SHAPE_RAIL,
};

export interface BlockTables {
  /** Em qual passe o bloco é desenhado. */
  renderLayer: Uint8Array;
  /** Esconde a face do vizinho e bloqueia luz. */
  occludes: Uint8Array;
  /** Emite geometria de cubo (participa do greedy). */
  isCube: Uint8Array;
  /** Dois quads cruzados, fora do greedy (doc 04 §3). */
  isCross: Uint8Array;
  /** Camada de textura por face: topo, lado, base. */
  texTop: Uint16Array;
  texSide: Uint16Array;
  texBottom: Uint16Array;
  tint: Uint8Array;
  emission: Uint8Array;
  attenuation: Uint8Array;
  /** `CPLX_*`: geometria fora do greedy. 0 = não tem. */
  complex: Uint8Array;
  /** `SHAPE_*` de `shapes.ts`, para quem precisa da lista de caixas. */
  shape: Uint8Array;
  /** Textura por estado, `MAX_STAGES` entradas por bloco (plantação por idade). */
  stageTex: Uint16Array;
  /** 1 se o bloco tem textura por estado. */
  hasStages: Uint8Array;
}

const TINT_INDEX: Record<string, number> = {
  none: TINT_NONE, grass: TINT_GRASS, foliage: TINT_FOLIAGE, water: TINT_WATER,
};

/** Constrói as tabelas a partir de um índice de camadas. Roda uma vez, no boot. */
export function buildBlockTables(index: LayerIndex): BlockTables {
  const n = BLOCKS.length;
  const tables: BlockTables = {
    renderLayer: new Uint8Array(n),
    occludes: new Uint8Array(n),
    isCube: new Uint8Array(n),
    isCross: new Uint8Array(n),
    texTop: new Uint16Array(n),
    texSide: new Uint16Array(n),
    texBottom: new Uint16Array(n),
    tint: new Uint8Array(n),
    emission: new Uint8Array(n),
    attenuation: new Uint8Array(n),
    complex: new Uint8Array(n),
    shape: new Uint8Array(n),
    stageTex: new Uint16Array(n * MAX_STAGES),
    hasStages: new Uint8Array(n),
  };

  for (let id = 0; id < n; id++) {
    const def = BLOCKS[id];
    if (def === undefined || id === AIR) {
      tables.renderLayer[id] = LAYER_NONE;
      tables.attenuation[id] = 0;
      continue;
    }

    tables.occludes[id] = def.opaque ? 1 : 0;
    tables.emission[id] = def.emission;
    tables.attenuation[id] = def.lightAttenuation;
    tables.tint[id] = TINT_INDEX[def.tint] ?? TINT_NONE;
    tables.texTop[id] = layerOf(index, texOf(def, 'top'));
    tables.texSide[id] = layerOf(index, texOf(def, 'side'));
    tables.texBottom[id] = layerOf(index, texOf(def, 'bottom'));
    tables.complex[id] = COMPLEX_BY_SHAPE[def.shape] ?? CPLX_NONE;
    tables.shape[id] = SHAPE_ID_BY_NAME[def.shape] ?? SHAPE_NONE;

    if (def.stages.length > 0) {
      tables.hasStages[id] = 1;
      for (let stage = 0; stage < MAX_STAGES; stage++) {
        const name = def.stages[Math.min(stage, def.stages.length - 1)];
        tables.stageTex[id * MAX_STAGES + stage] = layerOf(index, name);
      }
    }

    if (def.shape === 'cross') {
      tables.isCross[id] = 1;
      tables.renderLayer[id] = LAYER_CUTOUT;
    } else if (id === WATER) {
      tables.isCube[id] = 1;
      tables.renderLayer[id] = LAYER_TRANSLUCENT;
    } else if (id === LAVA) {
      tables.isCube[id] = 1;
      tables.renderLayer[id] = LAYER_OPAQUE;
    } else if (def.shape === 'cube') {
      tables.isCube[id] = 1;
      // Folhas e vidro precisam de alpha test; o portal, de mistura alfa;
      // o resto é opaco.
      if (def.translucent) tables.renderLayer[id] = LAYER_TRANSLUCENT;
      else tables.renderLayer[id] = def.opaque ? LAYER_OPAQUE : LAYER_CUTOUT;
    } else if (tables.complex[id] !== CPLX_NONE) {
      // Laje, escada, cerca, porta e afins: geometria própria de caixas, no
      // mesmo passe recortado.
      tables.renderLayer[id] = LAYER_CUTOUT;
    } else {
      // `liquid` e `none` não têm geometria própria neste passe.
      tables.renderLayer[id] = LAYER_NONE;
    }
  }

  return tables;
}

/**
 * Camada de textura de um bloco levando o estado em conta.
 *
 * Dois clientes: a plantação, cuja idade escolhe a textura, e o pó de redstone,
 * cujo nível de energia escolhe o brilho. Nos dois casos evita gastar um id de
 * bloco por estágio.
 */
export function stageTexOf(tables: BlockTables, id: number, state: number): number {
  if (tables.hasStages[id] === 0) return tables.texSide[id];
  return tables.stageTex[id * MAX_STAGES + Math.min(state, MAX_STAGES - 1)];
}

/** `SHAPE_*` de um bloco, para quem monta a lista de caixas. */
export function shapeIdOf(tables: BlockTables, id: number): number {
  return tables.shape[id];
}
