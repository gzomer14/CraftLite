/**
 * O motor de textura precisa ser determinístico: as texturas são "assets" e
 * têm que sair iguais em qualquer máquina e sessão.
 */
import { describe, expect, it } from 'vitest';
import {
  TEX_SIZE, alphaMask, bricks, dither, oreBlobs, renderRecipe, speckle, tintBy,
} from '../src/render/texgen';
import { TEXTURES } from '../src/data/textures';
import { BLOCKS, BLOCK_BY_NAME, texOf } from '../src/data/blocks';
import { LAYER_CUTOUT, LAYER_OPAQUE, buildBlockTables } from '../src/world/mesh/blockinfo';
import { buildLayerIndex } from '../src/render/layers';

const SIZE = TEX_SIZE * TEX_SIZE * 4;
const noResolve = (): Uint8ClampedArray => new Uint8ClampedArray(SIZE);

describe('renderRecipe', () => {
  it('devolve um buffer RGBA de 16×16', () => {
    const out = renderRecipe({ base: [10, 20, 30], noise: 'flat' }, 1, noResolve);
    expect(out.length).toBe(SIZE);
  });

  it('é determinístico para a mesma seed', () => {
    const recipe = { base: [125, 125, 125] as const, noise: 'value' as const, scale: 4, variance: 0.2 };
    const a = renderRecipe(recipe, 777, noResolve);
    const b = renderRecipe(recipe, 777, noResolve);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('seeds diferentes geram texturas diferentes', () => {
    const recipe = { base: [125, 125, 125] as const, noise: 'value' as const, scale: 4, variance: 0.3 };
    const a = renderRecipe(recipe, 1, noResolve);
    const b = renderRecipe(recipe, 2, noResolve);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('noise flat com variance 0 dá cor sólida', () => {
    const out = renderRecipe({ base: [40, 80, 120], noise: 'flat', variance: 0 }, 5, noResolve);
    for (let i = 0; i < SIZE; i += 4) {
      expect(out[i]).toBe(40);
      expect(out[i + 1]).toBe(80);
      expect(out[i + 2]).toBe(120);
      expect(out[i + 3]).toBe(255);
    }
  });

  it('alpha da receita chega no canal A', () => {
    const out = renderRecipe({ base: [1, 2, 3], noise: 'flat', alpha: 0.5 }, 5, noResolve);
    expect(out[3]).toBe(128);
  });

  it('inherit copia a textura de origem antes das ops', () => {
    const base = new Uint8ClampedArray(SIZE).fill(200);
    const out = renderRecipe({ inherit: 'x' }, 5, () => base);
    expect(out[0]).toBe(200);
    // e não é o mesmo buffer — mutar o resultado não pode sujar o cache
    out[0] = 1;
    expect(base[0]).toBe(200);
  });
});

describe('operadores', () => {
  const solid = (v: number): { data: Uint8ClampedArray; seed: number } => ({
    data: new Uint8ClampedArray(SIZE).fill(v),
    seed: 42,
  });

  it('tintBy escurece proporcionalmente', () => {
    const c = solid(200);
    tintBy(0.5)(c);
    expect(c.data[0]).toBe(100);
  });

  it('alphaMask "frame" deixa só a borda opaca', () => {
    const c = solid(255);
    alphaMask('frame')(c);
    const at = (x: number, y: number): number => c.data[((y * TEX_SIZE + x) << 2) + 3];
    expect(at(0, 0)).toBe(255);
    expect(at(15, 15)).toBe(255);
    expect(at(8, 8)).toBe(0);
  });

  it('speckle muda alguns pixels e preserva outros', () => {
    const c = solid(120);
    speckle([0, 0, 0], 0.2, 1)(c);
    let changed = 0;
    for (let i = 0; i < SIZE; i += 4) if (c.data[i] !== 120) changed++;
    expect(changed).toBeGreaterThan(10);
    expect(changed).toBeLessThan(TEX_SIZE * TEX_SIZE);
  });

  it('bricks desenha as linhas de argamassa', () => {
    const c = solid(180);
    bricks(8, 8, [10, 10, 10])(c);
    expect(c.data[0]).toBe(10); // y=0 é linha de argamassa
  });

  it('oreBlobs cria pixels claros e um contorno escuro', () => {
    const c = solid(125);
    oreBlobs([94, 225, 224], 5)(c);
    let bright = 0;
    let dark = 0;
    for (let i = 0; i < SIZE; i += 4) {
      if (c.data[i + 2] > 180) bright++;
      if (c.data[i + 2] < 120) dark++;
    }
    expect(bright).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(0);
  });

  it('dither não estoura o intervalo de bytes', () => {
    const c = solid(250);
    dither(0.5)(c);
    for (let i = 0; i < SIZE; i++) {
      expect(c.data[i]).toBeGreaterThanOrEqual(0);
      expect(c.data[i]).toBeLessThanOrEqual(255);
    }
  });
});

describe('tabela de texturas', () => {
  it('toda receita renderiza sem erro e gera pixels visíveis', () => {
    const cache = new Map<string, Uint8ClampedArray>();
    const seedOf = (name: string): number => {
      let h = 0x811c9dc5;
      for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
      return h >>> 0;
    };
    const resolve = (name: string): Uint8ClampedArray => {
      const hit = cache.get(name);
      if (hit !== undefined) return hit;
      const data = renderRecipe(TEXTURES[name], seedOf(name), resolve);
      cache.set(name, data);
      return data;
    };

    for (const name of Object.keys(TEXTURES)) {
      const data = resolve(name);
      expect(data.length, name).toBe(SIZE);
      let opaque = 0;
      for (let i = 3; i < SIZE; i += 4) if (data[i] > 0) opaque++;
      expect(opaque, `${name} ficou totalmente transparente`).toBeGreaterThan(0);
    }
  });

  it('todo `inherit` aponta para uma textura existente', () => {
    for (const [name, recipe] of Object.entries(TEXTURES)) {
      if (recipe.inherit === undefined) continue;
      expect(TEXTURES[recipe.inherit], `${name} herda de ${recipe.inherit}`).toBeDefined();
    }
  });

  it('inclui a textura de fallback', () => {
    expect(TEXTURES['block/missing']).toBeDefined();
  });
});

/**
 * Legibilidade (doc 13 §2.2).
 *
 * Os blocos "construídos" já foram todos `inherit` do material de origem com
 * um `tintBy(0.9x)` por cima: baú, bancada, fornalha e estante eram tábua ou
 * pedregulho um pouco mais escuros, e cama e TNT apontavam **para a mesma
 * camada** de lã e de tábua. Na prática só dava para diferenciar pelo tooltip.
 *
 * O critério é a diferença média por pixel contra o material de origem. Como
 * régua, tábuas de carvalho contra tábuas de bétula — um par que se distingue
 * sem esforço — dá 48. Abaixo de 15 o jogador não separa os dois em jogo.
 */
describe('legibilidade das texturas', () => {
  const cache = new Map<string, Uint8ClampedArray>();
  const seedOf = (name: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
    return h >>> 0;
  };
  const build = (name: string): Uint8ClampedArray => {
    const hit = cache.get(name);
    if (hit !== undefined) return hit;
    const data = renderRecipe(TEXTURES[name], seedOf(name), build);
    cache.set(name, data);
    return data;
  };
  /** Diferença média por pixel entre duas texturas, em [0, 255]. */
  const distance = (a: string, b: string): number => {
    const pa = build(a);
    const pb = build(b);
    let total = 0;
    for (let i = 0; i < pa.length; i += 4) {
      total += (Math.abs(pa[i] - pb[i])
        + Math.abs(pa[i + 1] - pb[i + 1])
        + Math.abs(pa[i + 2] - pb[i + 2])) / 3;
    }
    return total / (TEX_SIZE * TEX_SIZE);
  };

  /** Mínimo para o jogador separar os dois sem ler o tooltip. */
  const LEGIBLE = 22;

  const pairs: readonly [string, string][] = [
    // Relato do jogador (2026-09-16): *"a mesa de trabalho e o baú estão com
    // textura muito semelhante, difícil distinguir batendo o olho"*. O par
    // passava na régua de 22 e ainda assim se confundia no slot, porque os dois
    // eram cubos de tábua clara: a diferença era de detalhe fino, que 16 px
    // não carregam. Agora é de **valor** — baú escuro, bancada clara.
    ['block/chest_side', 'block/crafting_table_top'],
    ['block/chest_top', 'block/crafting_table_top'],
    // Abóbora e melancia eram literalmente `block/oak_planks`.
    ['block/oak_planks', 'block/pumpkin_side'],
    ['block/oak_planks', 'block/melon_side'],
    ['block/oak_planks', 'block/acacia_planks'],
    ['block/oak_log_side', 'block/acacia_log_side'],
    // A fornalha "parecia um bloco normal de pedra": a boca é o que a separa.
    ['block/cobblestone', 'block/furnace_side'],
    ['block/stone', 'block/furnace_side'],
    // Quatro plantas que apontavam a mesma textura.
    ['block/tall_grass', 'block/oak_sapling'],
    ['block/tall_grass', 'block/fern'],
    ['block/tall_grass', 'block/sugar_cane'],
    ['block/tall_grass', 'block/dead_bush'],
    ['block/oak_leaves', 'block/oak_sapling'],
    ['block/oak_planks', 'block/chest_side'],
    ['block/oak_planks', 'block/chest_top'],
    ['block/oak_planks', 'block/crafting_table_side'],
    ['block/oak_planks', 'block/crafting_table_top'],
    ['block/oak_planks', 'block/bookshelf'],
    ['block/oak_planks', 'block/oak_door'],
    ['block/oak_planks', 'block/tnt_side'],
    ['block/chest_side', 'block/crafting_table_side'],
    ['block/cobblestone', 'block/furnace_side'],
    // Desde o M13 a cor da lã e da cama é tint (`data/tints.ts`, testado lá,
    // inclusive a cabeceira: em cinza ela só se distingue depois de tingida).
    // Os quatro quadros (M8): eram **um** desenho só, repetido em toda parede.
    ['block/painting', 'block/painting_sunflower'],
    ['block/painting', 'block/painting_skull'],
    ['block/painting', 'block/painting_night'],
    ['block/painting_sunflower', 'block/painting_skull'],
    ['block/painting_sunflower', 'block/painting_night'],
    ['block/painting_skull', 'block/painting_night'],
  ];

  it('a régua bate: carvalho e bétula são bem distintos', () => {
    expect(distance('block/oak_planks', 'block/birch_planks')).toBeGreaterThan(40);
  });

  /*
   * Baú e bancada ficam lado a lado no inventário e são os dois de madeira: a
   * régua comum de 22 não bastou na prática. Aqui o piso é o dobro.
   */
  /**
   * Diferença média dentro de um retângulo do ladrilho.
   *
   * A régua de tile inteiro dilui mudança local: a boca da fornalha ocupa 60
   * dos 256 pixels, e acender uma fogueira lá dentro mal mexe na média. O que
   * o jogador enxerga é o contraste **onde ele olha**.
   */
  const regionDistance = (
    a: string, b: string, x0: number, y0: number, w: number, h: number,
  ): number => {
    const pa = build(a);
    const pb = build(b);
    let total = 0;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = ((y * TEX_SIZE) + x) << 2;
        total += (Math.abs(pa[i] - pb[i])
          + Math.abs(pa[i + 1] - pb[i + 1])
          + Math.abs(pa[i + 2] - pb[i + 2])) / 3;
      }
    }
    return total / (w * h);
  };

  it('a fornalha acesa se vê de longe: a boca muda, e muito', () => {
    expect(regionDistance('block/furnace_side', 'block/furnace_lit', 3, 7, 10, 6))
      .toBeGreaterThan(60);
  });

  it('baú e bancada se separam de longe, não só no detalhe', () => {
    expect(distance('block/chest_side', 'block/crafting_table_side')).toBeGreaterThan(44);
  });

  for (const [a, b] of pairs) {
    it(`${a} e ${b} se distinguem`, () => {
      expect(distance(a, b)).toBeGreaterThan(LEGIBLE);
    });
  }

  /*
   * A regressão do vidro (2026-09-16): a receita dele pintava o ladrilho
   * inteiro com `alpha: 0.28`, e o shader do passe recortado descarta tudo
   * abaixo de 0,5. **Nenhum pixel sobrevivia** — uma janela colocada não
   * deixava rastro na tela e o slot do inventário parecia vazio.
   *
   * O teste vale para a classe inteira do bug, não só para o vidro: todo bloco
   * desenhado nos passes opaco e recortado precisa de pixel que passe do corte.
   */
  describe('todo bloco do passe recortado tem pixel que passa do corte de alfa', () => {
    const index = buildLayerIndex();
    const tables = buildBlockTables(index);

    const opaques = (name: string): number => {
      const recipe = TEXTURES[name];
      if (recipe === undefined) return 1; // textura inexistente cai em `missing`
      const px = build(name);
      let n = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] >= 128) n++;
      return n;
    };

    for (const def of BLOCKS) {
      if (def === undefined) continue;
      const layer = tables.renderLayer[def.id];
      if (layer !== LAYER_OPAQUE && layer !== LAYER_CUTOUT) continue;
      const faces = new Set([
        texOf(def, 'top'), texOf(def, 'side'), texOf(def, 'bottom'), ...def.stages,
      ]);
      for (const face of faces) {
        it(`${def.name}: ${face}`, () => {
          expect(opaques(face), `${face} some inteira no recorte de alfa`)
            .toBeGreaterThan(0);
        });
      }
    }
  });

  /*
   * E o vidro, especificamente, precisa continuar sendo **janela**: moldura
   * visível e miolo vazado. Opaco demais deixa de ser vidro; vazado demais
   * volta a ser o bug.
   */
  it('o vidro mostra a moldura e deixa ver através', () => {
    const px = build('block/glass');
    let opaco = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] >= 128) opaco++;
    const total = TEX_SIZE * TEX_SIZE;
    expect(opaco / total).toBeGreaterThan(0.15);
    expect(opaco / total).toBeLessThan(0.45);
    // As quatro bordas são a moldura: elas têm que estar inteiras.
    const alpha = (x: number, y: number): number => px[((y * TEX_SIZE + x) << 2) + 3];
    for (let i = 0; i < TEX_SIZE; i++) {
      expect(alpha(i, 0)).toBeGreaterThanOrEqual(128);
      expect(alpha(i, TEX_SIZE - 1)).toBeGreaterThanOrEqual(128);
      expect(alpha(0, i)).toBeGreaterThanOrEqual(128);
      expect(alpha(TEX_SIZE - 1, i)).toBeGreaterThanOrEqual(128);
    }
    // E o centro continua sendo buraco.
    expect(alpha(8, 8)).toBe(0);
  });

  it('nenhuma face visível de bloco construído é a camada crua de outro bloco', () => {
    // Cama era `block/wool_white` e TNT era `block/oak_planks`, literalmente a
    // mesma camada do atlas — zero de diferença, por construção. A face de
    // baixo fica de fora: o fundo da bancada é tábua mesmo, e ninguém o vê.
    for (const name of [
      'bed', 'tnt', 'oak_door', 'chest', 'crafting_table', 'furnace',
      // Acrescentados em 2026-09-16: os três primeiros apontavam
      // `block/oak_planks`, e as plantas dividiam `block/tall_grass`.
      'pumpkin', 'melon', 'acacia_planks', 'acacia_log',
      'oak_sapling', 'fern', 'sugar_cane', 'dead_bush', 'vine', 'birch_leaves',
    ]) {
      const def = BLOCK_BY_NAME.get(name);
      expect(def, name).toBeDefined();
      const tex = def!.tex;
      const visible = typeof tex === 'string' ? [tex] : [tex.top, tex.side];
      for (const layer of visible) {
        expect(layer, `${name} mostra ${layer}`).toMatch(new RegExp(`^block/${name}`));
      }
    }
  });
});
