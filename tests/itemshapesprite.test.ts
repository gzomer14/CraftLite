/**
 * O sprite do inventário segue a **forma** do bloco (M8).
 *
 * Ele desenhava sempre um cubo isométrico com a textura do bloco. Consequência
 * relatada pelo jogador: *"vários itens estão com textura que parece um bloco
 * de madeira normal, mas na realidade colocando no chão são outros itens, como
 * por exemplo a placa de madeira, a cerca, melancia, abóbora, alçapão, laje"*.
 * Cerca, laje, placa, alçapão, escada e portão são todos de tábua — como cubo,
 * os seis eram **o mesmo desenho**.
 *
 * O que estes testes fixam é que a silhueta agora vem de `boxesFor`, a mesma
 * lista que o mundo desenha e que a física colide. Se alguém trocar a forma de
 * um bloco, o slot acompanha sozinho.
 */
import { describe, expect, it } from 'vitest';
import { drawBlockIsometric } from '../src/render/itemsprites';
import { renderRecipe } from '../src/render/texgen';
import { TEXTURES } from '../src/data/textures';
import { BLOCK_BY_NAME } from '../src/data/blocks';

const cache = new Map<string, Uint8ClampedArray>();
const build = (name: string): Uint8ClampedArray => {
  const recipe = TEXTURES[name];
  if (recipe === undefined) return new Uint8ClampedArray(16 * 16 * 4);
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const data = renderRecipe(recipe, 7, build);
  cache.set(name, data);
  return data;
};
const source = { texturePixels: (name: string) => build(name) };

/** Sprite de 16×16 do bloco, como o inventário monta. */
function sprite(name: string): Uint8ClampedArray {
  const def = BLOCK_BY_NAME.get(name);
  expect(def, name).toBeDefined();
  const tile = new Uint8ClampedArray(16 * 16 * 4);
  drawBlockIsometric(tile, def!.id, source, 16, false);
  return tile;
}

/** Máscara de opacidade como string, uma linha por linha do tile. */
function silhouette(tile: Uint8ClampedArray): string {
  let out = '';
  for (let i = 0; i < 16 * 16; i++) out += tile[(i << 2) + 3] >= 128 ? '#' : '.';
  return out;
}

const filled = (tile: Uint8ClampedArray): number => {
  let n = 0;
  for (let i = 0; i < 16 * 16; i++) if (tile[(i << 2) + 3] >= 128) n++;
  return n;
};

/** Em que linhas do tile há desenho. */
function rowsUsed(tile: Uint8ClampedArray): [number, number] {
  let first = 16;
  let last = -1;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (tile[(((y * 16) + x) << 2) + 3] < 128) continue;
      if (y < first) first = y;
      if (y > last) last = y;
    }
  }
  return [first, last];
}

describe('peças de tábua deixaram de ser o mesmo cubo', () => {
  const planks = silhouette(sprite('oak_planks'));

  for (const name of ['oak_slab', 'oak_fence', 'oak_sign', 'oak_trapdoor', 'oak_fence_gate']) {
    it(`${name} não tem a silhueta de um bloco de tábua`, () => {
      expect(silhouette(sprite(name))).not.toBe(planks);
    });
  }

  it('e nenhuma delas repete a silhueta da outra', () => {
    const vistos = new Map<string, string>();
    for (const name of ['oak_planks', 'oak_slab', 'oak_fence', 'oak_sign', 'oak_trapdoor',
      'oak_fence_gate', 'oak_stairs']) {
      const mask = silhouette(sprite(name));
      const antes = vistos.get(mask);
      expect(antes, `${name} tem a mesma silhueta de ${antes ?? ''}`).toBeUndefined();
      vistos.set(mask, name);
    }
  });
});

describe('a forma que o mundo desenha é a que o slot mostra', () => {
  it('a laje ocupa metade da altura do cubo', () => {
    const cubo = rowsUsed(sprite('oak_planks'));
    const laje = rowsUsed(sprite('oak_slab'));
    // Ela começa mais embaixo e termina junto: é meia altura pousada no chão.
    expect(laje[0]).toBeGreaterThan(cubo[0] + 2);
    expect(laje[1]).toBe(cubo[1]);
  });

  it('o alçapão é mais raso que a laje', () => {
    expect(rowsUsed(sprite('oak_trapdoor'))[0])
      .toBeGreaterThan(rowsUsed(sprite('oak_slab'))[0]);
  });

  it('a cerca é magra: gasta menos de metade dos pixels de um cubo', () => {
    expect(filled(sprite('oak_fence'))).toBeLessThan(filled(sprite('oak_planks')) / 2);
  });

  it('a placa tem poste e tábua, então é mais alta que larga no meio', () => {
    const tile = sprite('oak_sign');
    // A linha do poste (embaixo) é estreita; a da tábua (em cima) é larga.
    const largura = (y: number): number => {
      let n = 0;
      for (let x = 0; x < 16; x++) if (tile[(((y * 16) + x) << 2) + 3] >= 128) n++;
      return n;
    };
    expect(largura(5)).toBeGreaterThan(largura(12));
  });

  it('o baú é menor que o bloco: ele não encosta na borda do tile', () => {
    expect(filled(sprite('chest'))).toBeLessThan(filled(sprite('crafting_table')));
  });
});

describe('planta e trilho são o ladrilho de frente, não um cubo', () => {
  for (const name of ['dandelion', 'poppy', 'tall_grass', 'oak_sapling', 'fern', 'rail']) {
    it(`${name} não vira cubo`, () => {
      expect(silhouette(sprite(name))).not.toBe(silhouette(sprite('stone')));
    });
  }

  /*
   * As quatro plantas apontavam a **mesma** textura antes do M8: muda e
   * trepadeira usavam a folhagem, samambaia, cana e arbusto seco a grama alta.
   * Quatro cubos verdes iguais no inventário.
   */
  it('cada planta tem a sua silhueta', () => {
    const vistos = new Map<string, string>();
    for (const name of ['tall_grass', 'fern', 'oak_sapling', 'sugar_cane', 'dead_bush',
      'dandelion', 'poppy']) {
      const mask = silhouette(sprite(name));
      const antes = vistos.get(mask);
      expect(antes, `${name} repete ${antes ?? ''}`).toBeUndefined();
      vistos.set(mask, name);
    }
  });

  it('a flor tem haste: há desenho na coluna do meio, embaixo', () => {
    const tile = sprite('dandelion');
    expect(tile[((((12 * 16) + 7)) << 2) + 3]).toBeGreaterThanOrEqual(128);
  });
});

describe('o cubo continua sendo o cubo de sempre', () => {
  it('a pedra desenha o hexágono cheio, tocando as quatro bordas do tile', () => {
    const tile = sprite('stone');
    const [primeira, ultima] = rowsUsed(tile);
    expect(primeira).toBe(1);
    expect(ultima).toBe(15);
    // A linha do meio atravessa o tile inteiro.
    for (let x = 0; x < 16; x++) {
      expect(tile[((((8 * 16) + x)) << 2) + 3]).toBeGreaterThanOrEqual(128);
    }
  });
});
