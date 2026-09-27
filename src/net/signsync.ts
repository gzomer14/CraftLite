/**
 * O texto das placas numa sala (M20).
 *
 * O bloco da placa viaja com os outros blocos; o **texto** não é bloco — mora
 * na `SignStore` —, e sem isto cada um via a placa do outro em branco. Aqui o
 * `set` da instância avisa quando alguém escreve (`SIGN`), e a placa que chega
 * entra pelo `set` de sempre, que já limpa o texto (fonte, largura, 4 linhas).
 * O anfitrião também manda as placas de cada coluna que o convidado pede.
 */

import { SIGN_LINES, type SignStore } from '../game/signs';
import { MSG, PacketWriter, type PacketReader } from './protocol';

export interface SignChange { x: number; y: number; z: number; lines: string[] }

export class SignSync {
  private readonly w = new PacketWriter(256);
  private readonly base: SignStore['set'];
  private applying = false;

  /** `onLocal`: alguém deste aparelho escreveu numa placa. */
  constructor(
    private readonly signs: SignStore,
    onLocal: (bytes: Uint8Array, change: SignChange) => void,
  ) {
    const base = signs.set.bind(signs);
    this.base = base;
    signs.set = (x, y, z, lines) => {
      base(x, y, z, lines);
      if (this.applying) return;
      const clean = (signs.get(x, y, z) ?? []).slice();
      onLocal(this.write(x, y, z, clean), { x, y, z, lines: clean });
    };
  }

  /** `SIGN` que chegou: grava sem avisar de volta. */
  apply(r: PacketReader): SignChange | null {
    const x = r.i32(); const y = r.u16(); const z = r.i32();
    let lines: unknown;
    try {
      lines = JSON.parse(r.str());
    } catch {
      return null;
    }
    if (!Array.isArray(lines)) return null;
    const text = lines.slice(0, SIGN_LINES).map((l) => (typeof l === 'string' ? l : ''));
    this.applying = true;
    this.base(x, y, z, text);
    this.applying = false;
    return { x, y, z, lines: (this.signs.get(x, y, z) ?? []).slice() };
  }

  write(x: number, y: number, z: number, lines: readonly string[]): Uint8Array {
    return this.w.reset(MSG.SIGN).i32(x).u16(y).i32(z).str(JSON.stringify(lines)).view8();
  }

  /** As placas escritas de uma coluna, uma mensagem por placa. */
  column(cx: number, cz: number, send: (bytes: Uint8Array) => void): void {
    if (this.signs.size === 0) return;
    this.signs.forEach((x, y, z, lines) => {
      if (x >> 4 === cx && z >> 4 === cz) send(this.write(x, y, z, lines));
    });
  }

  restore(): void {
    this.signs.set = this.base;
  }
}
