/**
 * Isolamento dos mods (M21): as regras de import que mantêm o jogo sem mod
 * num arquivo só.
 *
 * O Rollup põe num pedaço compartilhado todo módulo usado por dois pontos de
 * entrada. Se um mod importasse um valor do jogo, ou se o jogo importasse o
 * carregador de mods, o `main.js` passaria a importar outro arquivo — e o jogo
 * **sem mod nenhum** faria uma requisição a mais. O relatório de tamanho
 * confere o resultado no build (`scripts/size-report.mjs`); aqui se confere a
 * causa, no fonte, sem precisar de build.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, normalize, relative, sep } from 'path';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

interface Import { spec: string; typeOnly: boolean; dynamic: boolean }

/** Os imports de um arquivo: estáticos (com `type` ou não) e `import()`. */
function importsOf(file: string): Import[] {
  const code = readFileSync(file, 'utf8');
  const out: Import[] = [];
  for (const m of code.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)';/gm)) {
    out.push({ spec: m[2], typeOnly: m[1] !== undefined, dynamic: false });
  }
  for (const m of code.matchAll(/^import\s+'([^']+)';/gm)) {
    out.push({ spec: m[1], typeOnly: false, dynamic: false });
  }
  for (const m of code.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) {
    out.push({ spec: m[1], typeOnly: false, dynamic: true });
  }
  return out;
}

/** Caminho do módulo importado, relativo a `src/`, sem extensão. */
function target(file: string, spec: string): string {
  return relative('src', normalize(join(dirname(file), spec))).split(sep).join('/');
}

const SOURCES = walk('src');
const rel = (file: string): string => relative('src', file).split(sep).join('/');

describe('isolamento dos mods', () => {
  it('um mod só importa tipos de fora da própria pasta', () => {
    const leaks: string[] = [];
    for (const file of SOURCES) {
      const path = rel(file);
      const own = /^mods\/([^/]+)\//.exec(path);
      if (own === null) continue;
      for (const imp of importsOf(file)) {
        if (imp.typeOnly) continue;
        const to = target(file, imp.spec);
        if (!to.startsWith(`mods/${own[1]}/`)) leaks.push(`${path} → ${imp.spec}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('só o ponto de entrada dos mods e o worker com mods importam o carregador', () => {
    const allowed = new Set(['mods/boot.ts', 'workers/chunk.modworker.ts']);
    const offenders = SOURCES.filter((file) => !allowed.has(rel(file)))
      .filter((file) => importsOf(file).some((imp) => ['mods/loaders', 'mods/validate', 'mods/boot']
        .includes(target(file, imp.spec)) && !imp.typeOnly))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('o ponto de entrada dos mods não importa nada do jogo', () => {
    const own = ['mods/loaders', 'mods/validate', 'mods/types'];
    for (const path of ['src/mods/boot.ts', 'src/mods/loaders.ts', 'src/mods/validate.ts']) {
      for (const imp of importsOf(path)) {
        if (imp.typeOnly) continue;
        const to = target(path, imp.spec);
        const ok = own.includes(to) || to === 'main' || /^mods\/[^/]+\/mod$/.test(to);
        expect(ok, `${path} → ${imp.spec}`).toBe(true);
      }
    }
  });

  it('o jogo não tem `import()`: nada de ajudante de pré-carga no pedaço principal', () => {
    // `game/netgate.ts` baixa a sala (M20) por URL, sem o ajudante do Vite.
    const allowed = new Set(['mods/boot.ts', 'mods/loaders.ts', 'workers/chunk.modworker.ts', 'game/netgate.ts']);
    const dynamic = SOURCES.filter((file) => !allowed.has(rel(file)))
      .filter((file) => importsOf(file).some((imp) => imp.dynamic))
      .map(rel);
    expect(dynamic).toEqual([]);
  });
});
