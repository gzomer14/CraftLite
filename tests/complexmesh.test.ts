/**
 * Malha dos blocos que não são cubo (doc 04 §3).
 *
 * Isto existia como comentário desde o M1: `cross`, `torch` e `slab` saíam do
 * greedy e **não entravam em lugar nenhum** — grama alta, flor, muda e tocha
 * ficavam invisíveis no jogo. A regressão que importa é essa: qualquer bloco
 * com forma complexa tem que sair do mesher com geometria.
 */
import { describe, expect, it } from 'vitest';
import { GreedyMesher, NB_SIDE, nbIndex } from '../src/world/mesh/greedy';
import {
  CPLX_BOXES, CPLX_CROSS, CPLX_RAIL, buildBlockTables, stageTexOf,
} from '../src/world/mesh/blockinfo';
import { buildLayerIndex } from '../src/render/layers';
import { BLOCK_BY_NAME, BLOCKS, makeState } from '../src/data/blocks';
import { STONE } from './helpers/blockids';

const index = buildLayerIndex();
const tables = buildBlockTables(index);
const VOL = NB_SIDE * NB_SIDE * NB_SIDE;

const TALL_GRASS = BLOCK_BY_NAME.get('tall_grass')!.id;
const TORCH = BLOCK_BY_NAME.get('torch')!.id;
const SLAB = BLOCK_BY_NAME.get('cobblestone_slab')!.id;
const WHEAT = BLOCK_BY_NAME.get('wheat')!.id;

function empty(): { blocks: Uint16Array; light: Uint8Array } {
  return { blocks: new Uint16Array(VOL), light: new Uint8Array(VOL).fill(0xf0) };
}

const mesher = (): GreedyMesher => new GreedyMesher(tables, true);

describe('tabelas de forma', () => {
  it('planta, muda, plantação e tocha viram cruz', () => {
    for (const name of ['tall_grass', 'dandelion', 'oak_sapling', 'wheat', 'torch']) {
      const id = BLOCK_BY_NAME.get(name)!.id;
      expect(tables.complex[id]).toBe(CPLX_CROSS);
    }
  });

  it('laje, camada de neve, escada e cerca viram lista de caixas', () => {
    for (const name of ['cobblestone_slab', 'snow_layer', 'oak_stairs', 'oak_fence',
      'oak_fence_gate', 'oak_trapdoor', 'oak_door', 'ladder', 'oak_sign', 'painting',
      'redstone_wire', 'lever', 'stone_button', 'stone_pressure_plate', 'repeater',
      'piston', 'piston_head']) {
      const id = BLOCK_BY_NAME.get(name)!.id;
      expect(tables.complex[id]).toBe(CPLX_BOXES);
    }
  });

  it('trilho tem caminho próprio: um quad só, que a caixa não representa', () => {
    for (const name of ['rail', 'powered_rail', 'detector_rail']) {
      expect(tables.complex[BLOCK_BY_NAME.get(name)!.id], name).toBe(CPLX_RAIL);
    }
  });

  it('cubo comum não tem forma complexa', () => {
    expect(tables.complex[STONE]).toBe(0);
  });

  it('nenhum bloco da tabela fica sem geometria nem sem forma declarada', () => {
    // Guarda-corpo: só o fluido e o "nada" podem sair sem geometria. Qualquer
    // forma **nova** que apareça sem caixa nem cruz falha aqui.
    const semGeometria = new Set(['liquid', 'none']);
    for (const def of BLOCKS) {
      if (def === undefined) continue;
      const desenhado = tables.isCube[def.id] === 1 || tables.complex[def.id] !== 0;
      expect(desenhado || semGeometria.has(def.shape)).toBe(true);
    }
  });
});

describe('textura por estado', () => {
  it('o trigo muda de textura a cada idade', () => {
    const layers = new Set<number>();
    for (let age = 0; age <= 7; age++) layers.add(stageTexOf(tables, WHEAT, age));
    expect(layers.size).toBe(8);
  });

  it('bloco sem estágios devolve sempre a mesma camada', () => {
    expect(stageTexOf(tables, STONE, 0)).toBe(stageTexOf(tables, STONE, 5));
  });

  it('estado acima da tabela não estoura o índice', () => {
    expect(stageTexOf(tables, WHEAT, 63)).toBe(stageTexOf(tables, WHEAT, 7));
  });
});

describe('geometria', () => {
  it('grama alta gera duas diagonais visíveis dos dois lados', () => {
    const { blocks, light } = empty();
    blocks[nbIndex(8, 8, 8)] = makeState(TALL_GRASS);
    const out = mesher().mesh(blocks, light);

    expect(out.quads).toBe(2);
    expect(out.cutout).not.toBeNull();
    expect(out.cutout?.vertexCount).toBe(8);
    // 2 planos × 2 lados × 2 triângulos × 3 índices.
    expect(out.cutout?.indexCount).toBe(24);
  });

  it('a tocha também aparece', () => {
    const { blocks, light } = empty();
    blocks[nbIndex(4, 4, 4)] = makeState(TORCH);
    const out = mesher().mesh(blocks, light);
    expect(out.cutout?.vertexCount).toBe(8);
  });

  it('plantação em qualquer idade tem geometria', () => {
    for (let age = 0; age <= 7; age++) {
      const { blocks, light } = empty();
      blocks[nbIndex(2, 2, 2)] = makeState(WHEAT, age);
      expect(mesher().mesh(blocks, light).cutout?.vertexCount).toBe(8);
    }
  });

  it('laje solta no ar mostra as 6 faces', () => {
    const { blocks, light } = empty();
    blocks[nbIndex(8, 8, 8)] = makeState(SLAB);
    const out = mesher().mesh(blocks, light);
    expect(out.quads).toBe(6);
    expect(out.cutout?.vertexCount).toBe(24);
  });

  it('laje encostada em pedra não desenha as faces escondidas', () => {
    const { blocks, light } = empty();
    blocks[nbIndex(8, 8, 8)] = makeState(SLAB);
    blocks[nbIndex(8, 7, 8)] = makeState(STONE); // chão
    blocks[nbIndex(9, 8, 8)] = makeState(STONE); // parede
    const out = mesher().mesh(blocks, light);
    // Some a base e a face contra a parede; sobram 4 (topo + 3 lados) × 4 vértices.
    expect(out.cutout?.vertexCount).toBe(16);
  });

  // --- redstone (M7) -------------------------------------------------------

  it('todo componente de redstone sai do mesher com geometria', () => {
    for (const name of ['redstone_wire', 'redstone_torch', 'redstone_torch_off', 'lever',
      'stone_button', 'oak_button', 'stone_pressure_plate', 'repeater', 'piston',
      'sticky_piston', 'piston_head', 'redstone_lamp', 'redstone_lamp_on', 'redstone_block']) {
      const { blocks, light } = empty();
      blocks[nbIndex(8, 8, 8)] = makeState(BLOCK_BY_NAME.get(name)!.id);
      const out = mesher().mesh(blocks, light);
      expect(out.quads, name).toBeGreaterThan(0);
    }
  });

  it('o pó muda de textura com a energia, em quatro degraus', () => {
    const wire = BLOCK_BY_NAME.get('redstone_wire')!.id;
    const layers = new Set<number>();
    for (let power = 0; power <= 15; power++) layers.add(stageTexOf(tables, wire, power));
    expect(layers.size).toBe(4);
    // Apagado e cheio nunca podem coincidir: é o único retorno visual do fio.
    expect(stageTexOf(tables, wire, 0)).not.toBe(stageTexOf(tables, wire, 15));
  });

  it('o pistão estendido é mais curto que o recolhido', () => {
    const piston = BLOCK_BY_NAME.get('piston')!.id;
    const { blocks: a, light } = empty();
    a[nbIndex(8, 8, 8)] = makeState(piston, 0);
    const recolhido = mesher().mesh(a, light).quads;
    const { blocks: b } = empty();
    b[nbIndex(8, 8, 8)] = makeState(piston, 8);
    expect(mesher().mesh(b, light).quads).toBeLessThan(recolhido);
  });

  it('o padding não entra na conta: planta fora da section é ignorada', () => {
    const { blocks, light } = empty();
    blocks[nbIndex(-1, 8, 8)] = makeState(TALL_GRASS);
    blocks[nbIndex(16, 8, 8)] = makeState(TALL_GRASS);
    expect(mesher().mesh(blocks, light).quads).toBe(0);
  });

  it('um campo de trigo cabe no mesmo buffer recortado', () => {
    const { blocks, light } = empty();
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) blocks[nbIndex(x, 8, z)] = makeState(WHEAT, 7);
    }
    const out = mesher().mesh(blocks, light);
    // 256 plantas × 2 planos = 512 quads, 4 vértices cada.
    expect(out.quads).toBe(512);
    expect(out.opaque).toBeNull();
    expect(out.cutout?.vertexCount).toBe(2048);
  });
});
