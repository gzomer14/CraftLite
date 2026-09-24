/**
 * A linha de pesca do jogador (M14): uma boia só, como no gênero.
 *
 * Quatro estados. **Voando**: saiu da vara, com gravidade e arrasto. **Na
 * água**: boia na superfície, e um relógio sorteia quando o peixe morde.
 * **Fisgada**: por `BITE_TICKS` a boia afunda — é a janela para puxar. **No
 * chão**: bateu em bloco e parou; puxar só recolhe.
 *
 * A linha arrebenta se o jogador se afasta demais ou larga a vara. Quem decide
 * o que vem no anzol é `data/fishing.ts`; quem dá o item e o XP é o uso de item
 * (`game/itemuse.ts`), que é quem sabe do inventário.
 */

import { defOf } from '../data/blocks';
import {
  BITE_TICKS, BITE_WAIT_MAX, BITE_WAIT_MIN, CAST_SPEED, MAX_LINE, RAIN_WAIT_FACTOR, rollCatch,
} from '../data/fishing';
import type { World } from '../world/world';

export const LINE_IDLE = 0;
export const LINE_FLYING = 1;
export const LINE_WATER = 2;
export const LINE_GROUND = 3;

const GRAVITY = -0.04;
const DRAG = 0.92;
/** A boia fica com a base um décimo abaixo da superfície. */
const FLOAT_DEPTH = 0.1;
/** Quanto a boia afunda na fisgada. */
const BITE_DIP = 0.3;
/** Subpassos do voo: a boia não atravessa um bloco de canto. */
const SUBSTEPS = 3;

export class FishingLine {
  state = LINE_IDLE;
  x = 0; y = 0; z = 0;
  prevX = 0; prevY = 0; prevZ = 0;
  private vx = 0; private vy = 0; private vz = 0;
  /** Ticks até o peixe morder (na água). */
  wait = 0;
  /** Ticks de fisgada que sobram; > 0 = dá para puxar. */
  bite = 0;
  /** Idade da boia na água, para o balanço. */
  private floatAge = 0;

  /** O peixe mordeu: quem ouve toca o som e solta o respingo. */
  onBite: ((x: number, y: number, z: number) => void) | null = null;
  /** A boia caiu na água. */
  onSplash: ((x: number, y: number, z: number) => void) | null = null;

  get active(): boolean {
    return this.state !== LINE_IDLE;
  }

  /** Arremessa da posição `(x, y, z)` na direção `(dx, dy, dz)` normalizada. */
  cast(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    this.state = LINE_FLYING;
    this.x = x; this.y = y; this.z = z;
    this.prevX = x; this.prevY = y; this.prevZ = z;
    // Um pouco para cima: arremesso de vara é arco, não tiro.
    this.vx = dx * CAST_SPEED;
    this.vy = dy * CAST_SPEED + 0.15;
    this.vz = dz * CAST_SPEED;
    this.bite = 0;
    this.wait = 0;
  }

  /** Recolhe a linha, sem nada. */
  retract(): void {
    this.state = LINE_IDLE;
    this.bite = 0;
  }

  /**
   * Um tick. `holding` = a vara ainda está na mão; `rain` 0..1; `random` em
   * 0..1 — da `Session`, para o teste poder fixar.
   */
  tick(
    world: World, playerX: number, playerY: number, playerZ: number,
    holding: boolean, rain: number, random: () => number,
  ): void {
    if (this.state === LINE_IDLE) return;
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;

    const dx = this.x - playerX;
    const dy = this.y - playerY;
    const dz = this.z - playerZ;
    if (!holding || dx * dx + dy * dy + dz * dz > MAX_LINE * MAX_LINE) {
      this.retract();
      return;
    }

    if (this.state === LINE_FLYING) this.fly(world, random, rain);
    else if (this.state === LINE_WATER) this.float(world, random, rain);
  }

  private fly(world: World, random: () => number, rain: number): void {
    this.vy += GRAVITY;
    this.vx *= DRAG; this.vy *= DRAG; this.vz *= DRAG;
    for (let s = 0; s < SUBSTEPS; s++) {
      const nx = this.x + this.vx / SUBSTEPS;
      const ny = this.y + this.vy / SUBSTEPS;
      const nz = this.z + this.vz / SUBSTEPS;
      const def = defOf(world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz)));
      if (def.name === 'water') {
        this.x = nx; this.y = ny; this.z = nz;
        this.enterWater(world, random, rain);
        return;
      }
      if (def.solid) {
        this.state = LINE_GROUND;
        return;
      }
      this.x = nx; this.y = ny; this.z = nz;
      if (this.y < -8) { this.retract(); return; }
    }
  }

  private enterWater(world: World, random: () => number, rain: number): void {
    this.state = LINE_WATER;
    this.floatAge = 0;
    this.y = this.surface(world, Math.floor(this.y)) - FLOAT_DEPTH;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.wait = this.rollWait(random, rain);
    this.onSplash?.(this.x, this.y, this.z);
  }

  /** Cota da superfície da água que contém `y`, subindo pela coluna. */
  private surface(world: World, y: number): number {
    const bx = Math.floor(this.x);
    const bz = Math.floor(this.z);
    let top = y;
    while (top < y + 32 && defOf(world.getBlock(bx, top + 1, bz)).name === 'water') top++;
    return top + 1;
  }

  private float(world: World, random: () => number, rain: number): void {
    // A água sumiu debaixo da boia (balde, bloco): ela volta a cair.
    const here = defOf(world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)));
    if (here.name !== 'water') {
      this.state = LINE_FLYING;
      return;
    }
    this.floatAge++;
    const rest = this.surface(world, Math.floor(this.y)) - FLOAT_DEPTH;
    if (this.bite > 0) {
      this.bite--;
      this.y = rest - BITE_DIP;
      if (this.bite === 0) this.wait = this.rollWait(random, rain);
      return;
    }
    this.y = rest + Math.sin(this.floatAge * 0.15) * 0.03;
    if (--this.wait <= 0) {
      this.bite = BITE_TICKS;
      this.onBite?.(this.x, rest, this.z);
    }
  }

  private rollWait(random: () => number, rain: number): number {
    const base = BITE_WAIT_MIN + Math.floor(random() * (BITE_WAIT_MAX - BITE_WAIT_MIN + 1));
    return Math.max(1, Math.round(base * (rain > 0.3 ? RAIN_WAIT_FACTOR : 1)));
  }

  /**
   * Puxa a linha. Devolve o nome do item que veio no anzol, ou `null` se não
   * havia peixe mordendo. A linha volta para a vara nos dois casos.
   */
  reel(random: () => number): string | null {
    const caught = this.state === LINE_WATER && this.bite > 0 ? rollCatch(random()) : null;
    this.retract();
    return caught;
  }

  /** Posição interpolada da boia, para o render. */
  renderX(alpha: number): number { return this.prevX + (this.x - this.prevX) * alpha; }
  renderY(alpha: number): number { return this.prevY + (this.y - this.prevY) * alpha; }
  renderZ(alpha: number): number { return this.prevZ + (this.z - this.prevZ) * alpha; }
}
