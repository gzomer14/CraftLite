/**
 * Os outros jogadores de uma sala (M20): o boneco do jogador no mundo.
 *
 * Posição chega pela rede a 20 Hz no canal rápido (`MOVE`); aqui ela vira
 * `prev`/`cur` por tick local e é interpolada no quadro, como mob. O corpo
 * gira para onde o jogador olha — `yaw` do jogador e do mob são a mesma
 * convenção (`atan2(dx, dz)`) — e as pernas balançam com a distância andada.
 *
 * Desenha pelo mesmo batch dos mobs, a partir do gancho `extraEntities` da
 * `SceneFeed`: zero draw call a mais.
 */

import { modelOf } from '../data/mobmodels';
import { PLAYER_LAYER, type EntityAtlas } from '../render/entityatlas';
import type { MobRenderer } from '../render/mobrender';
import type { ItemRenderer } from '../render/itemrender';
import type { World } from '../world/world';
import { MOVE_AWAY, MOVE_SNEAK } from './protocol';

export interface Avatar {
  netId: number;
  name: string;
  x: number; y: number; z: number;
  prevX: number; prevY: number; prevZ: number;
  /** O último `MOVE` recebido: vira `x/y/z` no próximo tick. */
  tx: number; ty: number; tz: number;
  yaw: number;
  pitch: number;
  flags: number;
  /** O item na mão (id), ou −1. */
  held: number;
  limbSwing: number;
  limbAmount: number;
  age: number;
  /** Ainda não chegou posição nenhuma: não desenha. */
  placed: boolean;
}

/** Quanto a mão fica para o lado do corpo. */
const HAND_SIDE = 0.4;

export class Avatars {
  readonly list: Avatar[] = [];
  private readonly model = modelOf('player');

  constructor(
    private readonly world: World,
    private readonly mobRenderer: MobRenderer,
    private readonly entityAtlas: EntityAtlas,
    /** O fator de dia do quadro, para a luz do céu no corpo. */
    private readonly dayFactor: () => number,
  ) {}

  add(netId: number, name: string): Avatar {
    const existing = this.get(netId);
    if (existing !== undefined) {
      existing.name = name;
      return existing;
    }
    const a: Avatar = {
      netId, name, x: 0, y: 0, z: 0, prevX: 0, prevY: 0, prevZ: 0, tx: 0, ty: 0, tz: 0,
      yaw: 0, pitch: 0, flags: 0, held: -1, limbSwing: 0, limbAmount: 0, age: 0, placed: false,
    };
    this.list.push(a);
    return a;
  }

  remove(netId: number): Avatar | undefined {
    const i = this.list.findIndex((a) => a.netId === netId);
    if (i < 0) return undefined;
    return this.list.splice(i, 1)[0];
  }

  get(netId: number): Avatar | undefined {
    for (let i = 0; i < this.list.length; i++) if (this.list[i].netId === netId) return this.list[i];
    return undefined;
  }

  /** Um `MOVE` chegou. */
  move(
    netId: number, x: number, y: number, z: number, yaw: number, pitch: number, flags: number, held = 0xffff,
  ): void {
    const a = this.get(netId);
    if (a === undefined) return;
    a.tx = x; a.ty = y; a.tz = z;
    a.yaw = yaw; a.pitch = pitch; a.flags = flags;
    a.held = held === 0xffff ? -1 : held;
    if (!a.placed) {
      a.x = a.prevX = x; a.y = a.prevY = y; a.z = a.prevZ = z;
      a.placed = true;
    }
  }

  /** Um tick local: o alvo vira a posição, e as pernas andam. */
  tick(): void {
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      a.prevX = a.x; a.prevY = a.y; a.prevZ = a.z;
      const dx = a.tx - a.x;
      const dz = a.tz - a.z;
      // Teleporte (portal, renascer): não arrasta o boneco pelo caminho.
      if (dx * dx + dz * dz > 64) {
        a.prevX = a.tx; a.prevY = a.ty; a.prevZ = a.tz;
      }
      a.x = a.tx; a.y = a.ty; a.z = a.tz;
      const step = Math.min(1, Math.sqrt(dx * dx + dz * dz) * 4);
      a.limbAmount += (step - a.limbAmount) * 0.4;
      a.limbSwing += Math.sqrt(dx * dx + dz * dz) * 3;
      a.age++;
    }
  }

  /**
   * O item na mão, no passe dos itens do chão: um cartão virado para a câmera
   * na altura da mão direita, meio passo à frente do corpo.
   */
  drawItems(items: ItemRenderer, alpha: number): void {
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (!a.placed || a.held < 0 || (a.flags & MOVE_AWAY) !== 0) continue;
      const x = a.prevX + (a.x - a.prevX) * alpha;
      const y = a.prevY + (a.y - a.prevY) * alpha;
      const z = a.prevZ + (a.z - a.prevZ) * alpha;
      // Frente (sen, cos) do `forwardFrom`; a direita é a frente girada.
      const fx = Math.sin(a.yaw);
      const fz = Math.cos(a.yaw);
      const sneak = (a.flags & MOVE_SNEAK) !== 0 ? -0.15 : 0;
      items.add(x + fx * 0.3 - fz * HAND_SIDE, y + 0.5 + sneak, z + fz * 0.3 + fx * HAND_SIDE, a.held, 0);
    }
  }

  /** O quadro: cada boneco no batch dos mobs. */
  draw(alpha: number): void {
    if (this.list.length === 0) return;
    const layer = this.entityAtlas.layerOf(PLAYER_LAYER);
    const day = this.dayFactor();
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (!a.placed || (a.flags & MOVE_AWAY) !== 0) continue;
      const x = a.prevX + (a.x - a.prevX) * alpha;
      const y = a.prevY + (a.y - a.prevY) * alpha;
      const z = a.prevZ + (a.z - a.prevZ) * alpha;
      const bx = Math.floor(x);
      const by = Math.floor(y + 1);
      const bz = Math.floor(z);
      const light = Math.max(this.world.getBlockLight(bx, by, bz), this.world.getSkyLight(bx, by, bz) * day);
      // Agachado: o corpo desce um pouco, como o jogador local vê a câmera descer.
      const sneak = (a.flags & MOVE_SNEAK) !== 0 ? -0.15 : 0;
      this.mobRenderer.addModel(
        this.model, layer, x, y + sneak, z, a.yaw, 0, a.yaw, a.pitch,
        a.limbSwing, a.limbAmount, a.age, Math.max(4, light), 0, 1, 0,
      );
    }
  }
}
