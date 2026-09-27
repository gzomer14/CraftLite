/**
 * Conferência de um conjunto de mods antes de entregá-lo às tabelas (M21).
 *
 * Roda no ponto de entrada dos mods (`mods/boot.ts`), e não no jogo: o jogo
 * sem mod não paga os bytes. Um mod com defeito de declaração fica **de fora**
 * inteiro, com a razão no console — melhor que um bloco com id de outro mod
 * indo para o save.
 */

import {
  MOD_BLOCK_FIRST, MOD_BLOCK_LAST, MOD_ITEM_FIRST, MOD_ITEM_LAST, type ModDef,
} from './types';

/** Os problemas de um mod sozinho. Vazio = pode entrar. */
export function modProblems(mod: ModDef): string[] {
  const out: string[] = [];
  if (!/^[a-z0-9_]+$/.test(mod.id)) out.push(`id inválido: "${mod.id}"`);
  const prefix = `${mod.id}:`;
  const blocks = mod.blocks ?? [];
  const items = mod.items ?? [];
  checkRange(out, 'blocos', mod.blockBase, blocks.length, MOD_BLOCK_FIRST, MOD_BLOCK_LAST);
  checkRange(out, 'itens', mod.itemBase, items.length, MOD_ITEM_FIRST, MOD_ITEM_LAST);
  const names = new Set<string>();
  for (const row of [...blocks, ...items]) {
    if (!row.name.startsWith(prefix)) out.push(`nome sem o prefixo "${prefix}": ${row.name}`);
    if (names.has(row.name)) out.push(`nome repetido: ${row.name}`);
    names.add(row.name);
    if (mod.en[row.name] === undefined) out.push(`sem nome em inglês: ${row.name}`);
  }
  const textures = mod.textures?.(TEXGEN_PROBE) ?? {};
  for (const name of Object.keys(textures)) {
    if (!name.startsWith(prefix)) out.push(`textura sem o prefixo "${prefix}": ${name}`);
  }
  for (const [name, rows] of Object.entries(mod.itemShapes ?? {})) {
    if (!name.startsWith(prefix)) out.push(`silhueta sem o prefixo "${prefix}": ${name}`);
    if (rows.length !== 16 || rows.some((row) => row.length !== 16)) {
      out.push(`silhueta fora de 16×16: ${name}`);
    }
  }
  for (const name of Object.keys(mod.itemArt ?? {})) {
    if (!names.has(name)) out.push(`arte de item que o mod não tem: ${name}`);
  }
  return out;
}

/**
 * O conjunto que entra: cada mod válido, na ordem, desde que a faixa de id não
 * cruze a de um mod que já entrou.
 */
export function acceptMods(mods: readonly ModDef[]): { accepted: ModDef[]; problems: string[] } {
  const accepted: ModDef[] = [];
  const problems: string[] = [];
  const blocks: [number, number][] = [];
  const itemRanges: [number, number][] = [];
  for (const mod of mods) {
    const own = modProblems(mod);
    const b = spanOf(mod.blockBase, mod.blocks?.length ?? 0);
    const i = spanOf(mod.itemBase, mod.items?.length ?? 0);
    if (b !== null && blocks.some((r) => overlaps(r, b))) own.push('faixa de blocos cruza outro mod');
    if (i !== null && itemRanges.some((r) => overlaps(r, i))) own.push('faixa de itens cruza outro mod');
    if (accepted.some((m) => m.id === mod.id)) own.push('mod repetido');
    if (own.length > 0) {
      for (const problem of own) problems.push(`${mod.id}: ${problem}`);
      continue;
    }
    accepted.push(mod);
    if (b !== null) blocks.push(b);
    if (i !== null) itemRanges.push(i);
  }
  return { accepted, problems };
}

function checkRange(
  out: string[], label: string, base: number | undefined, count: number, first: number, last: number,
): void {
  if (count === 0) return;
  if (base === undefined) {
    out.push(`${label} sem base de id`);
    return;
  }
  if (base < first || base + count - 1 > last) {
    out.push(`${label} fora da faixa ${first}..${last}: ${base}..${base + count - 1}`);
  }
}

function spanOf(base: number | undefined, count: number): [number, number] | null {
  return base === undefined || count === 0 ? null : [base, base + count - 1];
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/**
 * Para ler só os **nomes** das texturas sem importar `render/texgen` aqui:
 * todo operador vira uma função vazia.
 */
const TEXGEN_PROBE = new Proxy({}, {
  get: () => () => () => undefined,
}) as Parameters<NonNullable<ModDef['textures']>>[0];
