/**
 * Selva e afogado (M14).
 *
 * A selva é a quinta madeira — cinco camadas de atlas — e o bioma quente e
 * úmido que faltava; o cacau cai da folha dela e devolve o biscoito à receita
 * do doc. O afogado é o zumbi que nasce na água e nada atrás do jogador.
 */
import { describe, expect, it } from 'vitest';
import { BIOMES, pickClimateBiome } from '../src/data/biomes';
import { BLOCK_BY_NAME, blockIdOf, makeState } from '../src/data/blocks';
import { ITEM_BY_NAME } from '../src/data/items';
import { BLOCK_LOOT } from '../src/data/loot';
import { RECIPES, TAGS } from '../src/data/recipes';
import { TEXTURES } from '../src/data/textures';
import { PLANTS } from '../src/data/plants';
import { MOB_BY_NAME, spawnRuleOf } from '../src/data/mobs';
import { buildLayerIndex } from '../src/render/layers';
import { DECOR } from '../src/world/gen/decorate';
import { TREE_MAX_HEIGHT, growTree } from '../src/world/trees';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { ClimateSampler } from '../src/world/gen/climate';
import { Rng } from '../src/core/rng';
import { ChunkColumn } from '../src/world/chunk';
import { World } from '../src/world/world';
import { Mobs } from '../src/entity/mobs';
import { makeFluid } from '../src/world/fluids';
import { WATER } from '../src/data/blocks';

const JUNGLE_BLOCKS = ['jungle_log', 'jungle_planks', 'jungle_leaves', 'jungle_sapling'];

describe('selva: a madeira', () => {
  it('os quatro blocos existem, com textura própria desenhada', () => {
    for (const name of JUNGLE_BLOCKS) {
      const def = BLOCK_BY_NAME.get(name);
      expect(def, name).toBeDefined();
      const tex = typeof def!.tex === 'string' ? [def!.tex] : Object.values(def!.tex);
      for (const t of tex) {
        expect(TEXTURES[t as string], `${name}: ${t}`).toBeDefined();
        expect(t).toContain('jungle');
      }
    }
    expect(BLOCK_BY_NAME.get('jungle_leaves')!.tint).toBe('foliage');
  });

  it('as camadas de atlas continuam dentro do teto', () => {
    expect(buildLayerIndex().count).toBeLessThanOrEqual(256);
  });

  it('tronco vira tábua, tábua entra em toda receita de #planks', () => {
    expect(TAGS.logs).toContain('jungle_log');
    expect(TAGS.planks).toContain('jungle_planks');
  });

  it('a muda cresce em árvore da selva, dentro da altura declarada', () => {
    expect(PLANTS.find((p) => p.block === 'jungle_sapling')?.tree).toBe('jungle');
    const log = makeState(BLOCK_BY_NAME.get('jungle_log')!.id);
    const leaves = makeState(BLOCK_BY_NAME.get('jungle_leaves')!.id);
    for (let seed = 1; seed <= 20; seed++) {
      let top = 0;
      let logs = 0;
      let leafCount = 0;
      growTree({
        trunk: (_x, y, _z, s) => { if (s === log) logs++; top = Math.max(top, y); },
        leaf: (_x, y, _z, s) => { if (s === leaves) leafCount++; top = Math.max(top, y); },
      }, new Rng(seed), 'jungle', 0, 0, 0);
      expect(logs).toBeGreaterThanOrEqual(8);
      expect(leafCount).toBeGreaterThan(30);
      expect(top).toBeLessThan(TREE_MAX_HEIGHT.jungle);
    }
  });

  it('a folha dá muda e cacau, e o biscoito leva cacau', () => {
    const drops = BLOCK_LOOT.jungle_leaves.drops.map((d) => d.item);
    expect(drops).toContain('jungle_sapling');
    expect(drops).toContain('cocoa_beans');
    expect(ITEM_BY_NAME.has('cocoa_beans')).toBe(true);
    const cookie = RECIPES.find((r) => r.result.item === 'cookie');
    expect(JSON.stringify(cookie)).toContain('cocoa_beans');
    expect(JSON.stringify(cookie)).not.toContain('sugar');
  });
});

describe('selva: o bioma', () => {
  it('quente e úmido é selva, e ela tem árvore da selva na decoração', () => {
    expect(BIOMES[pickClimateBiome(0.9, 0.8)].name).toBe('jungle');
    expect(DECOR.jungle.tree?.kind).toBe('jungle');
  });

  it('um chunk de selva gerado tem tronco da selva', () => {
    // Acha um chunk de clima de selva pelo clima (rápido) e confere no gerador.
    const seed = 2;
    const climate = new ClimateSampler(seed);
    const noise = new TerrainNoise(seed);
    const out = new Uint8Array(512);
    const jungleLog = BLOCK_BY_NAME.get('jungle_log')!.id;
    let found = false;
    for (let r = 0; r < 600 && !found; r += 3) {
      for (let a = 0; a < 16 && !found; a++) {
        const cx = Math.round(Math.cos(a / 16 * Math.PI * 2) * r);
        const cz = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
        climate.fillChunk(cx, cz, out, 0, 32);
        const t = out[8 * 32 + 16] / 127.5 - 1;
        const h = out[8 * 32 + 17] / 127.5 - 1;
        if (BIOMES[pickClimateBiome(t, h)].name !== 'jungle') continue;
        noise.field.prepare(cx, cz);
        if (BIOMES[noise.field.sample(cx * 16 + 8, cz * 16 + 8).biome].name !== 'jungle') continue;
        const chunk = generateChunk(seed, noise, cx, cz, { caves: false, ores: false, structures: false });
        let logs = 0;
        for (let y = 60; y < 128; y++) {
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) if (blockIdOf(chunk.getBlock(x, y, z)) === jungleLog) logs++;
          }
        }
        if (logs > 0) found = true;
      }
    }
    expect(found).toBe(true);
  }, 60_000);
});

describe('afogado', () => {
  it('é o zumbi da água: hostil, nada, e nasce só em rio e mar, no escuro', () => {
    const def = MOB_BY_NAME.get('drowned')!;
    expect(def.category).toBe('hostile');
    expect(def.traits.swims).toBe(true);
    expect(def.goals).not.toContain('floatInWater');
    const rule = spawnRuleOf('drowned')!;
    expect(rule.inWater).toBe(true);
    expect(rule.light).toBe('dark');
    expect([...rule.biomes].sort()).toEqual(['ocean', 'river']);
  });

  it('nada atrás do jogador em três dimensões, de baixo para cima', () => {
    // Um poço fundo de água, escuro: fundo em Y=40, superfície em Y=63.
    const world = new World(77);
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const chunk = new ChunkColumn(cx, cz);
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            chunk.setBlock(x, 39, z, makeState(BLOCK_BY_NAME.get('stone')!.id));
            for (let y = 40; y <= 63; y++) chunk.setBlock(x, y, z, makeFluid(WATER, 0));
          }
        }
        for (const section of chunk.sections) {
          section.blockLight = new Uint8Array(2048);
          section.skyLight = new Uint8Array(2048);
        }
        world.addChunk(chunk);
      }
    }
    const mobs = new Mobs(world, {
      onDrop: () => {}, onXp: () => {}, onSound: () => {}, onHitPlayer: () => {},
      onExplode: () => {}, onBreakBlock: () => {}, onArrow: () => {},
    });
    const rng = new Rng(5);
    mobs.random = () => rng.nextFloat();
    mobs.isDay = false;
    // A 14 blocos, dentro do raio de detecção (16).
    const i = mobs.spawn(MOB_BY_NAME.get('drowned')!.id, 6.5, 44, 6.5);
    const player = { x: 12.5, y: 55, z: 12.5, eyeY: 56.6, held: -1, alive: true };
    const s = mobs.store;
    const start = Math.hypot(s.x[i] - player.x, s.y[i] - player.y, s.z[i] - player.z);
    for (let t = 0; t < 120; t++) mobs.tick(player);
    const end = Math.hypot(s.x[i] - player.x, s.y[i] - player.y, s.z[i] - player.z);
    expect(end).toBeLessThan(start * 0.5);
    // Subiu: não ficou andando no fundo.
    expect(s.y[i]).toBeGreaterThan(48);
  });
});
