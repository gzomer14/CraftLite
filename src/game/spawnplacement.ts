/**
 * Onde o jogador entra no mundo, e quando a física pode começar (doc 11 §2).
 *
 * Módulo próprio, e não uma função solta no `main.ts`, porque ele decide se o
 * jogador guarda a posição que veio do save — e isso precisava de teste: o
 * `main.ts` chama `boot()` no topo e não pode ser importado por um teste.
 */

import { defOf } from '../data/blocks';
import { SEA_LEVEL, WORLD_HEIGHT } from '../world/chunk';
import type { World } from '../world/world';
import type { Player } from '../entity/player';

/** Coluna do mundo em que o jogador está. */
function columnOf(player: Player): { cx: number; cz: number } {
  return { cx: Math.floor(player.x) >> 4, cz: Math.floor(player.z) >> 4 };
}

/**
 * Segura a simulação até existir chão sob o jogador e, **em mundo novo**, o põe
 * em cima dele. Devolve true quando o jogo pode começar a simular.
 *
 * `restored` é o caminho do save, e nele a posição **não pode ser tocada**: ela
 * veio do disco. Antes esta função reposicionava sempre, então sair do mundo e
 * voltar teletransportava o jogador para o ponto onde a partida começou — a
 * coluna (0,0) — por mais longe que ele tivesse construído (relato de campo
 * 2026-09-12).
 *
 * A espera vale nos dois casos: sem a coluna carregada o jogador cai pelo vazio
 * antes de o chão chegar.
 */
export function trySpawn(world: World, player: Player, restored: boolean): boolean {
  if (restored) {
    const { cx, cz } = columnOf(player);
    return world.getChunk(cx, cz) !== undefined;
  }
  // A coluna é a do ponto de nascimento, onde o jogador já foi posto antes do
  // primeiro chunk chegar (`world/gen/spawnsearch.ts`); era sempre a (0, 0).
  const x = Math.floor(player.x);
  const z = Math.floor(player.z);
  const chunk = world.getChunk(x >> 4, z >> 4);
  if (chunk === undefined) return false;
  const height = chunk.heightMap[((z & 15) << 4) | (x & 15)];
  if (height <= 0) return false;
  player.setPosition(x + 0.5, freeStandY(world, x, Math.max(height + 1, SEA_LEVEL + 1), z), z + 0.5);
  return true;
}

/**
 * Primeira altura, a partir de `y` para cima, com pés e cabeça fora de bloco
 * sólido. O mapa de altura diz onde está o topo, mas é a última defesa contra
 * nascer dentro de um tronco (relato de campo 2026-09-23: renascer "dentro da
 * árvore tomando dano").
 */
export function freeStandY(world: World, x: number, y: number, z: number): number {
  let feet = Math.max(1, Math.floor(y));
  while (feet < WORLD_HEIGHT - 2
    && (defOf(world.getBlock(x, feet, z)).solid || defOf(world.getBlock(x, feet + 1, z)).solid)) feet++;
  return feet;
}
