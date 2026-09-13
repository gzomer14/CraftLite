/**
 * Estilo de textura Nítido (doc 13 §2, extensão).
 *
 * O que se garante aqui, em ordem de importância:
 *
 *  - **o Clássico não mexe em nada** — nenhum byte, nenhum tamanho de folha,
 *    nenhuma chamada a mais. É a promessa que o jogador recebe ao desligar;
 *  - o contraste gira em torno da média da própria textura, e não do cinza
 *    fixo. Com pivô fixo, neve e lã eram empurradas para o branco chapado —
 *    foi assim na primeira versão, e a prova está no teste do ladrilho claro;
 *  - o volume de item mede cada peça separada, senão a cabeça da pá de madeira
 *    some dentro do cabo;
 *  - o contorno do cubo isométrico não entra em desenho de traço fino.
 */
import { describe, expect, it } from 'vitest';
import {
  BLOCK_FINISH, ITEM_FINISHES, blockFinishOf, itemMaterialOf,
} from '../src/data/texturestyle';
import { ITEM_ART } from '../src/data/itemart';
import { NO_FINISH, applyFinish } from '../src/render/texfinish';
import {
  HD_SPRITE_SIZE, distanceByPart, distanceToEdge, drawItemArt3d,
} from '../src/render/itemart3d';
import {
  SPRITE_SIZE, buildItemSheet, drawItemArt, strokeThickness, type SpriteSource,
} from '../src/render/itemsprites';
import { ITEMS, ITEM_BY_NAME } from '../src/data/items';

const N = 16;

/** Ladrilho de cor chapada e opaca. */
function flat(r: number, g: number, b: number, size = N): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return data;
}

function luma(data: Uint8ClampedArray, x: number, y: number, size = N): number {
  const o = ((y * size) + x) << 2;
  return data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
}

/** Fonte de textura falsa, uma cor chapada por nome. */
function fakeSource(): SpriteSource {
  return {
    texturePixels(name: string): Uint8ClampedArray {
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffff;
      return flat((hash >> 16) & 255, (hash >> 8) & 255, hash & 255);
    },
  };
}

describe('acabamento de textura', () => {
  it('o estilo neutro devolve a textura intacta', () => {
    const original = flat(120, 90, 60);
    const copy = original.slice();
    applyFinish(copy, N, NO_FINISH);
    expect(Array.from(copy)).toEqual(Array.from(original));
  });

  it('relevo não mexe em superfície lisa — não há inclinação para iluminar', () => {
    const data = flat(120, 120, 120);
    applyFinish(data, N, { ...NO_FINISH, relief: 1 });
    for (let i = 0; i < data.length; i += 4) expect(data[i]).toBe(120);
  });

  it('relevo escurece o lado que desce da luz e clareia o que sobe', () => {
    // Degrau vertical: metade esquerda escura, metade direita clara.
    const data = flat(80, 80, 80);
    for (let y = 0; y < N; y++) {
      for (let x = 8; x < N; x++) {
        const o = ((y * N) + x) << 2;
        data[o] = 180; data[o + 1] = 180; data[o + 2] = 180;
      }
    }
    applyFinish(data, N, { ...NO_FINISH, relief: 0.5 });
    // Em x=8 a altura sobe para a direita: a face vira as costas para a luz.
    expect(luma(data, 8, 4)).toBeLessThan(180);
    // Em x=7 a altura ainda sobe: o pixel escuro fica mais escuro ainda.
    expect(luma(data, 7, 4)).toBeLessThan(80);
  });

  it('o contraste gira na média da textura: ladrilho claro não vira branco', () => {
    const data = flat(246, 246, 246);
    applyFinish(data, N, { ...NO_FINISH, contrast: 2.5 });
    // Com pivô fixo em 128 isto saturaria em 255 e a neve viraria um vazio
    // branco. Girando na média da própria textura, ela fica onde estava.
    expect(data[0]).toBe(246);
    expect(data[1]).toBe(246);
    expect(data[2]).toBe(246);
  });

  it('o contraste abre a distância entre claro e escuro', () => {
    const data = flat(100, 100, 100);
    for (let x = 0; x < N; x++) {
      const o = x << 2;
      data[o] = 160; data[o + 1] = 160; data[o + 2] = 160;
    }
    const antes = luma(data, 0, 0) - luma(data, 0, 5);
    applyFinish(data, N, { ...NO_FINISH, contrast: 1.5 });
    expect(luma(data, 0, 0) - luma(data, 0, 5)).toBeGreaterThan(antes);
  });

  it('o chanfro clareia a borda de cima e escurece a de baixo', () => {
    const data = flat(120, 120, 120);
    applyFinish(data, N, { ...NO_FINISH, rim: 0.3 });
    expect(luma(data, 0, 0)).toBeGreaterThan(120);
    expect(luma(data, N - 1, N - 1)).toBeLessThan(120);
    expect(luma(data, 8, 8)).toBe(120);
  });

  it('textura vazada não leva chanfro: ali a borda é recorte, não quina', () => {
    const data = flat(120, 120, 120);
    data[(((4 * N) + 4) << 2) + 3] = 0;
    applyFinish(data, N, { ...NO_FINISH, rim: 0.3 });
    expect(luma(data, 0, 0)).toBe(120);
    expect(luma(data, N - 1, N - 1)).toBe(120);
  });

  it('o alfa atravessa o acabamento sem mudar', () => {
    const data = flat(120, 90, 60);
    for (let i = 0; i < 40; i++) data[(i << 2) + 3] = i * 6;
    const antes = Array.from({ length: 40 }, (_, i) => data[(i << 2) + 3]);
    applyFinish(data, N, BLOCK_FINISH);
    for (let i = 0; i < 40; i++) expect(data[(i << 2) + 3]).toBe(antes[i]);
  });

  it('a tabela de exceções sobrepõe só o que declara', () => {
    expect(blockFinishOf('block/stone')).toEqual(BLOCK_FINISH);
    // Água e lava rolam por cima de si mesmas: acabamento nenhum.
    expect(blockFinishOf('block/water')).toEqual(NO_FINISH);
    // O granito muda a cor mas mantém o relevo da tabela base.
    expect(blockFinishOf('block/granite').tint).toBeDefined();
    expect(blockFinishOf('block/granite').relief).toBe(BLOCK_FINISH.relief);
  });
});

describe('volume dos sprites de item', () => {
  it('a distância cresce do contorno para o miolo', () => {
    const cheio = new Uint8Array(N * N).fill(1);
    const d = distanceToEdge(cheio, N);
    expect(d[(8 * N) + 8]).toBeGreaterThan(d[(1 * N) + 1]);
    expect(d[0]).toBeGreaterThan(0);
  });

  it('cada peça mede a própria borda — é o vinco entre cabeça e cabo', () => {
    const juntas = new Uint8Array(N * N).fill(1);
    const separadas = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) separadas[(y * N) + x] = x < 8 ? 1 : 2;
    }
    const contínuo = distanceToEdge(juntas, N)[(8 * N) + 7];
    const partido = distanceByPart(separadas, N)[(8 * N) + 7];
    expect(partido).toBeLessThan(contínuo);
    expect(partido).toBeLessThanOrEqual(1);
  });

  it('a luz vem de cima-à-esquerda', () => {
    const out = new Uint8ClampedArray(HD_SPRITE_SIZE * HD_SPRITE_SIZE * 4);
    drawItemArt3d(out, HD_SPRITE_SIZE, { shape: 'round', color: [180, 180, 180] },
      ITEM_FINISHES.soft);
    const claro = luma(out, 13, 13, HD_SPRITE_SIZE);
    const escuro = luma(out, 19, 19, HD_SPRITE_SIZE);
    expect(claro).toBeGreaterThan(escuro);
  });

  it('metal reflete mais que fosco com a mesma silhueta', () => {
    const brilho = (finish: typeof ITEM_FINISHES.metal): number => {
      const out = new Uint8ClampedArray(HD_SPRITE_SIZE * HD_SPRITE_SIZE * 4);
      drawItemArt3d(out, HD_SPRITE_SIZE, { shape: 'round', color: [140, 140, 140] }, finish);
      let max = 0;
      for (let i = 0; i < out.length; i += 4) max = Math.max(max, out[i]);
      return max;
    };
    expect(brilho(ITEM_FINISHES.metal)).toBeGreaterThan(brilho(ITEM_FINISHES.matte));
  });

  it('a silhueta ganha contorno de um pixel, mais escuro que o corpo', () => {
    const out = new Uint8ClampedArray(HD_SPRITE_SIZE * HD_SPRITE_SIZE * 4);
    const art = { shape: 'round' as const, color: [200, 120, 80] as const };
    drawItemArt3d(out, HD_SPRITE_SIZE, art, ITEM_FINISHES.soft);
    // 'round' começa vazio na linha 0; o contorno tem que aparecer colado ao
    // corpo e ser mais escuro que ele.
    let achou = false;
    for (let y = 1; y < HD_SPRITE_SIZE - 1 && !achou; y++) {
      for (let x = 1; x < HD_SPRITE_SIZE - 1; x++) {
        const o = (((y * HD_SPRITE_SIZE) + x) << 2);
        const abaixo = ((((y + 1) * HD_SPRITE_SIZE) + x) << 2);
        if (out[o + 3] === 255 && out[abaixo + 3] === 255
          && luma(out, x, y, HD_SPRITE_SIZE) * 2 < luma(out, x, y + 1, HD_SPRITE_SIZE)) {
          achou = true;
          break;
        }
      }
    }
    expect(achou).toBe(true);
  });

  it('material vem do nome antes da silhueta', () => {
    expect(itemMaterialOf('iron_pickaxe', 'pickaxe')).toBe('metal');
    expect(itemMaterialOf('diamond_pickaxe', 'pickaxe')).toBe('gem');
    expect(itemMaterialOf('wooden_pickaxe', 'pickaxe')).toBe('matte');
    expect(itemMaterialOf('emerald', 'gem')).toBe('gem');
    expect(itemMaterialOf('nada_disso', 'chunk')).toBe('stone');
  });

  it('todo item desenhado tem material — nenhum cai fora da tabela', () => {
    for (const name of Object.keys(ITEM_ART)) {
      const art = ITEM_ART[name];
      expect(ITEM_FINISHES[itemMaterialOf(name, art.shape)], name).toBeDefined();
    }
  });
});

describe('espessura de traço', () => {
  it('linha de um pixel dá um; bloco cheio dá muito mais', () => {
    const linha = new Uint8ClampedArray(N * N * 4);
    for (let x = 0; x < N; x++) linha[(((8 * N) + x) << 2) + 3] = 255;
    expect(strokeThickness(linha, N)).toBeCloseTo(1, 5);
    expect(strokeThickness(flat(1, 1, 1), N)).toBeGreaterThan(2.6);
  });
});

describe('folha de sprites por estilo', () => {
  it('o Clássico continua idêntico ao que sempre foi', () => {
    const sheet = buildItemSheet(fakeSource());
    expect(sheet.width).toBe(sheet.columns * SPRITE_SIZE);
    const ferro = ITEM_BY_NAME.get('iron_pickaxe');
    expect(ferro).toBeDefined();
    const tile = sheet.index.get(ferro!.id);
    expect(tile).toBeDefined();
    const esperado = new Uint8ClampedArray(SPRITE_SIZE * SPRITE_SIZE * 4);
    drawItemArt(esperado, ITEM_ART.iron_pickaxe);
    const column = tile! % sheet.columns;
    const row = Math.floor(tile! / sheet.columns);
    for (let y = 0; y < SPRITE_SIZE; y++) {
      for (let x = 0; x < SPRITE_SIZE; x++) {
        const o = ((((row * SPRITE_SIZE) + y) * sheet.width) + (column * SPRITE_SIZE) + x) << 2;
        const e = (((y * SPRITE_SIZE) + x) << 2);
        expect(sheet.pixels[o + 3]).toBe(esperado[e + 3]);
        expect(sheet.pixels[o]).toBe(esperado[e]);
      }
    }
  });

  it('o Nítido dobra o tile e mantém todo item desenhado', () => {
    const base = buildItemSheet(fakeSource());
    const hd = buildItemSheet(fakeSource(), undefined,
      { size: HD_SPRITE_SIZE, style: 'nitido' });
    expect(hd.width).toBe(hd.columns * HD_SPRITE_SIZE);
    expect(hd.index.size).toBe(base.index.size);
    for (const item of ITEMS) {
      if (item === undefined) continue;
      if (base.index.has(item.id)) expect(hd.index.has(item.id), item.name).toBe(true);
    }
  });

  it('a arte do pacote do jogador é ampliada, não sombreada', () => {
    const custom = new Uint8ClampedArray(SPRITE_SIZE * SPRITE_SIZE * 4);
    for (let i = 0; i < custom.length; i += 4) {
      custom[i] = 10; custom[i + 1] = 200; custom[i + 2] = 30; custom[i + 3] = 255;
    }
    const sheet = buildItemSheet(fakeSource(), new Map([['diamond', custom]]),
      { size: HD_SPRITE_SIZE, style: 'nitido' });
    const item = ITEM_BY_NAME.get('diamond');
    const tile = sheet.index.get(item!.id)!;
    const column = tile % sheet.columns;
    const row = Math.floor(tile / sheet.columns);
    const o = ((((row * HD_SPRITE_SIZE) + 5) * sheet.width)
      + (column * HD_SPRITE_SIZE) + 5) << 2;
    expect(sheet.pixels[o]).toBe(10);
    expect(sheet.pixels[o + 1]).toBe(200);
    expect(sheet.pixels[o + 2]).toBe(30);
  });
});
