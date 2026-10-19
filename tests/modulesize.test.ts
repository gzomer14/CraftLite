/**
 * Teto de tamanho de módulo (M24).
 *
 * O CLAUDE.md diz "acima de ~400 linhas, provavelmente são dois", e o projeto
 * aceita até 700 para um módulo com uma responsabilidade só. Três vezes (M13,
 * M18, M24) seis ou mais módulos passaram do teto sem ninguém ver até a
 * avaliação seguinte. Este teste faz o teto falhar na hora.
 *
 * Tabelas de `src/data/` ficam de fora: tabela longa é o formato do projeto.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT = 700;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (path !== join('src', 'data')) sources(path, out);
    } else if (name.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

describe('tamanho de módulo', () => {
  it(`nenhum módulo de código passa de ${LIMIT} linhas`, () => {
    const over: string[] = [];
    for (const path of sources('src')) {
      const lines = readFileSync(path, 'utf8').split('\n').length - 1;
      if (lines > LIMIT) over.push(`${path}: ${lines}`);
    }
    expect(over, 'corte por papel, como no M18 e no M24').toEqual([]);
  });
});
