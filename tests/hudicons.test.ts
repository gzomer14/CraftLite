/**
 * O ícone da barra de fome (doc 08 §3.4).
 *
 * Ele era a string `▮▮▯▯` e, na tela do celular, lia como um risco em vez de
 * comida (relato de campo 2026-09-14). Virou desenho — e desenho gerado por
 * código, porque nenhum asset de terceiros entra no repositório (PROMPT.md §6).
 *
 * O que se testa é o que quebra em silêncio: uma grade torta, um SVG que o
 * navegador recusa, e a cor saindo do desenho em vez de sair do CSS — que é o
 * que faria a paleta para daltônicos parar de valer para a fome.
 */
import { describe, expect, it } from 'vitest';
import { DRUMSTICK, maskFrom } from '../src/ui/hud';

describe('a grade da coxa', () => {
  it('é quadrada, na resolução dos ícones do gênero', () => {
    expect(DRUMSTICK.length).toBe(9);
    for (const row of DRUMSTICK) expect(row.length, row).toBe(9);
  });

  it('só tem os dois caracteres do desenho', () => {
    for (const row of DRUMSTICK) expect(row, row).toMatch(/^[.#]+$/);
  });

  it('tem carne em cima e osso embaixo, à esquerda', () => {
    // É o que separa uma coxa de um borrão: a massa fica no alto e afina para
    // o canto de baixo.
    const carne = DRUMSTICK[3].indexOf('#');
    const osso = DRUMSTICK[8].lastIndexOf('#');
    expect(DRUMSTICK[3].replace(/\./g, '').length, 'a carne é a parte larga')
      .toBeGreaterThan(DRUMSTICK[8].replace(/\./g, '').length);
    expect(osso, 'o osso termina antes do meio').toBeLessThan(4);
    expect(carne).toBeLessThan(3);
  });
});

describe('a máscara', () => {
  const mask = maskFrom(DRUMSTICK);

  it('sai como um url de SVG que o CSS aceita', () => {
    expect(mask.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(mask.endsWith('")')).toBe(true);
  });

  it('junta os pixels vizinhos em um retângulo só', () => {
    // Um por pixel seriam 50; um por sequência são 9, um por linha desenhada.
    const svg = decodeURIComponent(mask.slice('url("data:image/svg+xml,'.length, -2));
    const rects = svg.match(/<rect/g)?.length ?? 0;
    expect(rects).toBe(9);
  });

  it('o viewBox acompanha a grade', () => {
    const svg = decodeURIComponent(mask.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg).toContain('viewBox="0 0 9 9"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('não carrega cor nenhuma de verdade — quem pinta é o CSS', () => {
    // O preto do `fill` é só o que a máscara precisa para ser opaca; a cor que
    // aparece na tela vem de `currentColor`, e é ela que a paleta troca.
    const svg = decodeURIComponent(mask.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg.match(/fill="/g)?.length).toBe(1);
  });

  it('uma grade de uma linha só vira um retângulo', () => {
    const mini = maskFrom(['.##.']);
    const svg = decodeURIComponent(mini.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg).toContain('<rect x="1" y="0" width="2" height="1"/>');
    expect(svg).toContain('viewBox="0 0 4 1"');
  });

  it('linha vazia não vira retângulo nenhum', () => {
    const mini = maskFrom(['....']);
    const svg = decodeURIComponent(mini.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg).not.toContain('<rect');
  });
});
