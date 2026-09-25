/**
 * Código curto de seed (M17): o mesmo mundo em outro aparelho a partir de
 * oito letras ditadas.
 */
import { describe, expect, it } from 'vitest';
import { parseSeedCode, seedCode } from '../src/core/seedcode';
import { seedFromString } from '../src/core/rng';
import { Rng } from '../src/core/rng';

describe('código de seed', () => {
  it('ida e volta em qualquer inteiro de 32 bits, sempre com oito letras', () => {
    const rng = new Rng(5);
    const samples = [0, 1, 31, 32, 0x7fffffff, 0x80000000, 0xffffffff];
    for (let i = 0; i < 2000; i++) samples.push(Math.floor(rng.next() * 4294967296));
    for (const hash of samples) {
      const code = seedCode(hash);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(parseSeedCode(code)).toBe(hash >>> 0);
    }
  });

  it('perdoa o que se erra copiando: minúscula, sem hífen, O por 0, I e L por 1', () => {
    const code = seedCode(3905126644);
    expect(parseSeedCode(code.toLowerCase())).toBe(3905126644);
    expect(parseSeedCode(code.replace('-', ''))).toBe(3905126644);
    expect(parseSeedCode(code.replace('-', ' '))).toBe(3905126644);
    const withZero = seedCode(0);
    expect(parseSeedCode(withZero.replace(/0/g, 'O'))).toBe(0);
    const withOne = seedCode(1);
    expect(parseSeedCode(withOne.replace(/1/g, 'l'))).toBe(1);
  });

  it('a verificação pega um caractere trocado e dois vizinhos invertidos', () => {
    const rng = new Rng(9);
    let caught = 0;
    let tried = 0;
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let n = 0; n < 300; n++) {
      const hash = Math.floor(rng.next() * 4294967296);
      const compact = seedCode(hash).replace('-', '');
      const pos = Math.floor(rng.next() * 7);
      const other = alphabet[(alphabet.indexOf(compact[pos]) + 1 + Math.floor(rng.next() * 30)) % 32];
      const typo = compact.slice(0, pos) + other + compact.slice(pos + 1);
      tried++;
      if (parseSeedCode(typo) === null) caught++;
      if (compact[pos] !== compact[pos + 1]) {
        const swapped = compact.slice(0, pos) + compact[pos + 1] + compact[pos] + compact.slice(pos + 2);
        tried++;
        if (parseSeedCode(swapped) === null) caught++;
      }
    }
    // Só escapa a troca entre 0 e Z (diferença de 31): quase nunca.
    expect(caught / tried).toBeGreaterThan(0.97);
  });

  it('texto que não é código continua sendo seed de texto', () => {
    expect(parseSeedCode('castelo')).toBeNull();
    expect(parseSeedCode('12345')).toBeNull();
    expect(parseSeedCode('')).toBeNull();
    expect(seedFromString('castelo')).toBe(seedFromString('castelo'));
    expect(seedFromString('12345')).toBe(12345);
  });

  it('colar o código no campo de seed dá o mesmo mundo de quem compartilhou', () => {
    const original = seedFromString('minha vila');
    expect(seedFromString(seedCode(original))).toBe(original);
    expect(seedFromString(`  ${seedCode(original).toLowerCase()}  `)).toBe(original);
  });
});
