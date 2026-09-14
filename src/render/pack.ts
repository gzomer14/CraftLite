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
 * - `sound/<som>` — **amostra** no lugar da síntese (`audio/synth.ts`).
 *
 * O som é o único que não é imagem, e por isso segue outro caminho: o jogo
 * gera onda, não toca amostra (doc 10 §1), então o arquivo do jogador não
 * substitui uma receita — ele **desvia** dela. Quem decodifica é o
 * `AudioContext` do navegador, no mesmo lugar em que as receitas são
 * renderizadas, e o resto do motor não sabe a diferença: o que sai dos dois
 * caminhos é um `AudioBuffer`.
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

import { SOUNDS as SOUND_RECIPES } from '../audio/synth';
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
/**
 * Teto de bytes de som no pacote.
 *
 * Som é o único item do pack que entra **como veio**, sem reamostragem: uma
 * pasta de `.ogg` de música encheria a cota do doc 11 §4 sozinha. Dois
 * megabytes cobrem dezenas de efeitos curtos, que é o que a convenção pede.
 */
const MAX_SOUND_BYTES = 2 * 1024 * 1024;
/** Extensões de áudio aceitas. O decodificador é o do navegador. */
const SOUND_EXTENSIONS = ['.ogg', '.mp3', '.wav', '.m4a'];

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
  /**
   * Nome do som → bytes do arquivo, como vieram do `.zip`.
   *
   * Opcional: pacote guardado antes de o som existir volta do banco sem o
   * campo, e continua valendo — sem migração, como o resto do save.
   */
  sounds?: Map<string, Uint8Array>;
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
  const sounds = new Map<string, Uint8Array>();
  const ignored: string[] = [];
  let soundBytes = 0;

  for (const [path, data] of files) {
    const canonical = canonicalName(path);
    if (canonical === null) {
      if (isCandidate(path)) ignored.push(path);
      continue;
    }

    if (canonical.startsWith('sound/')) {
      if (!SOUNDS_BY_NAME.has(canonical.slice(6))) {
        ignored.push(path);
        continue;
      }
      soundBytes += data.length;
      if (soundBytes > MAX_SOUND_BYTES) {
        throw new PackError(
          `Pack com som demais: mais de ${Math.round(MAX_SOUND_BYTES / 1024)} KB de áudio.`,
        );
      }
      sounds.set(canonical.slice(6), data);
      continue;
    }

    const size = targetSizeOf(canonical);
    if (size === 0) {
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

  if (textures.size === 0 && sounds.size === 0) {
    throw new PackError('Nada reconhecido no arquivo. Veja a convenção de nomes.');
  }
  return { pack: { name, importedAt: Date.now(), textures, sounds }, ignored };
}

/** true se o caminho **parecia** ser conteúdo de pack, para entrar no relatório. */
function isCandidate(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.png') || SOUND_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * `assets/x/textures/block/stone.png` → `block/stone`.
 * `null` quando o caminho não tem os dois segmentos de que precisamos.
 */
export function canonicalName(path: string): string | null {
  const clean = path.replace(/^\/+/, '').replace(/\.(png|ogg|mp3|wav|m4a)$/i, '');
  const parts = clean.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.length < 2) return null;
  const folder = parts[parts.length - 2].toLowerCase();
  const file = parts[parts.length - 1];
  const lower = path.toLowerCase();

  /*
   * O som tem **dois** segmentos de nome (`mob/zombie_ambient`), não um: a
   * tabela de `audio/synth.ts` é indexada assim. Por isso ele não cabe na
   * regra dos "dois últimos segmentos" das imagens e é tratado antes dela.
   */
  if (SOUND_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    const at = parts.indexOf('sound');
    if (at < 0 || at + 2 > parts.length - 1) return null;
    return `sound/${parts.slice(at + 1).join('/')}`;
  }

  if (!lower.endsWith('.png')) return null;
  if (folder !== 'block' && folder !== 'item' && folder !== 'entity') return null;
  return `${folder}/${file}`;
}

/** Nomes de som que o jogo conhece. Nome fora daqui não tem onde tocar. */
const SOUNDS_BY_NAME = new Set(Object.keys(SOUND_RECIPES));

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
/**
 * Amostras que substituem a síntese, por nome de som.
 *
 * Vazio quando não há pack ou quando ele só traz imagem — e é o caso normal,
 * então o motor de áudio não paga nada por esta possibilidade existir.
 */
export function soundOverridesFor(pack: ResourcePack | null): ReadonlyMap<string, Uint8Array> {
  return pack?.sounds ?? new Map<string, Uint8Array>();
}

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
