/**
 * Resource pack do jogador (doc 13 §7, doc 14 — M7).
 *
 * **A regra do doc 13 §1 continua inteira:** nenhum asset de terceiros entra no
 * repositório. Todo pixel que o jogo distribui sai de `data/textures.ts`,
 * `data/itemart.ts` e `data/mobskins.ts`, receitas que rodam no boot. Um pack é
 * o caminho para quem quer a **própria** arte: um `.zip` que o jogador escolhe,
 * que mora no banco dele e que nunca passa por servidor nem por `src/`.
 *
 * A convenção de nomes é a do doc 13 §7, com uma folga: o caminho pode ter
 * qualquer prefixo de pastas, e o que vale são os **dois últimos segmentos** —
 * `block/stone.png` e `assets/qualquer/textures/block/stone.png` chegam no
 * mesmo lugar. São três famílias:
 *
 * - `block/<textura>` — camada do atlas de blocos, 16×16 (`data/textures.ts`).
 * - `item/<item>` — tile da folha de sprites, 16×16 (`data/items.ts`).
 * - `entity/<skin>` — camada do atlas de entidades, 64×64 (`data/mobs.ts`).
 *
 * Imagem de outro tamanho é **reamostrada no import**, não no boot: o jogador
 * paga uma vez, e o que vai para o banco já está pronto para subir na GPU.
 * Nome que não corresponde a nada do jogo é recusado e contado — guardar o que
 * ninguém vai ler só gastaria a cota do doc 11 §4.
 *
 * **O pack é aplicado no boot, antes de o atlas subir para a GPU.** Trocar de
 * pack recarrega a página, como "Restaurar padrões" das opções já faz. A
 * alternativa — reconstruir atlas, mipmaps, médias de cor, folha de sprites em
 * data URL e as duas texturas de GPU que derivam dela — seria um grafo de
 * invalidação inteiro para um botão que se aperta uma vez por mês.
 */

import { TEXTURES } from '../data/textures';
import { ITEM_BY_NAME } from '../data/items';
import { STORE_SETTINGS, type SaveDatabase } from '../save/db';
import { readZip } from '../core/zip';
import { entitySkinNames } from './entityatlas';
import { TEX_SIZE } from './texgen';

/** Chave do pack no store de configurações — sem versão nova de banco. */
export const PACK_KEY = 'resourcepack';
/** Lado das camadas de entidade, repetido aqui para não importar o atlas. */
const SKIN_SIZE = 64;
/** Teto de imagens aceitas. Um pack maior que isto não é um pack, é engano. */
const MAX_IMAGES = 512;

export interface PackImage {
  width: number;
  height: number;
  /** RGBA, `width * height * 4`. */
  data: Uint8ClampedArray;
}

/** Decodificador de PNG. Injetado para o formato ser testável sem DOM. */
export type PackDecoder = (bytes: Uint8Array) => Promise<PackImage>;

export interface ResourcePack {
  name: string;
  importedAt: number;
  /**
   * Nome canônico → RGBA já no tamanho do destino.
   *
   * `Map` de `Uint8ClampedArray` atravessa o clone estruturado do IndexedDB
   * como está: nada é reserializado para guardar nem para ler de volta.
   */
  textures: Map<string, Uint8ClampedArray>;
}

export interface PackReport {
  pack: ResourcePack;
  /** Caminhos que não correspondem a nada do jogo. */
  ignored: string[];
}

/** Erro de pack, com frase pronta para a tela. */
export class PackError extends Error {}

// --- leitura ---------------------------------------------------------------

/**
 * Lê o `.zip` e devolve o pack pronto para guardar.
 *
 * Não toca no banco nem no DOM: quem decodifica PNG é o `decode` recebido.
 */
export async function readPack(
  name: string, bytes: Uint8Array, decode: PackDecoder,
): Promise<PackReport> {
  const files = await readZip(bytes);
  const textures = new Map<string, Uint8ClampedArray>();
  const ignored: string[] = [];

  for (const [path, data] of files) {
    if (!path.toLowerCase().endsWith('.png')) continue;
    const canonical = canonicalName(path);
    const size = canonical === null ? 0 : targetSizeOf(canonical);
    if (canonical === null || size === 0) {
      ignored.push(path);
      continue;
    }
    if (textures.size >= MAX_IMAGES) {
      throw new PackError(`Pack grande demais: mais de ${MAX_IMAGES} imagens.`);
    }
    let image: PackImage;
    try {
      image = await decode(data);
    } catch {
      ignored.push(path);
      continue;
    }
    textures.set(canonical, resample(image, size));
  }

  if (textures.size === 0) {
    throw new PackError('Nenhuma imagem reconhecida. Veja a convenção de nomes.');
  }
  return { pack: { name, importedAt: Date.now(), textures }, ignored };
}

/**
 * `assets/x/textures/block/stone.png` → `block/stone`.
 * `null` quando o caminho não tem os dois segmentos de que precisamos.
 */
export function canonicalName(path: string): string | null {
  const clean = path.replace(/^\/+/, '').replace(/\.png$/i, '');
  const parts = clean.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length < 2) return null;
  const folder = parts[parts.length - 2].toLowerCase();
  const file = parts[parts.length - 1];
  if (folder !== 'block' && folder !== 'item' && folder !== 'entity') return null;
  return `${folder}/${file}`;
}

/** Lado da imagem no destino, ou 0 se o jogo não tem nada com esse nome. */
export function targetSizeOf(canonical: string): number {
  const slash = canonical.indexOf('/');
  const folder = canonical.slice(0, slash);
  const name = canonical.slice(slash + 1);
  // A tabela de texturas já nomeia tudo com `block/` — é justamente por isso
  // que a convenção do doc 13 cai certo sem tradução nenhuma.
  if (folder === 'block') return TEXTURES[canonical] !== undefined ? TEX_SIZE : 0;
  if (folder === 'item') return ITEM_BY_NAME.has(name) ? TEX_SIZE : 0;
  if (folder === 'entity') return entitySkinNames().includes(name) ? SKIN_SIZE : 0;
  return 0;
}

/**
 * Reamostra para `size`×`size` por média de caixa, ponderada pelo alfa.
 *
 * A ponderação é a mesma dos mipmaps do atlas e existe pelo mesmo motivo: sem
 * ela, a cor do pixel transparente entra na média e a borda de um vidro ou de
 * uma folha ganha um halo da cor de fundo do PNG.
 */
export function resample(image: PackImage, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) return out;

  for (let y = 0; y < size; y++) {
    const y0 = Math.floor((y * height) / size);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / size));
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor((x * width) / size);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / size));

      let r = 0, g = 0, b = 0, alpha = 0, weight = 0, count = 0;
      for (let sy = y0; sy < y1 && sy < height; sy++) {
        for (let sx = x0; sx < x1 && sx < width; sx++) {
          const o = ((sy * width) + sx) << 2;
          const a = data[o + 3];
          r += data[o] * a;
          g += data[o + 1] * a;
          b += data[o + 2] * a;
          weight += a;
          alpha += a;
          count++;
        }
      }
      const o = ((y * size) + x) << 2;
      if (weight > 0) {
        out[o] = r / weight;
        out[o + 1] = g / weight;
        out[o + 2] = b / weight;
      }
      out[o + 3] = count > 0 ? alpha / count : 0;
    }
  }
  return out;
}

/**
 * As camadas de uma família, já na chave que o destino usa.
 *
 * Bloco sai com o prefixo (`block/stone`), porque é assim que `data/textures.ts`
 * nomeia camada; item e entidade saem sem ele, porque item e skin se chamam
 * `diamond` e `zombie`. É a única assimetria da convenção, e ela está aqui
 * justamente para não vazar para o atlas nem para a folha de sprites.
 */
export function overridesFor(
  pack: ResourcePack | null, folder: 'block' | 'item' | 'entity',
): ReadonlyMap<string, Uint8ClampedArray> {
  const out = new Map<string, Uint8ClampedArray>();
  if (pack === null) return out;
  const prefix = `${folder}/`;
  for (const [name, data] of pack.textures) {
    if (!name.startsWith(prefix)) continue;
    out.set(folder === 'block' ? name : name.slice(prefix.length), data);
  }
  return out;
}

// --- banco -----------------------------------------------------------------

/** O pack instalado, ou `null`. Nunca lança: sem pack o jogo entra igual. */
export async function loadPack(db: SaveDatabase | null): Promise<ResourcePack | null> {
  if (db === null) return null;
  try {
    const stored = await db.get<ResourcePack>(STORE_SETTINGS, PACK_KEY);
    if (stored === undefined || !(stored.textures instanceof Map)) return null;
    return stored;
  } catch {
    return null;
  }
}

export async function savePack(db: SaveDatabase, pack: ResourcePack): Promise<void> {
  await db.put(STORE_SETTINGS, pack, PACK_KEY);
}

export async function clearPack(db: SaveDatabase): Promise<void> {
  await db.delete(STORE_SETTINGS, PACK_KEY);
}

// --- decodificação (única parte que toca o DOM) -----------------------------

/**
 * PNG → RGBA usando o decodificador do próprio navegador.
 *
 * Escrever um decodificador de PNG seria 300 linhas de bundle para repetir o
 * que todo navegador já faz. `createImageBitmap` é o caminho rápido; o `Image`
 * com URL de blob é o que funciona no WebView antigo, que é o alvo.
 */
export async function decodeImage(bytes: Uint8Array): Promise<PackImage> {
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
  const source = await toDrawable(blob);
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) throw new PackError('Sem canvas 2D para ler as imagens.');
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();
  return { width: image.width, height: image.height, data: image.data };
}

type Drawable = ImageBitmap | HTMLImageElement;

function toDrawable(blob: Blob): Promise<Drawable> {
  const global = globalThis as { createImageBitmap?: (b: Blob) => Promise<ImageBitmap> };
  if (global.createImageBitmap !== undefined) return global.createImageBitmap(blob);

  return new Promise<Drawable>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new PackError('PNG inválido.')); };
    img.src = url;
  });
}
