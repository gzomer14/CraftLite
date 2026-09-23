/**
 * Arte dos sprites de item (doc 13 §2.4).
 *
 * Cada silhueta é uma máscara de 16×16 escrita como texto — é o formato mais
 * legível para pixel art e o que melhor comprime. Os caracteres são **papéis**,
 * não cores: a mesma máscara de picareta serve os cinco materiais, e a mesma de
 * pepita serve carvão, pólvora e redstone. É isso que faz 26 desenhos cobrirem
 * ~120 itens (o doc pede exatamente essa economia).
 *
 * Papéis:
 * ```
 *   .  transparente      m  cor principal     M  clara (×1.30)
 *   d  escura (×0.68)    a  cor de acento     A  acento claro (×1.25)
 *   x  contorno (quase preto)
 * ```
 *
 * Itens que são blocos **não** aparecem aqui: eles são renderizados em
 * isométrica a partir das próprias texturas, no boot (ver `render/itemsprites.ts`).
 */

import { DYES } from './dyes';
import type { Rgb } from '../render/texgen';

export interface ItemArt {
  /** Nome da silhueta em `SHAPES`. */
  shape: string;
  /** Cor principal. */
  color: Rgb;
  /** Cor do acento (cabo de ferramenta, detalhe). */
  accent?: Rgb;
  /**
   * Mostrador que gira (M10): a folha ganha `DIAL_FRAMES` quadros do item, com
   * a agulha (bússola) ou o disco do céu (relógio) desenhados por cima da
   * silhueta em cada ângulo. Quem escolhe o quadro é `ui/dials.ts`.
   */
  dial?: DialKind;
}

export type DialKind = 'needle' | 'sky';

/** Quadros de um mostrador: 22,5° cada. */
export const DIAL_FRAMES = 16;

/** Máscaras. Toda linha tem exatamente 16 caracteres — há teste para isso. */
export const SHAPES: Record<string, readonly string[]> = {
  // --- mostradores (M10): caixa redonda em `m`, face em `a` ------------------
  // A agulha e o disco não estão aqui: mudam por quadro, e quem os desenha é
  // `render/itemsprites.ts`. O centro da face é (7,5; 7,5), com raio ~5.
  dial: [
    '................',
    '.....xxxxxx.....',
    '...xxMMMMMMxx...',
    '..xMMaaaaaaMMx..',
    '..xMaaaaaaaaMx..',
    '.xMaaaaaaaaaaMx.',
    '.xMaaaaaaaaaaMx.',
    '.xmaaaaaaaaaamx.',
    '.xmaaaaaaaaaamx.',
    '.xmaaaaaaaaaamx.',
    '.xmaaaaaaaaaamx.',
    '..xmaaaaaaaamx..',
    '..xdmaaaaaamdx..',
    '...xxddddddxx...',
    '.....xxxxxx.....',
    '................',
  ],
  // Mapa: papel dobrado com um traço de terra e água.
  map: [
    '................',
    '................',
    '..xxxxxxxxxxxx..',
    '..xMMMMMMMMMMx..',
    '..xMmmaamMMmMx..',
    '..xMmaaamMmmMx..',
    '..xMmaamMMmmMx..',
    '..xMMmMMaaMMMx..',
    '..xMmmMaaamMMx..',
    '..xMmmmaaAmmMx..',
    '..xMMmmMaAMmMx..',
    '..xMmMMMMaaMMx..',
    '..xMMMMMMMMMdx..',
    '..xxxxxxxxxxxx..',
    '................',
    '................',
  ],
  // --- ferramentas: cabo em `a`, cabeça em `m` ---------------------------
  pickaxe: [
    '................',
    '....MMMMMMM.....',
    '...MdmmmmmdM....',
    '...Md..a..dM....',
    '....M.aA..M.....',
    '......aA........',
    '.....aA.........',
    '.....aA.........',
    '....aA..........',
    '....aA..........',
    '...aA...........',
    '...aA...........',
    '..aA............',
    '..aa............',
    '................',
    '................',
  ],
  axe: [
    '................',
    '.....MMMM.......',
    '....MmmmdM......',
    '....MmmmmdM.....',
    '....Mmmmmd......',
    '....MmmmM.......',
    '.....aA.........',
    '.....aA.........',
    '....aA..........',
    '....aA..........',
    '...aA...........',
    '...aA...........',
    '..aA............',
    '..aa............',
    '................',
    '................',
  ],
  shovel: [
    '................',
    '......MMM.......',
    '.....MmmmM......',
    '.....Mmmmd......',
    '.....MmmmM......',
    '......MdM.......',
    '......aA........',
    '.....aA.........',
    '.....aA.........',
    '....aA..........',
    '....aA..........',
    '...aA...........',
    '..aA............',
    '..aa............',
    '................',
    '................',
  ],
  // --- arco, escudo e barco (M6) -----------------------------------------
  bow: [
    '................',
    '..........dmM...',
    '.........m..aM..',
    '........m...aM..',
    '.......m....aM..',
    '......m.....aM..',
    '.....m.a....aM..',
    '....m..aA...aM..',
    '...m....aA..aM..',
    '..m......aA.aM..',
    '..m.......aAaM..',
    '..m........aaM..',
    '...m........M...',
    '....dmM.....M...',
    '................',
    '................',
  ],
  shield: [
    '................',
    '...MMMMMMMMMM...',
    '..MmmmmmmmmmmM..',
    '..MmaaaaaaaamM..',
    '..MmaAAAAAAamM..',
    '..MmaAmmmmAamM..',
    '..MmaAmMMmAamM..',
    '..MmaAmMMmAamM..',
    '..MmaAmmmmAamM..',
    '..MmaAAAAAAamM..',
    '..MmaaaaaaaamM..',
    '...MmmmmmmmmM...',
    '....MmmmmmmM....',
    '.....MmmmmM.....',
    '......MmmM......',
    '.......MM.......',
  ],
  boat: [
    '................',
    '................',
    '................',
    '..M...........M.',
    '..Md.........dM.',
    '..Mdm.......mdM.',
    '..Mdmm.....mmdM.',
    '..Mdmmm...mmmdM.',
    '..Mdmmmm.mmmmdM.',
    '..MdmmmmmmmmmdM.',
    '...MdmmmmmmmdM..',
    '....MdddddddM...',
    '.....MMMMMMM....',
    '................',
    '................',
    '................',
  ],
  hoe: [
    '................',
    '....MMMMM.......',
    '...MmmmmdM......',
    '...MdddddM......',
    '....M..aA.......',
    '.......aA.......',
    '......aA........',
    '......aA........',
    '.....aA.........',
    '.....aA.........',
    '....aA..........',
    '....aA..........',
    '...aA...........',
    '...aa...........',
    '................',
    '................',
  ],
  sword: [
    '................',
    '............MM..',
    '...........MmM..',
    '..........MmmM..',
    '.........MmmM...',
    '........MmmM....',
    '.......MmmM.....',
    '......MmmM......',
    '.....MmmM.......',
    '....aMmM........',
    '...aAdM.........',
    '..aaA...........',
    '..aA............',
    '.aa.............',
    '................',
    '................',
  ],

  // --- armadura -----------------------------------------------------------
  helmet: [
    '................',
    '................',
    '....MMMMMM......',
    '...MmmmmmmM.....',
    '..Mmmmmmmmmd....',
    '..Mmd....dmd....',
    '..Mmd....dmd....',
    '..Mmmmmmmmmd....',
    '..MmmMMMMmmd....',
    '...dmd..dmd.....',
    '....dd..dd......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  chestplate: [
    '................',
    '..MM......MM....',
    '.MmmM....MmmM...',
    '.Mmmmmmmmmmmd...',
    '.Mmmmmmmmmmmd...',
    '.MmmmmmmmmmmM...',
    '..dmmmmmmmmd....',
    '..dmmmmmmmmd....',
    '..dmmmmmmmmd....',
    '..dmmmmmmmmd....',
    '...dmmmmmmd.....',
    '...dmmmmmmd.....',
    '....dddddd......',
    '................',
    '................',
    '................',
  ],
  leggings: [
    '................',
    '................',
    '..MmmmmmmmmM....',
    '..Mmmmmmmmmd....',
    '..Mmmmmmmmmd....',
    '..MmmmMMmmmd....',
    '..Mmmd..dmmd....',
    '..Mmmd..dmmd....',
    '..Mmmd..dmmd....',
    '..Mmmd..dmmd....',
    '..dmmd..dmmd....',
    '..dmmd..dmmd....',
    '..ddd....ddd....',
    '................',
    '................',
    '................',
  ],
  boots: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..MmM....MmM....',
    '..Mmd....dmd....',
    '..Mmd....dmd....',
    '..Mmd....dmd....',
    '.Mmmmd..Mmmmd...',
    '.Mmmmmd.Mmmmmd..',
    '.dmmmmd.dmmmmd..',
    '..dddd...dddd...',
    '................',
    '................',
    '................',
  ],

  // --- materiais ----------------------------------------------------------
  ingot: [
    '................',
    '................',
    '................',
    '................',
    '.....MMMMM......',
    '....MmmmmmM.....',
    '...MmmmmmmmM....',
    '..MmmmmmmmmmM...',
    '..dmmmmmmmmmd...',
    '...ddmmmmmdd....',
    '....dddddddd....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  gem: [
    '................',
    '................',
    '.....MMMM.......',
    '....MmmmmM......',
    '...MmmmmmmM.....',
    '..MmmmmmmmmM....',
    '..dmmmmmmmmd....',
    '...dmmmmmmd.....',
    '....dmmmmd......',
    '.....dmmd.......',
    '......dd........',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  chunk: [
    '................',
    '................',
    '.......MM.......',
    '......MmmM......',
    '.....MmmmmM.....',
    '....MmmmmmmM....',
    '....dmmmmmmd....',
    '...MmmmmmmmmM...',
    '...dmmmmmmmmd...',
    '....dmmmmmmd....',
    '.....ddmmdd.....',
    '.......dd.......',
    '................',
    '................',
    '................',
    '................',
  ],
  dust: [
    '................',
    '................',
    '................',
    '.......M........',
    '....M..m...M....',
    '.....m..M..m....',
    '...M..M...m.....',
    '....m...m..M....',
    '..M..m..M..m....',
    '...m..M..m......',
    '....M..m..M.....',
    '.....m..M.......',
    '................',
    '................',
    '................',
    '................',
  ],
  rod: [
    '................',
    '................',
    '..........MM....',
    '.........Mmd....',
    '........Mmd.....',
    '.......Mmd......',
    '......Mmd.......',
    '.....Mmd........',
    '....Mmd.........',
    '...Mmd..........',
    '..Mmd...........',
    '..md............',
    '..dd............',
    '................',
    '................',
    '................',
  ],
  bone: [
    '................',
    '................',
    '.........MM.M...',
    '........MmmMm...',
    '.........Mmmd...',
    '.......Mmmmd....',
    '......Mmmd......',
    '.....Mmmd.......',
    '....Mmmd........',
    '...Mmmd.........',
    '..Mmmd..........',
    '..MmmMd.........',
    '..mMmmd.........',
    '...dd...........',
    '................',
    '................',
  ],
  arrow: [
    '................',
    '.............MM.',
    '............Mmd.',
    '...........Mmd..',
    '..........Mmd...',
    '.........Mmd....',
    '........Mmd.....',
    '.......Mmd......',
    '......Mmd.......',
    '....aAmd........',
    '...aAaA.........',
    '..aAaA..........',
    '..aaA...........',
    '...a............',
    '................',
    '................',
  ],
  round: [
    '................',
    '................',
    '................',
    '.....MMMM.......',
    '....MmmmmM......',
    '...MmmmmmmM.....',
    '...MmmmmmmM.....',
    '...dmmmmmmd.....',
    '...dmmmmmmd.....',
    '....dmmmmd......',
    '.....dddd.......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  apple: [
    '................',
    '................',
    '.......aA.......',
    '......aA........',
    '....MMMMM.......',
    '...MmmmmmmM.....',
    '..MmmmmmmmmM....',
    '..MmmmmmmmmM....',
    '..dmmmmmmmmd....',
    '..dmmmmmmmmd....',
    '...dmmmmmmd.....',
    '....ddmmdd......',
    '................',
    '................',
    '................',
    '................',
  ],
  meat: [
    '................',
    '................',
    '................',
    '.....MMMM.......',
    '...MmmmmmmM.....',
    '..MmmmmmmmmM....',
    '..MmmdddmmmM....',
    '..Mmmdddmmmd....',
    '..dmmmmmmmmd....',
    '...dmmmmmmd.....',
    '....dmmmmd......',
    '.....dddd.......',
    '................',
    '................',
    '................',
    '................',
  ],
  bread: [
    '................',
    '................',
    '................',
    '....MMMMMM......',
    '...MmmmmmmmM....',
    '..MmmMmmMmmmM...',
    '..MmmmmmmmmmM...',
    '..dmmMmmMmmmd...',
    '..dmmmmmmmmmd...',
    '...ddmmmmmdd....',
    '.....dddddd.....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  sheet: [
    '................',
    '................',
    '...MMMMMMMM.....',
    '...MmmmmmmmM....',
    '...MmddddmmM....',
    '...MmmmmmmmM....',
    '...MmddddmmM....',
    '...MmmmmmmmM....',
    '...MmddddmmM....',
    '...MmmmmmmmM....',
    '...dmmmmmmmd....',
    '....dddddddd....',
    '................',
    '................',
    '................',
    '................',
  ],
  wheat: [
    '................',
    '.......M........',
    '......MmM.......',
    '.....Mmmm.......',
    '....M.MmM.......',
    '...MmM.m.M......',
    '....m.MmM.m.....',
    '...MmM.m.MmM....',
    '....m.MmM.m.....',
    '...MmM.m.MmM....',
    '....m.MmM.m.....',
    '.......m........',
    '.......m........',
    '................',
    '................',
    '................',
  ],
  seeds: [
    '................',
    '................',
    '................',
    '................',
    '.....Mm.........',
    '....mMd..Mm.....',
    '.....dd..mMd....',
    '..........dd....',
    '....Mm..........',
    '...mMd...Mm.....',
    '....dd...mMd....',
    '..........dd....',
    '................',
    '................',
    '................',
    '................',
  ],
  carrot: [
    '................',
    '.........aA.....',
    '......a.aA......',
    '.......aAa......',
    '......MMaA......',
    '.....MmmM.......',
    '.....Mmmd.......',
    '....MmmM........',
    '....Mmmd........',
    '.....MmM........',
    '.....Mmd........',
    '......Md........',
    '......d.........',
    '................',
    '................',
    '................',
  ],
  potato: [
    '................',
    '................',
    '.....MMMMM......',
    '...MMmmmmmMd....',
    '..MmmmdmmmmdM...',
    '..Mmmmmmdmmmd...',
    '..MmdmmmmmmmM...',
    '..Mmmmmmdmmmd...',
    '...MmmdmmmmM....',
    '....MmmmmmM.....',
    '.....dMMMd......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  feather: [
    '................',
    '...........MM...',
    '..........MmmM..',
    '.........Mmmmd..',
    '........MmmmMd..',
    '.......Mmmmmd...',
    '......MmmmmMd...',
    '.....Mmmmmmd....',
    '....Mmmmmmd.....',
    '...MmmmmMd......',
    '...dmmmmd.......',
    '..aAmmd.........',
    '..aAdd..........',
    '..aa............',
    '................',
    '................',
  ],
  hide: [
    '................',
    '................',
    '..MM......MM....',
    '..MmMMMMMMmM....',
    '..MmmmmmmmmM....',
    '..MmmmmmmmmM....',
    '..MmmmmmmmmM....',
    '..dmmmmmmmmd....',
    '..dmmmmmmmmd....',
    '..dmmmmmmmmd....',
    '..ddM....Mdd....',
    '....d....d......',
    '................',
    '................',
    '................',
    '................',
  ],
  bowl: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..MMMMMMMMMM....',
    '..MmmmmmmmmM....',
    '...dmmmmmmd.....',
    '...dmmmmmmd.....',
    '....dmmmmd......',
    '.....dddd.......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  bucket: [
    '................',
    '................',
    '................',
    '...M......M.....',
    '...M......M.....',
    '..MMMMMMMMMM....',
    '..MmmmmmmmmM....',
    '..MmmmmmmmmM....',
    '..dmmmmmmmmd....',
    '...dmmmmmmd.....',
    '...dmmmmmmd.....',
    '....dddddd......',
    '................',
    '................',
    '................',
    '................',
  ],
  /*
   * Itens de 2026-09-22. O balde cheio é o balde com a boca preenchida no
   * acento — água, lava e leite são a mesma máscara em três cores —, e o
   * ensopado é a tigela com o caldo no acento.
   */
  filled_bucket: [
    '................',
    '................',
    '................',
    '...M......M.....',
    '...M......M.....',
    '..MMMMMMMMMM....',
    '..MaAaaAaaaM....',
    '..MmmmmmmmmM....',
    '..dmmmmmmmmd....',
    '...dmmmmmmd.....',
    '...dmmmmmmd.....',
    '....dddddd......',
    '................',
    '................',
    '................',
    '................',
  ],
  stew: [
    '................',
    '................',
    '................',
    '................',
    '....aAa.Aa......',
    '..MaaAaaaaaM....',
    '..MmmmmmmmmM....',
    '...dmmmmmmd.....',
    '...dmmmmmmd.....',
    '....dmmmmd......',
    '.....dddd.......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  egg: [
    '................',
    '................',
    '................',
    '.......MM.......',
    '......MmmM......',
    '.....MmmmmM.....',
    '.....MmmmmM.....',
    '....MmmmmmmM....',
    '....Mmmmmmmd....',
    '....mmmmmmmd....',
    '....dmmmmmmd....',
    '.....dmmmmd.....',
    '......dddd......',
    '................',
    '................',
    '................',
  ],
  shears: [
    '................',
    '................',
    '..........M.....',
    '.........Mm.....',
    '........Mmd.....',
    '.......Mmd..M...',
    '......Mmd..Mm...',
    '.....aMd..Mmd...',
    '....aAa..Mmd....',
    '...aA.Aa.md.....',
    '...a...aa.......',
    '...aA.Aa........',
    '....aAa.........',
    '................',
    '................',
    '................',
  ],
  /*
   * Tocha, porta e cama (M8).
   *
   * Os três colocam bloco, então caíam no cubo isométrico de
   * `render/itemsprites.ts` — e cubo é exatamente o que eles não são: a tocha
   * virava um tijolo aceso, a porta um caixote e a cama um cubo de lã. Com
   * silhueta própria, o slot mostra o objeto, e a mão desenha o mesmo desenho
   * extrudado (`render/itemmodel.ts`).
   */
  torch: [
    '................',
    '................',
    '.......AA.......',
    '......AAAA......',
    '......AaaA......',
    '.......aa.......',
    '.......MM.......',
    '.......mm.......',
    '.......mm.......',
    '.......mm.......',
    '.......mm.......',
    '.......mm.......',
    '.......md.......',
    '.......dd.......',
    '................',
    '................',
  ],
  door: [
    '................',
    '....MMMMMMMM....',
    '....MmmmmmmM....',
    '....MmddddmM....',
    '....MmddddmM....',
    '....MmddddmM....',
    '....Mmmmmm.M....',
    '....MmmmmmAM....',
    '....Mmmmmm.M....',
    '....MmddddmM....',
    '....MmddddmM....',
    '....MmddddmM....',
    '....MmmmmmmM....',
    '....dddddddd....',
    '................',
    '................',
  ],
  bed: [
    '................',
    '................',
    '................',
    '..AAAAAAAA......',
    '..AAAAAAAAMMM...',
    '..MMMMMMMMMMMM..',
    '.MmmmmmmmmmmmM..',
    '.MmmmmmmmmmmmM..',
    '.dddddddddddddM.',
    '.a...........a..',
    '.a...........a..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  /*
   * Escada de mão (M8): com a textura virando madeira lisa, o cubo isométrico
   * do slot ficaria idêntico a um bloco de tábua. A silhueta devolve os
   * degraus, que é o que identifica a peça.
   */
  ladder: [
    '................',
    '..M..........M..',
    '..M..........M..',
    '..MMMMMMMMMMMM..',
    '..MdddddddddM...',
    '..M..........M..',
    '..M..........M..',
    '..MMMMMMMMMMMM..',
    '..MdddddddddM...',
    '..M..........M..',
    '..M..........M..',
    '..MMMMMMMMMMMM..',
    '..MdddddddddM...',
    '..d..........d..',
    '..d..........d..',
    '................',
  ],
  string: [
    '................',
    '................',
    '.....MM.........',
    '....Mmm.........',
    '....Mm..........',
    '.....Mm.........',
    '......Mm........',
    '.......Mm.......',
    '........Mm......',
    '.........Mm.....',
    '.........Mm.....',
    '........Mm......',
    '.......Mmd......',
    '.......dd.......',
    '................',
    '................',
  ],
  eye: [
    '................',
    '................',
    '................',
    '.....MMMM.......',
    '....MmmmmM......',
    '...MmxxxmmM.....',
    '...MmxAxmmM.....',
    '...dmxxxmmd.....',
    '...dmmmmmmd.....',
    '....dmmmmd......',
    '.....dddd.......',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
};

// --- paleta -----------------------------------------------------------------

const WOOD: Rgb = [140, 106, 62];
const IRON: Rgb = [216, 216, 216];
const GOLD: Rgb = [238, 200, 78];
const DIAMOND: Rgb = [92, 220, 214];
const STONE: Rgb = [128, 128, 128];
const LEATHER: Rgb = [160, 106, 62];
const BONE: Rgb = [232, 230, 214];

/** Cor por material de ferramenta e de armadura. */
const MATERIAL_COLOR: Record<string, Rgb> = {
  wooden: WOOD,
  golden: GOLD,
  stone: STONE,
  iron: IRON,
  diamond: DIAMOND,
  leather: LEATHER,
};

const TOOL_KINDS = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];

/** Itens simples: silhueta + cor. */
const SIMPLE: Record<string, [string, Rgb]> = {
  coal: ['chunk', [42, 42, 46]],
  charcoal: ['chunk', [58, 50, 44]],
  raw_iron: ['chunk', [198, 158, 130]],
  iron_ingot: ['ingot', IRON],
  raw_copper: ['chunk', [196, 118, 78]],
  copper_ingot: ['ingot', [214, 132, 90]],
  raw_gold: ['chunk', [226, 190, 96]],
  gold_ingot: ['ingot', GOLD],
  diamond: ['gem', DIAMOND],
  emerald: ['gem', [64, 208, 104]],
  redstone: ['dust', [214, 44, 44]],
  lapis_lazuli: ['gem', [54, 92, 186]],
  flint: ['chunk', [62, 58, 62]],
  // Nether (M7): o quartzo é gema branca, o tijolo é lingote vermelho-escuro.
  nether_quartz: ['gem', [236, 230, 220]],
  nether_brick: ['ingot', [86, 42, 48]],
  clay_ball: ['round', [166, 172, 184]],
  brick: ['ingot', [174, 92, 72]],
  glowstone_dust: ['dust', [248, 216, 128]],
  snowball: ['round', [238, 246, 250]],

  stick: ['rod', WOOD],
  bowl: ['bowl', WOOD],
  bucket: ['bucket', [188, 188, 196]],
  paper: ['sheet', [238, 238, 232]],
  book: ['sheet', [148, 84, 60]],
  wheat: ['wheat', [216, 186, 86]],
  wheat_seeds: ['seeds', [140, 176, 78]],
  carrot: ['carrot', [232, 132, 44]],
  potato: ['potato', [200, 168, 96]],
  baked_potato: ['potato', [226, 190, 112]],
  string: ['string', [232, 232, 232]],
  feather: ['feather', [244, 244, 244]],
  leather: ['hide', LEATHER],
  gunpowder: ['dust', [128, 128, 128]],

  bone: ['bone', BONE],
  arrow: ['arrow', [206, 204, 198]],
  slime_ball: ['round', [124, 202, 124]],
  ink_sac: ['round', [36, 40, 52]],
  spider_eye: ['eye', [138, 44, 44]],
  ender_pearl: ['round', [46, 152, 136]],

  apple: ['apple', [214, 56, 48]],
  bread: ['bread', [196, 146, 78]],
  beef: ['meat', [200, 92, 88]],
  cooked_beef: ['meat', [136, 84, 48]],
  porkchop: ['meat', [224, 148, 148]],
  cooked_porkchop: ['meat', [188, 128, 72]],
  chicken: ['meat', [226, 178, 148]],
  cooked_chicken: ['meat', [190, 142, 82]],
  mutton: ['meat', [214, 110, 102]],
  cooked_mutton: ['meat', [158, 100, 58]],
  melon_slice: ['round', [200, 60, 62]],
  rotten_flesh: ['meat', [124, 100, 68]],

  boat: ['boat', WOOD],

  // 2026-09-22 (M11).
  golden_apple: ['apple', GOLD],
  cookie: ['round', [196, 140, 80]],
  sugar: ['dust', [244, 244, 240]],
  egg: ['egg', [236, 220, 184]],
};

/** Arte por nome de item, montada uma vez no boot. */
export const ITEM_ART: Record<string, ItemArt> = buildArt();

function buildArt(): Record<string, ItemArt> {
  const out: Record<string, ItemArt> = {};

  for (const material of Object.keys(MATERIAL_COLOR)) {
    const color = MATERIAL_COLOR[material];
    // Ferramenta: cabeça do material, cabo de madeira (o acento).
    for (const kind of TOOL_KINDS) {
      out[`${material}_${kind}`] = { shape: kind, color, accent: WOOD };
    }
    for (const piece of ARMOR_PIECES) {
      out[`${material}_${piece}`] = { shape: piece, color };
    }
  }

  for (const name of Object.keys(SIMPLE)) {
    const [shape, color] = SIMPLE[name];
    out[name] = { shape, color, ...(shape === 'arrow' ? { accent: [214, 214, 214] } : {}) };
  }

  // Arco e escudo têm acento próprio: a corda e o brasão (M6).
  out.bow = { shape: 'bow', color: WOOD, accent: [236, 236, 230] };
  out.shield = { shape: 'shield', color: WOOD, accent: [176, 60, 56] };
  // Carrinho (M7): a tigela vira caçamba, o acento é a ferragem.
  out.minecart = { shape: 'bowl', color: [142, 142, 150], accent: [92, 92, 100] };
  // Isqueiro (M7): a silhueta da barra de ferro com a pederneira de acento.
  out.flint_and_steel = { shape: 'ingot', color: [188, 188, 196], accent: [62, 58, 62] };
  // Blocos com forma própria (M8): ver o comentário das silhuetas acima.
  out.torch = { shape: 'torch', color: WOOD, accent: [255, 196, 88] };
  out.redstone_torch = { shape: 'torch', color: WOOD, accent: [226, 58, 44] };
  out.oak_door = { shape: 'door', color: [150, 118, 68], accent: [214, 214, 220] };
  out.bed = { shape: 'bed', color: [196, 52, 52], accent: [238, 238, 232] };
  out.ladder = { shape: 'ladder', color: [146, 116, 68] };
  // Baldes cheios e ensopado (2026-09-22): a cor do conteúdo vai no acento.
  const bucket: Rgb = [188, 188, 196];
  out.water_bucket = { shape: 'filled_bucket', color: bucket, accent: [52, 96, 214] };
  out.lava_bucket = { shape: 'filled_bucket', color: bucket, accent: [230, 110, 30] };
  out.milk_bucket = { shape: 'filled_bucket', color: bucket, accent: [244, 244, 240] };
  out.mushroom_stew = { shape: 'stew', color: WOOD, accent: [168, 112, 70] };
  out.shears = { shape: 'shears', color: [214, 214, 220], accent: [160, 60, 50] };
  // M10: a bússola em ferro com face clara, o relógio em ouro com o disco do
  // céu; o mapa em papel, com a terra no principal e a água no acento.
  out.compass = { shape: 'dial', color: [168, 168, 176], accent: [226, 222, 208], dial: 'needle' };
  out.clock = { shape: 'dial', color: [232, 190, 60], accent: [96, 150, 220], dial: 'sky' };
  out.map = { shape: 'map', color: [226, 214, 176], accent: [70, 120, 196] };
  /*
   * Corante e cama coloridos (M8). São a mesma silhueta em oito cores — o
   * caso que este módulo existe para resolver: o desenho é o papel, a cor é o
   * dado. A cama vermelha é `bed` por motivo de id (ver `data/blocks.ts`).
   */
  for (const dye of DYES) {
    out[`${dye.name}_dye`] = { shape: 'dust', color: dye.wool };
    const bed = dye.name === 'red' ? 'bed' : `bed_${dye.name}`;
    out[bed] = { shape: 'bed', color: dye.quilt, accent: [238, 238, 232] };
  }
  return out;
}
