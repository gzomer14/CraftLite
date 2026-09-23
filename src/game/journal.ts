/**
 * O caderno do explorador (M10): o mapa explorado, os marcadores e as
 * estatísticas — tudo o que diz ao jogador **onde ele está e por onde andou**.
 *
 * Um objeto só na `Session`, com um `tick`: ela já passa das 700 linhas, e as
 * três peças andam juntas (a morte conta na estatística e marca o mapa).
 */

import { dimensionOf } from '../data/dimensions';
import { Markers } from './markers';
import { Stats } from './stats';
import { WorldMap } from './worldmap';
import type { Player } from '../entity/player';
import type { World } from '../world/world';

/** Deslocamento num tick acima disto é teletransporte, não caminhada. */
const TELEPORT = 5;

export class Journal {
  readonly map = new WorldMap();
  readonly markers = new Markers();
  readonly stats = new Stats();
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;
  private tracking = false;
  private ticks = 0;

  /**
   * Um tick: tempo de jogo, distância percorrida e, a cada dois, um passo do
   * mapa. Um chunk a cada dois ticks renova o anel inteiro em ~8 s — o jogador
   * correndo anda 45 blocos nisso, e a borda do anel está a 64 à frente — e
   * deixa o mapa em ~0,3 ms por segundo de jogo no desktop, com folga para o
   * celular fraco caber no 1 ms do doc 14.
   */
  tick(world: World, player: Player, riding: boolean): void {
    this.stats.add('play_time');
    this.trackDistance(player, riding);
    if ((this.ticks++ & 1) === 0 && dimensionOf(world.dimension).hasSky) {
      this.map.explore(world, player.x, player.z);
    }
  }

  /** Jogador morreu no Sobrevivência: conta, e marca onde o inventário caiu. */
  onDeath(player: Player, dimension: number): void {
    this.stats.add('deaths');
    this.markers.setDeath(player.x, player.y, player.z, dimension);
    this.tracking = false;
  }

  /** Renasceu, atravessou portal, carregou o save: a próxima posição é nova. */
  resetTracking(): void {
    this.tracking = false;
  }

  private trackDistance(player: Player, riding: boolean): void {
    const dx = player.x - this.lastX;
    const dy = player.y - this.lastY;
    const dz = player.z - this.lastZ;
    this.lastX = player.x;
    this.lastY = player.y;
    this.lastZ = player.z;
    if (!this.tracking) { this.tracking = true; return; }
    const flat = Math.hypot(dx, dz);
    if (flat > TELEPORT || Math.abs(dy) > TELEPORT) return;
    if (riding) this.stats.add('ride', flat);
    else if (player.flying) this.stats.add('fly', Math.hypot(flat, dy));
    else if (player.inWater) this.stats.add('swim', Math.hypot(flat, dy));
    else if (flat > 0) this.stats.add('walk', flat);
  }
}
