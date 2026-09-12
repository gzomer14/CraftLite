/**
 * Sprites de item (doc 13 §2.4, pendência P4 do M4).
 *
 * O que se garante aqui: **nenhum item fica sem desenho**. Era esse o problema
 * — toda ferramenta e todo material caíam na textura de "faltando", e o
 * inventário virava um mosaico de quadrados roxos.
 *
 * A parte que toca o DOM (canvas → data URL) fica fora: o que interessa testar
 * são os pixels, e eles saem de função pura.
 */
import { describe, expect, it } from 'vitest';
import { ITEM_ART, SHAPES } from '../src/data/itemart';
import { ITEMS, itemDef, ITEM_BY_NAME } from '../src/data/items';
import {
  SPRITE_SIZE, buildItemSheet, drawBlockIsometric, drawItemArt, type SpriteSource,
} from '../src/render/itemsprites';
import { BLOCK_BY_NAME } from '../src/data/blocks';

/** Fonte de textura falsa: cada nome vira uma cor chapada e opaca. */
function fakeSource(): SpriteSource {
  const cache = new Map<string, Uint8ClampedArray>();
  return {
    texturePixels(name: string): Uint8ClampedArray | null {
      const hit = cache.get(name);
      if (hit !== undefined) return hit;
      const data = new Uint8ClampedArray(SPRITE_SIZE * SPRITE_SIZE * 4);
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = (hash >> 16) & 255;
        data[i + 1] = (hash >> 8) & 255;
        data[i + 2] = hash & 255;
        data[i + 3] = 255;
      }
      cache.set(name, data);
      return data;
    },
  };
}

function opaquePixels(tile: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < tile.length; i += 4) if (tile[i] > 0) n++;
  return n;
}

describe('máscaras', () => {
  it('toda silhueta é 16×16 e só usa papéis conhecidos', () => {
    const roles = new Set('.mMdaAx');
    for (const name of Object.keys(SHAPES)) {
      const mask = SHAPES[name];
      expect(mask.length, name).toBe(SPRITE_SIZE);
      for (const row of mask) {
        expect(row.length, `${name}: "${row}"`).toBe(SPRITE_SIZE);
        for (const char of row) expect(roles.has(char), `${name}: '${char}'`).toBe(true);
      }
    }
  });

  it('nenhuma silhueta é uma máscara vazia', () => {
    for (const name of Object.keys(SHAPES)) {
      const filled = SHAPES[name].join('').replace(/\./g, '').length;
      expect(filled, name).toBeGreaterThan(10);
    }
  });

  it('toda arte declarada aponta para uma silhueta que existe', () => {
    for (const name of Object.keys(ITEM_ART)) {
      expect(SHAPES[ITEM_ART[name].shape], name).toBeDefined();
    }
  });
});

describe('cobertura de itens', () => {
  it('todo item que não é bloco tem arte (o ponto da P4)', () => {
    const missing: string[] = [];
    for (const item of ITEMS) {
      if (item === undefined) continue;
      if (item.placesBlock !== undefined) continue;
      if (ITEM_ART[item.name] === undefined) missing.push(item.name);
    }
    expect(missing).toEqual([]);
  });

  it('a folha indexa item de bloco e item comum', () => {
    const sheet = buildItemSheet(fakeSource());
    expect(sheet.index.has(BLOCK_BY_NAME.get('stone')!.id)).toBe(true);
    expect(sheet.index.has(ITEM_BY_NAME.get('iron_pickaxe')!.id)).toBe(true);
    expect(sheet.index.size).toBeGreaterThan(100);
  });

  it('a folha tem o tamanho certo para os tiles que indexa', () => {
    const sheet = buildItemSheet(fakeSource());
    expect(sheet.width).toBe(sheet.columns * SPRITE_SIZE);
    expect(sheet.height).toBe(sheet.rows * SPRITE_SIZE);
    expect(sheet.pixels.length).toBe(sheet.width * sheet.height * 4);
    expect(sheet.rows * sheet.columns).toBeGreaterThanOrEqual(sheet.index.size);
  });

  it('nenhum tile sai em branco', () => {
    const sheet = buildItemSheet(fakeSource());
    const empty: string[] = [];
    for (const [item, tile] of sheet.index) {
      const column = tile % sheet.columns;
      const row = Math.floor(tile / sheet.columns);
      let filled = 0;
      for (let y = 0; y < SPRITE_SIZE; y++) {
        for (let x = 0; x < SPRITE_SIZE; x++) {
          const o = (((row * SPRITE_SIZE + y) * sheet.width) + column * SPRITE_SIZE + x) * 4;
          if (sheet.pixels[o + 3] > 0) filled++;
        }
      }
      if (filled < 8) empty.push(itemDef(item)?.name ?? String(item));
    }
    expect(empty).toEqual([]);
  });
});

describe('cubo isométrico', () => {
  const tile = (): Uint8ClampedArray => new Uint8ClampedArray(SPRITE_SIZE * SPRITE_SIZE * 4);

  it('desenha a silhueta do cubo, não o quadrado inteiro', () => {
    const out = tile();
    drawBlockIsometric(out, BLOCK_BY_NAME.get('stone')!.id, fakeSource());

    const filled = opaquePixels(out);
    expect(filled).toBeGreaterThan(120);
    // Um quadrado cheio teria 256; o cubo deixa os quatro cantos vazios.
    expect(filled).toBeLessThan(240);

    const corner = (x: number, y: number): number => out[((y * SPRITE_SIZE) + x) * 4 + 3];
    expect(corner(0, 0)).toBe(0);
    expect(corner(15, 0)).toBe(0);
    // O topo do losango e a base das faces laterais existem.
    expect(corner(8, 1)).toBeGreaterThan(0);
    expect(corner(8, 15)).toBeGreaterThan(0);
  });

  it('as três faces saem com brilhos diferentes', () => {
    const out = tile();
    drawBlockIsometric(out, BLOCK_BY_NAME.get('stone')!.id, fakeSource());
    const at = (x: number, y: number): number => {
      const o = ((y * SPRITE_SIZE) + x) * 4;
      return out[o] + out[o + 1] + out[o + 2];
    };
    const top = at(8, 2);
    const left = at(2, 10);
    const right = at(13, 10);
    expect(top).toBeGreaterThan(left);
    expect(left).toBeGreaterThan(right);
  });

  it('bloco sem textura não quebra nem pinta nada', () => {
    const out = tile();
    drawBlockIsometric(out, 999, { texturePixels: () => null });
    expect(opaquePixels(out)).toBe(0);
  });
});

describe('desenho por máscara', () => {
  it('a cor principal da arte aparece no sprite', () => {
    const out = new Uint8ClampedArray(SPRITE_SIZE * SPRITE_SIZE * 4);
    drawItemArt(out, { shape: 'ingot', color: [10, 200, 30] });

    let found = false;
    for (let i = 0; i < out.length; i += 4) {
      if (out[i] === 10 && out[i + 1] === 200 && out[i + 2] === 30) { found = true; break; }
    }
    expect(found).toBe(true);
    expect(opaquePixels(out)).toBeGreaterThan(20);
  });

  it('o mesmo desenho serve materiais diferentes', () => {
    const wooden = new Uint8ClampedArray(SPRITE_SIZE * SPRITE_SIZE * 4);
    const diamond = new Uint8ClampedArray(SPRITE_SIZE * SPRITE_SIZE * 4);
    drawItemArt(wooden, ITEM_ART.wooden_pickaxe);
    drawItemArt(diamond, ITEM_ART.diamond_pickaxe);

    // Mesma silhueta…
    expect(opaquePixels(wooden)).toBe(opaquePixels(diamond));
    // …cores diferentes.
    expect(Array.from(wooden)).not.toEqual(Array.from(diamond));
  });

  it('arte ausente não desenha nada', () => {
    const out = new Uint8ClampedArray(SPRITE_SIZE * SPRITE_SIZE * 4);
    drawItemArt(out, undefined);
    expect(opaquePixels(out)).toBe(0);
  });
});
