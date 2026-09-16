/**
 * Efeitos de ambiente sorteados perto do jogador (M8).
 *
 * A tocha ganhou geometria de poste com a brasa no topo, e um poste parado não
 * lê como "aceso". Falta o movimento — e movimento, aqui, é uma fagulha de vez
 * em quando saindo da ponta.
 *
 * O jeito caro de fazer isto é manter uma lista de todas as tochas carregadas e
 * percorrê-la. O jeito do gênero, que é o daqui, é **sortear**: algumas
 * posições por tick num cubo em volta do jogador, e quem calhar de ser tocha
 * solta fagulha. O custo é fixo — não cresce com o tamanho do mundo nem com
 * quantas tochas o jogador plantou —, e o resultado é indistinguível, porque
 * ninguém olha para todas as tochas ao mesmo tempo.
 *
 * O sorteio é o único lugar do jogo que usa `Math.random` de propósito em vez
 * de `rngAt`: fagulha não é estado de mundo, não vai para o save e não precisa
 * ser a mesma na próxima partida (doc: determinismo vale para o que é simulado).
 */

import { defOf } from '../data/blocks';
import {
  FACING_STEP, MOUNT_FLOOR, TORCH_FLOOR_TOP, TORCH_WALL_TOP, TORCH_WALL_Y1,
} from '../world/mesh/shapes';
import type { World } from '../world/world';

/** Raio do cubo sorteado, em blocos. Além disso a fagulha não se vê. */
export const SPARK_RADIUS = 8;

/**
 * Sorteia `samples` posições e chama `emit` na ponta de cada tocha acesa.
 *
 * `random` é injetável para o teste poder varrer posições conhecidas em vez de
 * torcer pela sorte.
 */
export function emitTorchSparks(
  world: World, px: number, py: number, pz: number, samples: number,
  emit: (x: number, y: number, z: number) => void,
  random: () => number = Math.random,
): number {
  if (samples <= 0) return 0;
  const bx = Math.floor(px);
  const by = Math.floor(py);
  const bz = Math.floor(pz);
  const span = SPARK_RADIUS * 2 + 1;
  let count = 0;

  for (let i = 0; i < samples; i++) {
    const x = bx + Math.floor(random() * span) - SPARK_RADIUS;
    const y = by + Math.floor(random() * span) - SPARK_RADIUS;
    const z = bz + Math.floor(random() * span) - SPARK_RADIUS;
    const state = world.getBlock(x, y, z);
    const def = defOf(state);
    // Tocha apagada não solta fagulha: é a emissão que separa as duas de
    // redstone, e é ela que a tabela já guarda.
    if (def.shape !== 'torch' || def.emission === 0) continue;

    const mount = (state >>> 10) & 7;
    if (mount === MOUNT_FLOOR || mount > 3) {
      emit(x + 0.5, y + TORCH_FLOOR_TOP, z + 0.5);
    } else {
      const step = FACING_STEP[mount];
      emit(
        x + 0.5 + step[0] * TORCH_WALL_TOP,
        y + TORCH_WALL_Y1,
        z + 0.5 + step[1] * TORCH_WALL_TOP,
      );
    }
    count++;
  }
  return count;
}
