/**
 * Trocar de dimensão (saiu de `session.ts` no M18): o que fica para trás, o
 * que atravessa com o jogador, e o que acontece ao chegar do outro lado.
 */

import { DIM_OVERWORLD, dimensionOf } from '../data/dimensions';
import type { Session, SessionEvents } from './session';
import type { TravelRoute } from './travel';

/**
 * Entra numa dimensão sem portal: usado pelo save ao restaurar o mundo e pelo
 * renascimento. Quem troca pipeline, save e céu é quem ouve o evento.
 */
export function enterDimension(
  s: Session, events: SessionEvents, dimension: number, x?: number, z?: number,
): void {
  if (dimension === s.world.dimension) return;
  /*
   * O evento vem **antes** da limpeza de propósito: quem ouve precisa ler
   * baús e veículos que ainda são desta dimensão para gravá-los. Invertendo a
   * ordem, o save encontraria as listas já vazias — e todo baú do Nether
   * sumiria ao voltar para casa.
   */
  // A vida do dragão fica guardada antes de os mobs do End saírem (M16).
  s.dragonFight.remember();
  s.dragonFight.onDimensionChange();
  events.onDimensionChange?.(dimension);
  clearForDimension(s);
  s.world.dimension = dimension;
  // Sem céu não chove: `hasSky` da tabela de dimensões existia desde o M7 e
  // ninguém a lia, então chovia no Nether — debaixo de um teto de rocha-mãe.
  s.weather.hasSky = dimensionOf(dimension).hasSky;
  /*
   * Quem chega por portal já sabe onde vai cair, e precisa estar lá **antes**
   * do próximo `pipeline.setCenter` — é a posição do jogador que decide onde
   * o mundo novo nasce. O Y é o de agora; o definitivo vem de `arriveAt`
   * quando o chunk chega. Renascimento e restauração do save não passam
   * coordenadas: eles posicionam o jogador por conta própria.
   */
  if (x !== undefined && z !== undefined) {
    s.player.setPosition(x + 0.5, s.player.y, z + 0.5);
  }
}

/** O jogador saiu do outro lado de um portal: conquista e, na volta do End, créditos. */
export function arrived(s: Session, events: SessionEvents, route: TravelRoute): void {
  // O portal de passagem (M19) não troca de dimensão: nada a contar.
  if (route === 'gateway') return;
  if (route === 'end_in') {
    // A plataforma fica a leste da ilha: chega olhando para ela.
    s.player.yaw = -Math.PI / 2;
    s.player.pitch = 0;
    s.achievements.event('enter_end');
    return;
  }
  if (route === 'end_out') {
    if (s.dragonFight.state.killed && !s.dragonFight.state.creditsSeen) {
      s.dragonFight.state.creditsSeen = true;
      events.onCredits?.();
    }
    return;
  }
  s.achievements.event(
    s.world.dimension === DIM_OVERWORLD ? 'return_overworld' : 'enter_nether',
  );
}

/**
 * Esvazia o que é da dimensão que está sendo deixada.
 *
 * Mob, item no chão, orbe, barco, flecha e contêiner vivem em coordenadas —
 * e as coordenadas do outro lado são de outro mundo. Inventário, vida, XP e
 * conquistas são do **jogador** e atravessam com ele.
 */
function clearForDimension(s: Session): void {
  s.mobs.clear();
  s.items.clear();
  s.orbs.clear();
  s.projectiles.clear();
  s.falling.clear();
  s.vehicles.clear();
  s.tiles.clear();
  s.signs.clear();
  s.spawners.clear();
  s.workbench.closeScreen();
}
