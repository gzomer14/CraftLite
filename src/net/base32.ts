/**
 * Código de pareamento em texto (M20): base32 com verificação.
 *
 * É o que o jogador lê em voz alta ou digita quando não há câmera para ler o
 * QR. O alfabeto é o do RFC 4648 (A–Z e 2–7): cabe no modo alfanumérico do QR
 * (5,5 bits por caractere, em vez de 8 no modo byte), não tem minúscula e não
 * tem 0, 1 nem 8 — quem digitar zero no lugar de O, ou um no lugar de I, é
 * corrigido na leitura. Dois bytes de CRC-16 no fim pegam a letra trocada
 * antes de o WebRTC receber lixo e falhar sem dizer por quê.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** CRC-16/CCITT-FALSE. */
export function crc16(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** Bytes → base32 com CRC no fim, sem separadores (é o que vai no QR). */
export function encodeCode(bytes: Uint8Array): string {
  const crc = crc16(bytes);
  const all = new Uint8Array(bytes.length + 2);
  all.set(bytes);
  all[bytes.length] = crc >> 8;
  all[bytes.length + 1] = crc & 0xff;
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < all.length; i++) {
    buffer = (buffer << 8) | all[i];
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/**
 * Texto → bytes, ou `null` se o código estiver incompleto ou com letra
 * trocada. Aceita minúscula, espaço, hífen e quebra de linha no meio.
 */
export function decodeCode(text: string): Uint8Array | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/0/g, 'O').replace(/1/g, 'I')
    .replace(/8/g, 'B');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = ALPHABET.indexOf(clean[i]);
    if (v < 0) return null;
    buffer = ((buffer << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length < 3) return null;
  const bytes = Uint8Array.from(out.slice(0, out.length - 2));
  const crc = (out[out.length - 2] << 8) | out[out.length - 1];
  return crc16(bytes) === crc ? bytes : null;
}

/** Em grupos de quatro, para ler e digitar: `ABCD-EFGH-…`. */
export function groupCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}
