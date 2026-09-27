/**
 * O nome em cima de cada jogador da sala (M20, pedido de campo 2026-09-27).
 *
 * Um rótulo HTML por jogador, posicionado a cada quadro pela câmera — e não
 * texto desenhado no mundo, como a placa: a tinta da placa é escura e some de
 * noite, e aqui o nome tem de ser lido a 40 blocos, de dia e de noite, com o
 * fundo que estiver atrás. Visto através de parede, como no gênero, para achar
 * o outro; agachado, o nome fica apagado.
 *
 * Só existe com a sala aberta: quem joga sozinho não cria nenhum elemento.
 * A posição sai da mesma câmera do quadro (`camera.update` é idempotente — o
 * renderer a chama de novo logo depois, com o mesmo resultado).
 */

import type { Camera } from '../render/camera';
import { MOVE_AWAY, MOVE_SNEAK } from './protocol';
import type { Avatar } from './avatars';

/** Acima da cabeça: o boneco tem 1,8 de altura. */
const HEAD_CLEARANCE = 2.1;
/** Além disto o nome some: longe, ele só atrapalha. */
const MAX_DISTANCE = 64;

const STYLE = `#name-tags{position:fixed;inset:0;pointer-events:none;z-index:3;overflow:hidden}
#name-tags div{position:absolute;left:0;top:0;padding:1px 6px;border-radius:3px;white-space:nowrap;
background:#00000080;color:#fff;font:14px/1.3 monospace;will-change:transform}`;

export class NameTags {
  private readonly root: HTMLDivElement;
  private readonly tags = new Map<number, HTMLDivElement>();
  private readonly seen = new Set<number>();

  constructor(private readonly camera: Camera, private readonly canvas: HTMLCanvasElement) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.root = document.createElement('div');
    this.root.id = 'name-tags';
    this.root.append(style);
    document.body.append(this.root);
  }

  /** Um quadro: cada nome no ponto da tela sobre a cabeça do jogador. */
  update(list: readonly Avatar[], alpha: number): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const camera = this.camera;
    camera.update(alpha, width / height);
    const m = camera.viewProj;
    this.seen.clear();
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.placed || (a.flags & MOVE_AWAY) !== 0) continue;
      const x = a.prevX + (a.x - a.prevX) * alpha;
      const y = a.prevY + (a.y - a.prevY) * alpha + HEAD_CLEARANCE;
      const z = a.prevZ + (a.z - a.prevZ) * alpha;
      const dx = x - camera.renderX;
      const dz = z - camera.renderZ;
      if (dx * dx + dz * dz > MAX_DISTANCE * MAX_DISTANCE) continue;
      // `Mat4` em colunas, como o WebGL.
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w < 0.1) continue; // atrás da câmera
      const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * 0.5 * width;
      const sy = (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 * height;
      const tag = this.tagFor(a);
      tag.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-100%)`;
      tag.style.opacity = (a.flags & MOVE_SNEAK) !== 0 ? '0.35' : '1';
      tag.hidden = false;
      this.seen.add(a.netId);
    }
    for (const [netId, tag] of this.tags) {
      if (this.seen.has(netId)) continue;
      if (!listed(list, netId)) {
        tag.remove();
        this.tags.delete(netId);
      } else {
        tag.hidden = true;
      }
    }
  }

  dispose(): void {
    this.root.remove();
    this.tags.clear();
  }

  private tagFor(a: Avatar): HTMLDivElement {
    let tag = this.tags.get(a.netId);
    if (tag === undefined) {
      tag = document.createElement('div');
      this.root.append(tag);
      this.tags.set(a.netId, tag);
    }
    if (tag.textContent !== a.name) tag.textContent = a.name;
    return tag;
  }
}

function listed(list: readonly Avatar[], netId: number): boolean {
  for (let i = 0; i < list.length; i++) if (list[i].netId === netId) return true;
  return false;
}
