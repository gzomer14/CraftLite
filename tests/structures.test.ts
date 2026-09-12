/**
 * Estruturas (doc 03 §7) e ravinas (doc 03 §5).
 *
 * O que precisa ficar de pé:
 * 1. **Aparecem.** Varrer uma área grande tem que achar dungeon, mina e aldeia.
 * 2. **Determinismo.** A mesma seed dá o mesmo mundo, em qualquer ordem.
 * 3. **Não atravessam a borda partidas ao meio.** Uma estrutura que nasce no
 *    vizinho tem que continuar dentro deste chunk.
 * 4. **Baú não duplica loot.** Ele é enchido uma vez; recarregar não reabastece.
 */
import { describe, expect, it } from 'vitest';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { rollChestLoot } from '../src/world/gen/structures';
import { CHEST_LOOT, STRUCTURES, structureByName } from '../src/data/structures';
import { BLOCK_BY_NAME, blockIdOf } from '../src/data/blocks';
import { ITEM_BY_NAME } from '../src/data/items';
import { SECTION_SIZE, WORLD_HEIGHT, type ChunkColumn } from '../src/world/chunk';

const SEED = 20260910;
const noise = new TerrainNoise(SEED);

const MOSSY = BLOCK_BY_NAME.get('mossy_cobblestone')!.id;
const SPAWNER = BLOCK_BY_NAME.get('mob_spawner')!.id;
const RAIL = BLOCK_BY_NAME.get('rail')!.id;
const COBWEB = BLOCK_BY_NAME.get('cobweb')!.id;
const CHEST = BLOCK_BY_NAME.get('chest')!.id;

/** Conta quantos voxels de um id existem no chunk. */
function count(chunk: ChunkColumn, id: number): number {
  let total = 0;
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < SECTION_SIZE; z++) {
      for (let x = 0; x < SECTION_SIZE; x++) {
        if (blockIdOf(chunk.getBlock(x, y, z)) === id) total++;
      }
    }
  }
  return total;
}

/** Gera uma área e soma os blocos de interesse. */
function survey(radius: number): {
  spawners: number; mossy: number; rails: number; cobwebs: number; chests: number;
  marks: Record<string, number>;
} {
  const out = {
    spawners: 0, mossy: 0, rails: 0, cobwebs: 0, chests: 0,
    marks: { chest: 0, spawner: 0, mob: 0 } as Record<string, number>,
  };
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const chunk = generateChunk(SEED, noise, cx, cz);
      out.spawners += count(chunk, SPAWNER);
      out.mossy += count(chunk, MOSSY);
      out.rails += count(chunk, RAIL);
      out.cobwebs += count(chunk, COBWEB);
      out.chests += count(chunk, CHEST);
      for (const mark of chunk.structures) out.marks[mark.kind]++;
    }
  }
  return out;
}

const area = survey(6);

describe('tabela de estruturas', () => {
  it('declara as quatro do checklist do M6', () => {
    const names = STRUCTURES.map((s) => s.name);
    expect(names).toContain('dungeon');
    expect(names).toContain('mineshaft');
    expect(names).toContain('village_house');
    expect(names).toContain('village_well');
  });

  it('todo bloco citado nas peças existe na tabela de blocos', () => {
    for (const def of STRUCTURES) {
      for (const piece of def.pieces) {
        if (piece.block === 'air') continue;
        expect(BLOCK_BY_NAME.get(piece.block), piece.block).toBeDefined();
        if (piece.alt !== undefined) expect(BLOCK_BY_NAME.get(piece.alt)).toBeDefined();
      }
      for (const chest of def.chests ?? []) {
        expect(CHEST_LOOT[chest.loot], chest.loot).toBeDefined();
      }
    }
  });

  it('todo item das tabelas de loot existe', () => {
    for (const rolls of Object.values(CHEST_LOOT)) {
      for (const roll of rolls) expect(ITEM_BY_NAME.get(roll.item), roll.item).toBeDefined();
    }
  });

  it('nenhuma peça declara caixa invertida', () => {
    for (const def of STRUCTURES) {
      for (const piece of def.pieces) {
        expect(piece.box[3]).toBeGreaterThanOrEqual(piece.box[0]);
        expect(piece.box[4]).toBeGreaterThanOrEqual(piece.box[1]);
        expect(piece.box[5]).toBeGreaterThanOrEqual(piece.box[2]);
      }
    }
  });
});

describe('estruturas no mundo', () => {
  it('a dungeon aparece, com spawner e pedregulho musgoso', () => {
    expect(area.spawners).toBeGreaterThan(0);
    expect(area.mossy).toBeGreaterThan(0);
  });

  it('a mina aparece, com trilhos e teias', () => {
    expect(area.rails).toBeGreaterThan(0);
    expect(area.cobwebs).toBeGreaterThan(0);
  });

  it('baú de estrutura vem com marco de loot, não vazio por acaso', () => {
    expect(area.chests).toBeGreaterThan(0);
    expect(area.marks.chest).toBeGreaterThan(0);
    expect(area.marks.spawner).toBeGreaterThan(0);
  });

  it('a mesma seed dá o mesmo chunk, gerado isolado ou em varredura', () => {
    const a = generateChunk(SEED, noise, 3, -2);
    const b = generateChunk(SEED, new TerrainNoise(SEED), 3, -2);
    for (let y = 0; y < WORLD_HEIGHT; y += 7) {
      for (let z = 0; z < SECTION_SIZE; z += 3) {
        for (let x = 0; x < SECTION_SIZE; x += 3) {
          expect(a.getBlock(x, y, z)).toBe(b.getBlock(x, y, z));
        }
      }
    }
  });

  it('desligar estruturas devolve um mundo sem elas', () => {
    let spawners = 0;
    for (let cz = -3; cz <= 3; cz++) {
      for (let cx = -3; cx <= 3; cx++) {
        const chunk = generateChunk(SEED, noise, cx, cz, { structures: false });
        spawners += count(chunk, SPAWNER);
        expect(chunk.structures).toHaveLength(0);
      }
    }
    expect(spawners).toBe(0);
  });

  it('a casa de aldeia declara fundação abaixo da origem', () => {
    // É o que impede a casa de ficar com pé no ar numa encosta.
    const house = structureByName('village_house')!;
    const foundation = house.pieces.find((p) => p.box[1] < 0);
    expect(foundation).toBeDefined();
  });
});

describe('ravinas', () => {
  it('abrem uma fenda vertical em alguma parte do mundo', () => {
    // Uma ravina deixa uma coluna de ar profunda longe de qualquer caverna
    // rasa: procura-se ar contínuo de Y=12 a Y=40 na mesma coluna.
    let found = false;
    for (let cz = -8; cz <= 8 && !found; cz++) {
      for (let cx = -8; cx <= 8 && !found; cx++) {
        const chunk = generateChunk(SEED, noise, cx, cz);
        for (let z = 0; z < SECTION_SIZE && !found; z++) {
          for (let x = 0; x < SECTION_SIZE && !found; x++) {
            let run = 0;
            for (let y = 12; y <= 45; y++) {
              run = chunk.getBlock(x, y, z) === 0 ? run + 1 : 0;
              if (run >= 28) { found = true; break; }
            }
          }
        }
      }
    }
    expect(found).toBe(true);
  });
});

describe('loot de baú', () => {
  it('é determinístico pela posição', () => {
    const first: string[] = [];
    const second: string[] = [];
    rollChestLoot(SEED, 10, 20, 30, 'dungeon', (item, n) => first.push(`${item}x${n}`));
    rollChestLoot(SEED, 10, 20, 30, 'dungeon', (item, n) => second.push(`${item}x${n}`));
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('posições diferentes dão baús diferentes', () => {
    const a: string[] = [];
    const b: string[] = [];
    rollChestLoot(SEED, 10, 20, 30, 'dungeon', (item, n) => a.push(`${item}x${n}`));
    rollChestLoot(SEED, 90, 20, 30, 'dungeon', (item, n) => b.push(`${item}x${n}`));
    expect(a).not.toEqual(b);
  });

  it('tabela desconhecida não solta nada', () => {
    let rolled = 0;
    rollChestLoot(SEED, 0, 0, 0, 'nao_existe', () => { rolled++; });
    expect(rolled).toBe(0);
  });
});
