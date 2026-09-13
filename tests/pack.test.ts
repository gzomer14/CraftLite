/**
 * Resource pack do jogador (M7 — doc 13 §7).
 *
 * O decodificador de PNG é injetado, então o módulo inteiro é testável sem DOM
 * e sem um único byte de imagem no repositório: o "PNG" do teste é um texto
 * `LxA:r,g,b,a` que o decodificador falso expande. O que se testa é a
 * convenção de nomes, a recusa do que o jogo não conhece e a reamostragem.
 */
import { describe, expect, it } from 'vitest';
import {
  PackError, canonicalName, overridesFor, readPack, resample, targetSizeOf,
  type PackImage, type ResourcePack,
} from '../src/render/pack';
import { buildItemSheet } from '../src/render/itemsprites';
import { ITEMS } from '../src/data/items';
import { ITEM_ART } from '../src/data/itemart';

const encoder = new TextEncoder();

/** Zip de entradas guardadas sem compressão — basta para exercitar o pack. */
function buildZip(files: readonly [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let at = 0;
  for (const [name, data] of files) {
    const raw = encoder.encode(name);
    const header = new Uint8Array(30 + raw.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, raw.length, true);
    header.set(raw, 30);
    offsets.push(at);
    parts.push(header, data);
    at += header.length + data.length;
  }
  const directoryAt = at;
  for (let i = 0; i < files.length; i++) {
    const raw = encoder.encode(files[i][0]);
    const central = new Uint8Array(46 + raw.length);
    const view = new DataView(central.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(20, files[i][1].length, true);
    view.setUint32(24, files[i][1].length, true);
    view.setUint16(28, raw.length, true);
    view.setUint32(42, offsets[i], true);
    central.set(raw, 46);
    parts.push(central);
    at += central.length;
  }
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, at - directoryAt, true);
  endView.setUint32(16, directoryAt, true);
  parts.push(end);

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) { out.set(part, cursor); cursor += part.length; }
  return out;
}

/** "16x16:255,0,0,255" — uma cor chapada, que é tudo que o teste precisa ver. */
const png = (side: number, rgba: readonly number[]): Uint8Array =>
  encoder.encode(`${side}x${side}:${rgba.join(',')}`);

const fakeDecode = async (bytes: Uint8Array): Promise<PackImage> => {
  const text = new TextDecoder().decode(bytes);
  const match = /^(\d+)x(\d+):(.+)$/.exec(text);
  if (match === null) throw new Error('não é imagem');
  const width = Number(match[1]);
  const height = Number(match[2]);
  const rgba = match[3].split(',').map(Number);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
  }
  return { width, height, data };
};

const RED = [220, 30, 30, 255];

describe('convenção de nomes', () => {
  it('o caminho simples do doc vira nome canônico', () => {
    expect(canonicalName('block/stone.png')).toBe('block/stone');
    expect(canonicalName('item/diamond.png')).toBe('item/diamond');
  });

  it('prefixo de pastas é ignorado — só os dois últimos segmentos valem', () => {
    expect(canonicalName('assets/qualquer/textures/block/stone.png')).toBe('block/stone');
    expect(canonicalName('/pack/entity/zombie.PNG')).toBe('entity/zombie');
  });

  it('pasta que não é block, item ou entity não entra', () => {
    expect(canonicalName('sons/passo.png')).toBeNull();
    expect(canonicalName('stone.png')).toBeNull();
  });

  it('o destino conhece o tamanho de cada família', () => {
    expect(targetSizeOf('block/stone')).toBe(16);
    expect(targetSizeOf('item/diamond')).toBe(16);
    expect(targetSizeOf('entity/zombie')).toBe(64);
  });

  it('nome que o jogo não tem vale zero, em qualquer família', () => {
    expect(targetSizeOf('block/nao_existe')).toBe(0);
    expect(targetSizeOf('item/nao_existe')).toBe(0);
    expect(targetSizeOf('entity/nao_existe')).toBe(0);
  });
});

describe('reamostragem', () => {
  it('imagem maior é reduzida para o tamanho do destino', () => {
    const out = resample({ width: 64, height: 64, data: flat(64, RED) }, 16);
    expect(out.length).toBe(16 * 16 * 4);
    expect(Array.from(out.subarray(0, 4))).toEqual(RED);
  });

  it('imagem menor é ampliada sem borrar', () => {
    const out = resample({ width: 4, height: 4, data: flat(4, RED) }, 16);
    expect(Array.from(out.subarray(0, 4))).toEqual(RED);
  });

  it('imagem não quadrada não estoura o destino', () => {
    const data = new Uint8ClampedArray(32 * 8 * 4).fill(200);
    const out = resample({ width: 32, height: 8, data }, 16);
    expect(out.length).toBe(16 * 16 * 4);
  });

  it('pixel transparente não empresta a cor dele ao vizinho', () => {
    // 2×2: um opaco vermelho e três transparentes de cor branca.
    const data = new Uint8ClampedArray([
      220, 30, 30, 255, 255, 255, 255, 0,
      255, 255, 255, 0, 255, 255, 255, 0,
    ]);
    const out = resample({ width: 2, height: 2, data }, 1);
    expect(Array.from(out.subarray(0, 3))).toEqual([220, 30, 30]);
    // O alfa é a média: um quarto de cobertura.
    expect(out[3]).toBeCloseTo(64, 0);
  });

  it('imagem vazia devolve destino vazio em vez de quebrar', () => {
    const out = resample({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, 16);
    expect(out.length).toBe(16 * 16 * 4);
  });
});

describe('leitura do pacote', () => {
  it('aceita o que o jogo conhece e conta o que ignorou', async () => {
    const { pack, ignored } = await readPack('meu pack', buildZip([
      ['block/stone.png', png(16, RED)],
      ['item/diamond.png', png(16, RED)],
      ['entity/zombie.png', png(64, RED)],
      ['block/nao_existe.png', png(16, RED)],
      ['leiame.txt', encoder.encode('oi')],
    ]), fakeDecode);

    expect(pack.name).toBe('meu pack');
    expect(Array.from(pack.textures.keys()).sort())
      .toEqual(['block/stone', 'entity/zombie', 'item/diamond']);
    // O `.txt` não conta como ignorado: não era para ser imagem.
    expect(ignored).toEqual(['block/nao_existe.png']);
  });

  it('cada família sai no tamanho do destino dela', async () => {
    const { pack } = await readPack('p', buildZip([
      ['block/stone.png', png(128, RED)],
      ['entity/zombie.png', png(16, RED)],
    ]), fakeDecode);
    expect(pack.textures.get('block/stone')?.length).toBe(16 * 16 * 4);
    expect(pack.textures.get('entity/zombie')?.length).toBe(64 * 64 * 4);
  });

  it('imagem corrompida é ignorada, não derruba o pacote', async () => {
    const { pack, ignored } = await readPack('p', buildZip([
      ['block/stone.png', png(16, RED)],
      ['block/dirt.png', encoder.encode('isto não é um png')],
    ]), fakeDecode);
    expect(pack.textures.has('block/stone')).toBe(true);
    expect(ignored).toEqual(['block/dirt.png']);
  });

  it('zip sem nenhuma imagem reconhecida é recusado com mensagem', async () => {
    await expect(readPack('p', buildZip([
      ['leiame.txt', encoder.encode('oi')],
      ['block/nao_existe.png', png(16, RED)],
    ]), fakeDecode)).rejects.toThrow(PackError);
  });
});

describe('entrega das camadas', () => {
  const pack: ResourcePack = {
    name: 'p', importedAt: 0,
    textures: new Map([
      ['block/stone', new Uint8ClampedArray(16 * 16 * 4)],
      ['item/diamond', new Uint8ClampedArray(16 * 16 * 4)],
      ['entity/zombie', new Uint8ClampedArray(64 * 64 * 4)],
    ]),
  };

  it('cada família sai na chave do destino dela', () => {
    // Bloco mantém o prefixo: é o nome da camada em `data/textures.ts`.
    expect(Array.from(overridesFor(pack, 'block').keys())).toEqual(['block/stone']);
    expect(Array.from(overridesFor(pack, 'item').keys())).toEqual(['diamond']);
    expect(Array.from(overridesFor(pack, 'entity').keys())).toEqual(['zombie']);
  });

  it('sem pacote, o mapa vem vazio — o boot não precisa de caso especial', () => {
    expect(overridesFor(null, 'block').size).toBe(0);
  });
});

describe('folha de sprites com pacote', () => {
  const source = { texturePixels: () => null };

  it('a arte do jogador vence a máscara declarada', () => {
    const custom = new Uint8ClampedArray(16 * 16 * 4).fill(77);
    const sheet = buildItemSheet(source, new Map([['diamond', custom]]));
    const item = ITEMS.find((i) => i?.name === 'diamond');
    const tile = sheet.index.get(item?.id ?? -1);
    expect(tile).toBeDefined();
    const x = (tile as number) % sheet.columns;
    const y = Math.floor((tile as number) / sheet.columns);
    const o = ((y * 16) * sheet.width + x * 16) * 4;
    expect(sheet.pixels[o]).toBe(77);
  });

  it('item que não tinha desenho nenhum ganha um', () => {
    const orphan = ITEMS.find(
      (i) => i !== undefined && i.placesBlock === undefined && ITEM_ART[i.name] === undefined,
    );
    if (orphan === undefined) return; // todo item tem arte: nada a provar
    const before = buildItemSheet(source);
    expect(before.index.has(orphan.id)).toBe(false);

    const custom = new Uint8ClampedArray(16 * 16 * 4).fill(42);
    const after = buildItemSheet(source, new Map([[orphan.name, custom]]));
    expect(after.index.has(orphan.id)).toBe(true);
  });
});

function flat(side: number, rgba: readonly number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(side * side * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3];
  }
  return data;
}
