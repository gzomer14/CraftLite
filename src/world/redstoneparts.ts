/**
 * Comparador e observador (M15): as contas, fora de `redstone.ts`.
 *
 * O circuito do M7 dizia "não há comparador nem observador — complexidade que
 * o alvo não paga". O M15 os pede para o circuito mexer em item: o comparador
 * lê quanto tem num baú, o observador percebe que um bloco mudou. O que entra
 * aqui é a regra de cada um, como função de número; quem escreve no mundo,
 * agenda e emite continua sendo o `Redstone`, que fica com os ganchos.
 *
 * **Simplificações conscientes**, pelo mesmo motivo do módulo do circuito: o
 * comparador lê o contêiner **encostado** atrás (o gênero também lê através de
 * um bloco sólido), e as laterais aceitam qualquer emissor, não só pó,
 * repetidor, comparador e bloco de redstone.
 */

import { stateBitsOf } from '../data/blocks';

/** O que o comparador precisa do circuito para decidir a saída. */
export interface ComparatorInputs {
  /**
   * Sinal do contêiner em `(x, y, z)`, 0..15, ou −1 se ali não há contêiner.
   * Quem responde é a camada de jogo (`game/itemflow.ts`), que conhece o conteúdo.
   */
  containerSignal(x: number, y: number, z: number): number;
  /** Energia que chega a `(x, y, z)` vinda do vizinho na direção `fromDir`. */
  powerFrom(x: number, y: number, z: number, fromDir: number): number;
}

/** Passo de cada direção horizontal (`FACING_STEP`): +X, −X, +Z, −Z. */
const STEP_X = [1, -1, 0, 0];
const STEP_Z = [0, 0, 1, -1];
/** As duas laterais de cada direção horizontal. */
const SIDES: readonly (readonly [number, number])[] = [[2, 3], [2, 3], [0, 1], [0, 1]];

/**
 * Força da saída de um comparador em `(x, y, z)` virado para `facing`
 * (0..3, a direção da **saída**). Modo comparação: repete a entrada de trás
 * se ela não for menor que a maior lateral. Modo subtração: trás − lateral.
 */
export function comparatorOutput(
  inputs: ComparatorInputs, x: number, y: number, z: number, facing: number, subtract: boolean,
): number {
  const backDir = facing ^ 1;
  const bx = x + STEP_X[backDir];
  const bz = z + STEP_Z[backDir];
  const signal = inputs.containerSignal(bx, y, bz);
  const back = signal >= 0 ? signal : inputs.powerFrom(x, y, z, backDir);

  const [a, b] = SIDES[facing];
  const side = Math.max(inputs.powerFrom(x, y, z, a), inputs.powerFrom(x, y, z, b));

  if (subtract) return Math.max(0, back - side);
  return back >= side ? back : 0;
}

/** Força guardada nos bits 2..5 do comparador. */
export function comparatorPower(state: number): number {
  return (stateBitsOf(state) >> 2) & 15;
}

/**
 * Sinal de um contêiner pela ocupação (a fórmula do gênero): 0 vazio, 1 com
 * qualquer item, 15 cheio. `fullness` é a soma de `count / maxStack` dos
 * slots, dividida pelo número de slots.
 */
export function signalOfFullness(fullness: number, anyItem: boolean): number {
  if (!anyItem) return 0;
  return Math.min(15, 1 + Math.floor(fullness * 14));
}

/**
 * true se o observador em `(ox, oy, oz)`, com a cara para `front`
 * (`PISTON_STEP`), está vigiando a posição `(x, y, z)`.
 */
export function observerWatches(
  ox: number, oy: number, oz: number, front: number, x: number, y: number, z: number,
): boolean {
  switch (front) {
    case 0: return x === ox + 1 && y === oy && z === oz;
    case 1: return x === ox - 1 && y === oy && z === oz;
    case 2: return x === ox && y === oy && z === oz + 1;
    case 3: return x === ox && y === oy && z === oz - 1;
    case 4: return x === ox && y === oy + 1 && z === oz;
    default: return x === ox && y === oy - 1 && z === oz;
  }
}

/** Ticks que o pulso do observador dura (um tick de redstone do gênero). */
export const OBSERVER_PULSE = 2;
/** Atraso do comparador, igual ao do repetidor mais rápido. */
export const COMPARATOR_DELAY = 2;
