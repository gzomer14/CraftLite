/**
 * Texto das placas (doc 14 — M8).
 *
 * É a primeira *tile entity* do jogo que não é contêiner: a placa não guarda
 * item, guarda quatro linhas de texto. Ficar num módulo próprio, e não dentro
 * de `container.ts`, é o que evita inventar um `Container` de zero slots só
 * para pendurar uma string nele.
 *
 * A chave é a posição empacotada, igual à dos contêineres, e o ciclo de vida é
 * o mesmo: nasce quando a placa é colocada, morre quando ela quebra — e quem
 * avisa é `session.ts`, no mesmo lugar em que o baú derrama o conteúdo.
 */

import { toFontText } from '../data/font';

/** Quantas linhas uma placa escreve, e quantos caracteres cabem em cada uma. */
export const SIGN_LINES = 4;
export const SIGN_COLUMNS = 15;

/** Registro serializado de uma placa. */
export interface SignRecord {
  kind: 'sign';
  x: number;
  y: number;
  z: number;
  lines: string[];
}

/** Quatro linhas vazias, para quem abre uma placa nova. */
export function emptySignText(): string[] {
  return new Array<string>(SIGN_LINES).fill('');
}

/**
 * Corta e normaliza uma linha: o que a fonte não desenha vira espaço, e o que
 * passa da largura da placa é descartado na hora de escrever, não na hora de
 * desenhar — assim o save nunca guarda o que ninguém vai ver.
 */
export function sanitizeSignLine(text: string): string {
  return toFontText(text).slice(0, SIGN_COLUMNS).replace(/\s+$/, '');
}

/** Uma placa escrita: posição e texto. */
interface Sign {
  x: number;
  y: number;
  z: number;
  lines: string[];
}

export class SignStore {
  private readonly signs = new Map<number, Sign>();

  get size(): number {
    return this.signs.size;
  }

  /** Grava o texto. Placa com as quatro linhas vazias não ocupa registro. */
  set(x: number, y: number, z: number, lines: readonly string[]): void {
    const clean: string[] = [];
    let any = false;
    for (let i = 0; i < SIGN_LINES; i++) {
      const line = sanitizeSignLine(lines[i] ?? '');
      clean.push(line);
      if (line.length > 0) any = true;
    }
    const key = positionKey(x, y, z);
    if (any) this.signs.set(key, { x, y, z, lines: clean });
    else this.signs.delete(key);
  }

  /** As linhas da placa, ou `null` se ela nunca foi escrita. */
  get(x: number, y: number, z: number): readonly string[] | null {
    return this.signs.get(positionKey(x, y, z))?.lines ?? null;
  }

  remove(x: number, y: number, z: number): void {
    this.signs.delete(positionKey(x, y, z));
  }

  clear(): void {
    this.signs.clear();
  }

  /**
   * Percorre as placas escritas. Recebe a posição solta em vez de um objeto
   * porque quem chama é o render, a cada quadro: devolver `{x, y, z}` aqui
   * seria alocar por placa por quadro.
   */
  forEach(visit: (x: number, y: number, z: number, lines: readonly string[]) => void): void {
    for (const sign of this.signs.values()) visit(sign.x, sign.y, sign.z, sign.lines);
  }

  /** Todas as placas escritas, para salvar. */
  records(): SignRecord[] {
    const out: SignRecord[] = [];
    for (const sign of this.signs.values()) {
      out.push({ kind: 'sign', x: sign.x, y: sign.y, z: sign.z, lines: sign.lines.slice() });
    }
    return out;
  }

  /** Restaura um registro lido do save. */
  restore(record: SignRecord): void {
    this.set(record.x, record.y, record.z, record.lines);
  }
}

/** Mesma chave dos contêineres de `session.ts`: 26 bits por eixo e 7 para Y. */
function positionKey(x: number, y: number, z: number): number {
  return ((x & 0x3ffffff) * 0x4000000 + (z & 0x3ffffff)) * 128 + y;
}
