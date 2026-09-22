/**
 * Fechamento do M8 (doc 14): quadro com arte, cores e a tampa do baú.
 *
 * Os três têm a mesma forma de erro e por isso o mesmo tipo de teste: são
 * **conteúdo derivado de tabela**, e o jeito de errar é a tabela e o derivado
 * discordarem — uma cor sem textura, um quadro que cai na tela errada, uma
 * tampa que gira mas não fecha.
 */

import { describe, expect, it } from 'vitest';
import { BLOCK_BY_NAME, defOf, makeState } from '../src/data/blocks';
import { DYES, DYE_SOURCES } from '../src/data/dyes';
import { ITEM_BY_NAME } from '../src/data/items';
import { ITEM_ART } from '../src/data/itemart';
import { RECIPES, TAGS } from '../src/data/recipes';
import { SMELTING } from '../src/data/smelting';
import { TEXTURES } from '../src/data/textures';
import { buildLayerIndex } from '../src/render/layers';
import {
  CHEST_BODY_TOP, CHEST_LID_ANGLE, CHEST_MARGIN, CHEST_TOP, boxesFor, SHAPE_CHEST,
} from '../src/world/mesh/shapes';

describe('quadro com arte', () => {
  const ART = [
    'block/painting', 'block/painting_sunflower',
    'block/painting_skull', 'block/painting_night',
  ];

  it('as quatro telas existem e são desenhos diferentes', () => {
    for (const name of ART) expect(TEXTURES[name], name).toBeDefined();
    expect(new Set(ART).size).toBe(4);
  });

  it('os bits de estado escolhem a tela, e a parede não interfere', () => {
    const painting = BLOCK_BY_NAME.get('painting');
    expect(painting).toBeDefined();
    const stages = painting?.stages ?? [];
    expect(stages).toHaveLength(16);
    for (let state = 0; state < 16; state++) {
      // Bits 0..1 = parede, bits 2..3 = arte.
      expect(stages[state]).toBe(ART[(state >> 2) & 3]);
    }
    // As quatro paredes da mesma arte dão a mesma tela.
    for (let art = 0; art < 4; art++) {
      const first = stages[art << 2];
      for (let wall = 0; wall < 4; wall++) expect(stages[(art << 2) | wall]).toBe(first);
    }
  });

  /*
   * Que as quatro sejam **visualmente** diferentes é medido em
   * `texgen.test.ts`, com a mesma régua de legibilidade dos outros pares que já
   * se confundiam no inventário.
   */
});

describe('lã, corante e cama coloridas', () => {
  it('toda cor tem lã, cama, corante e as texturas das três', () => {
    for (const dye of DYES) {
      const wool = dye.name === 'white' ? 'white_wool' : `${dye.name}_wool`;
      const bed = dye.name === 'red' ? 'bed' : `bed_${dye.name}`;
      expect(BLOCK_BY_NAME.get(wool), wool).toBeDefined();
      expect(BLOCK_BY_NAME.get(bed), bed).toBeDefined();
      expect(BLOCK_BY_NAME.get(`${bed}_head`), `${bed}_head`).toBeDefined();
      expect(ITEM_BY_NAME.get(`${dye.name}_dye`), `${dye.name}_dye`).toBeDefined();
      // M13: a cor é tint sobre um desenho só (`data/tints.ts`).
      expect(BLOCK_BY_NAME.get(wool)?.dye, wool).toBe(dye.name);
      expect(BLOCK_BY_NAME.get(bed)?.dye, bed).toBe(dye.name);
      expect(TEXTURES['block/wool_white']).toBeDefined();
      for (const part of ['top', 'foot_top', 'side']) {
        expect(TEXTURES[`block/bed_${part}`], `bed_${part}`).toBeDefined();
      }
    }
  });

  it('a cabeceira e o pé são o mesmo móvel, ligados nos dois sentidos', () => {
    for (const dye of DYES) {
      const bed = dye.name === 'red' ? 'bed' : `bed_${dye.name}`;
      const foot = BLOCK_BY_NAME.get(bed);
      const head = BLOCK_BY_NAME.get(`${bed}_head`);
      expect(foot?.multi?.other).toBe(head?.name);
      expect(head?.multi?.other).toBe(foot?.name);
      expect(foot?.multi?.root).toBe(true);
      expect(head?.multi?.root).toBe(false);
      // A cabeceira não vira item: ela nasce junto com o pé.
      expect(head?.itemless).toBe(true);
      // Dormir sai da forma, não do id: é isto que faz cor nova dormir de graça.
      expect(foot?.shape).toBe('bed');
      expect(head?.shape).toBe('bed');
    }
  });

  it('toda lã entra onde a receita pede lã', () => {
    expect(TAGS.wool).toHaveLength(DYES.length);
    for (const dye of DYES) {
      const wool = dye.name === 'white' ? 'white_wool' : `${dye.name}_wool`;
      expect(TAGS.wool).toContain(wool);
    }
  });

  it('toda cor tem como ser obtida', () => {
    for (const dye of DYES) {
      const source = DYE_SOURCES.find((s) => s.dye === dye.name);
      expect(source, `sem fonte para ${dye.name}`).toBeDefined();
      if (source?.smelted === true) {
        expect(SMELTING.some((r) => r.output === `${dye.name}_dye`)).toBe(true);
      } else {
        expect(
          RECIPES.some((r) => r.result.item === `${dye.name}_dye`),
          `sem receita para ${dye.name}_dye`,
        ).toBe(true);
      }
      // E uma cama da cor.
      const bed = dye.name === 'red' ? 'bed' : `bed_${dye.name}`;
      expect(RECIPES.some((r) => r.result.item === bed), `sem receita para ${bed}`).toBe(true);
    }
  });

  it('a mistura parte de corantes que existem', () => {
    for (const source of DYE_SOURCES) {
      if (source.mix === undefined) continue;
      for (const part of source.mix) expect(ITEM_BY_NAME.get(part), part).toBeDefined();
    }
  });

  it('todo corante e toda cama têm sprite próprio', () => {
    const seen = new Map<string, string>();
    for (const dye of DYES) {
      const art = ITEM_ART[`${dye.name}_dye`];
      expect(art, `${dye.name}_dye sem arte`).toBeDefined();
      const key = art.color.join(',');
      expect(seen.get(key), `${dye.name} repete a cor de ${seen.get(key)}`).toBeUndefined();
      seen.set(key, dye.name);
      const bed = dye.name === 'red' ? 'bed' : `bed_${dye.name}`;
      expect(ITEM_ART[bed], `${bed} sem arte`).toBeDefined();
    }
  });

  it('o atlas continua dentro do teto do doc 02 §3', () => {
    expect(buildLayerIndex().count).toBeLessThanOrEqual(256);
  });
});

describe('tampa do baú', () => {
  it('a forma que a física e o contorno leem não muda ao abrir', () => {
    const closed = new Float32Array(30);
    const open = new Float32Array(30);
    const a = boxesFor(SHAPE_CHEST, 0, 0, closed);
    const b = boxesFor(SHAPE_CHEST, 1, 0, open);
    expect(a).toBe(b);
    expect(Array.from(closed)).toEqual(Array.from(open));
  });

  it('o baú guarda a tampa no bit 0 do estado', () => {
    const chest = BLOCK_BY_NAME.get('chest');
    expect(chest).toBeDefined();
    const id = chest?.id ?? -1;
    // Abrir não troca o bloco: é o mesmo baú, com um bit a mais.
    expect(defOf(makeState(id, 1)).name).toBe('chest');
    expect(defOf(makeState(id, 0)).name).toBe('chest');
  });

  it('a dobradiça fica atrás e a tampa passa do prumo', () => {
    // 95° e não 90: parada em pé ela leria como parede.
    expect(CHEST_LID_ANGLE).toBeGreaterThan(Math.PI / 2);
    expect(CHEST_LID_ANGLE).toBeLessThan(Math.PI);
    // A tampa é a fatia de cima da caixa, e o corpo o resto.
    expect(CHEST_BODY_TOP).toBeLessThan(CHEST_TOP);
    expect(CHEST_TOP).toBeLessThan(1);
    expect(CHEST_MARGIN).toBeGreaterThan(0);
  });

  it('a tampa aberta sai de dentro do bloco, que é o que se vê', () => {
    // Um canto da frente da tampa, girado: sobe acima do topo do baú fechado.
    const dy = CHEST_BODY_TOP - CHEST_TOP;
    const dz = 1 - CHEST_MARGIN - CHEST_MARGIN;
    const y = CHEST_TOP + dz * Math.sin(CHEST_LID_ANGLE) + dy * Math.cos(CHEST_LID_ANGLE);
    expect(y).toBeGreaterThan(CHEST_TOP);
  });
});
