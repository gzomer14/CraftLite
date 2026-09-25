/**
 * Código curto de seed (M17): `K7F2-9QXA` no lugar de `3905126644`.
 *
 * A seed de verdade do mundo é o `seedHash`, um inteiro de 32 bits — o texto
 * digitado ("oi", "castelo") vira número por hash e não volta. Para contar a
 * seed a alguém, o que importa é o número, e um número de dez dígitos é fácil
 * de errar ditando. O código é o mesmo número em **base32 de Crockford** (sem
 * I, L, O nem U, que se confundem com 1, 1, 0 e V), sete dígitos e mais um de
 * verificação, separado em dois grupos de quatro.
 *
 * A verificação é a soma ponderada pela posição, módulo 31 (primo): pega todo
 * erro de um caractere trocado e toda troca de dois vizinhos, salvo entre `0`
 * e `Z` (diferença de 31). Ela também é o que separa um código de uma seed de
 * texto que calhou de ter o mesmo formato — `ABCD-EFGH` digitado de propósito
 * só vira código se o último dígito bater, uma chance em 31.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Dígitos de valor: 7 × 5 bits = 35, os 3 de cima sempre zero. */
const DIGITS = 7;

/** Valor de um caractere, com as trocas que o Crockford perdoa; −1 = inválido. */
function digitOf(char: string): number {
  const c = char.toUpperCase();
  if (c === 'O') return 0;
  if (c === 'I' || c === 'L') return 1;
  return ALPHABET.indexOf(c);
}

function checksum(digits: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += (i + 1) * digits[i];
  return sum % 31;
}

/** O código de um `seedHash` (inteiro de 32 bits sem sinal). */
export function seedCode(hash: number): string {
  let value = hash >>> 0;
  const digits = new Array<number>(DIGITS);
  for (let i = DIGITS - 1; i >= 0; i--) {
    digits[i] = value % 32;
    value = Math.floor(value / 32);
  }
  let text = '';
  for (const d of digits) text += ALPHABET[d];
  text += ALPHABET[checksum(digits)];
  return `${text.slice(0, 4)}-${text.slice(4)}`;
}

/**
 * O `seedHash` de um código, ou `null` se o texto não é um código válido.
 *
 * Aceita minúsculas, espaço ou nada no lugar do hífen, e as letras que o
 * Crockford perdoa — é o que sai de quem copia à mão ou de um corretor de
 * celular.
 */
export function parseSeedCode(text: string): number | null {
  const compact = text.trim().replace(/[\s-]/g, '');
  if (compact.length !== DIGITS + 1) return null;
  const digits: number[] = [];
  for (let i = 0; i < DIGITS; i++) {
    const d = digitOf(compact[i]);
    if (d < 0) return null;
    digits.push(d);
  }
  if (digitOf(compact[DIGITS]) !== checksum(digits)) return null;
  let value = 0;
  for (const d of digits) value = value * 32 + d;
  // Os 3 bits de cima de 35 têm de ser zero para caber em 32.
  return value > 0xffffffff ? null : value >>> 0;
}
