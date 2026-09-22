/**
 * Miniatura do mundo (doc 08 §3.2).
 *
 * O contexto nasce com `preserveDrawingBuffer: false` — ligá-lo custaria uma
 * cópia do backbuffer **todo frame** —, então o canvas só pode ser lido
 * dentro do mesmo quadro em que foi desenhado. Daí o desenho em duas partes:
 * o render chama `grab` logo depois de desenhar, e o save pede `bytes` quando
 * precisar deles.
 *
 * Saiu do `main.ts` em 2026-09-22 (M13).
 */

import { decodeDataUrl } from '../core/dataurl';

export class Thumbnail {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D | null;
  private data = '';
  /** Pede uma foto nova no próximo quadro desenhado. */
  pending = true;

  constructor(width = 160, height = 90) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
  }

  /** Copia o quadro recém-desenhado para o canvas pequeno, se pedido. */
  grab(source: HTMLCanvasElement): void {
    if (!this.pending || this.ctx === null) return;
    this.pending = false;
    try {
      this.ctx.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
      this.data = this.canvas.toDataURL('image/png');
    } catch {
      // Canvas "sujo" ou contexto perdido: o mundo fica sem miniatura.
      this.data = '';
    }
  }

  bytes(): Uint8Array | null {
    return decodeDataUrl(this.data);
  }
}
