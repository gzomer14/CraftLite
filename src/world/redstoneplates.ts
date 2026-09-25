/**
 * Placas de pressão (M7; saíram de `redstone.ts` no M18).
 *
 * Varredura por tick: a sessão marca a posição de cada entidade e o diff com
 * o tick anterior liga e desliga as placas. Não há registro de placas no mundo
 * — quem pisa é que é procurado. Uma roça de mil placas custa zero enquanto
 * ninguém andar nelas.
 */

import { blockIdOf, makeState, stateBitsOf } from '../data/blocks';
import {
  FOOT_EPSILON, KIND_PLATE, ROLES, positionKey, xOfKey, yOfKey, zOfKey, type CircuitWriter,
} from './redstoneroles';

export class PressurePlates {
  private readonly host: CircuitWriter;
  /** Posições de placa com alguém em cima, e o conjunto do tick anterior. */
  private pressed = new Set<number>();
  private scanning = new Set<number>();

  constructor(host: CircuitWriter) {
    this.host = host;
  }

  /**
   * Varredura de placas do tick: a sessão marca a posição de cada entidade e o
   * diff com o tick anterior liga e desliga as placas.
   *
   * Não há registro de placas no mundo — quem pisa é que é procurado. Uma roça
   * de mil placas custa zero enquanto ninguém andar nelas.
   */
  begin(): void {
    this.scanning.clear();
  }

  /**
   * Marca o bloco em que a entidade pisa; ignora o que não for placa.
   *
   * O `+ FOOT_EPSILON` no Y não é frescura: a resolução de colisão pousa o pé
   * um décimo de milésimo **abaixo** do topo do bloco (ver `TOUCH_EPSILON` em
   * `physics.ts`), e sem a folga um `Math.floor` cairia no bloco de baixo e a
   * placa nunca afundaria.
   */
  mark(x: number, y: number, z: number): void {
    const bx = Math.floor(x);
    const by = Math.floor(y + FOOT_EPSILON);
    const bz = Math.floor(z);
    if (ROLES.kind[blockIdOf(this.host.world.getBlock(bx, by, bz))] !== KIND_PLATE) return;
    this.scanning.add(positionKey(bx, by, bz));
  }

  end(): void {
    for (const key of this.scanning) {
      if (!this.pressed.has(key)) this.setPlate(key, true);
    }
    for (const key of this.pressed) {
      if (!this.scanning.has(key)) this.setPlate(key, false);
    }
    const previous = this.pressed;
    this.pressed = this.scanning;
    this.scanning = previous;
  }

  private setPlate(key: number, down: boolean): void {
    const x = xOfKey(key);
    const y = yOfKey(key);
    const z = zOfKey(key);
    const state = this.host.world.getBlock(x, y, z);
    const id = blockIdOf(state);
    if (ROLES.kind[id] !== KIND_PLATE) return;
    const bits = stateBitsOf(state);
    if (((bits & 1) !== 0) === down) return;
    this.host.replace(x, y, z, makeState(id, down ? bits | 1 : bits & ~1));
    this.host.onSound('block/click', x, y, z);
  }
}
