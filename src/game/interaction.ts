/**
 * Quebrar e colocar blocos (doc 06 §4 e §5).
 *
 * A fórmula de progresso é copiada literalmente do doc porque é ela que define
 * quanto tempo cada bloco leva com cada ferramenta — o principal indicador de
 * progressão do jogo. Trocar `/30` por `/32` já muda a sensação de "picareta de
 * pedra vale a pena".
 */

import { defOf, makeState, stateBitsOf, AIR, type BlockDef } from '../data/blocks';
import { EFFICIENCY } from '../data/enchants';
import { efficiencyBonus, levelOf } from './enchanting';
import { stackTool, type ItemStack, type ToolSpec } from '../data/items';
import { createAabb, isSpaceBlocked, setAabbFromBase } from '../world/physics';
import { raycast, type RayHit } from '../world/raycast';
import type { Player } from '../entity/player';
import type { World } from '../world/world';
import { forwardFrom, createVec3 } from '../core/math';

/** Estágios de rachadura desenhados sobre o bloco (doc 06 §4). */
export const BREAK_STAGES = 10;
/** Cooldown de colocação, em ticks. Sem ele, segurar o botão põe 20 blocos/s. */
const PLACE_COOLDOWN = 4;

/**
 * Progresso de quebra por tick, em fração do total (quebra quando ≥ 1).
 *
 * `canHarvest` decide entre `/30` e `/100`: quebrar pedra sem picareta leva
 * mais que o triplo do tempo **e** não dropa nada.
 *
 * `efficiency` é o nível do encantamento; ele só soma **com a ferramenta
 * certa** (doc 06 §7), senão uma picareta de diamante encantada quebraria lã
 * mais rápido que a tesoura.
 */
export function breakProgressPerTick(
  block: BlockDef, tool: ToolSpec | undefined, onGround: boolean, inWater: boolean,
  efficiency = 0,
): number {
  if (block.hardness < 0) return 0; // inquebrável

  let speed = 1;
  const correctTool = tool !== undefined && tool.kind === block.tool;
  if (correctTool) speed = tool.speed + efficiencyBonus(efficiency);

  if (inWater) speed /= 5;
  if (!onGround) speed /= 5;

  if (block.hardness === 0) return 1; // flores, tocha: quebram no primeiro tick

  const harvest = canHarvest(block, tool);
  return speed / block.hardness / (harvest ? 30 : 100);
}

/** true se o bloco vai dropar alguma coisa com a ferramenta em mãos. */
export function canHarvest(block: BlockDef, tool: ToolSpec | undefined): boolean {
  if (!block.requiresTool) return true;
  if (tool === undefined) return false;
  return tool.kind === block.tool && tool.tier >= block.minTier;
}

/** Segundos para quebrar, útil para tooltips e testes. */
export function breakTimeSeconds(
  block: BlockDef, tool: ToolSpec | undefined, onGround = true, inWater = false,
  efficiency = 0,
): number {
  const perTick = breakProgressPerTick(block, tool, onGround, inWater, efficiency);
  if (perTick <= 0) return Infinity;
  return Math.ceil(1 / perTick) / 20;
}

export interface InteractionState {
  /** Bloco mirado, ou `null` se não há nada no alcance. */
  target: RayHit | null;
  /** 0..1 do bloco sendo quebrado. */
  progress: number;
  /** 0..9, ou −1 se não está quebrando. */
  stage: number;
  breakingX: number;
  breakingY: number;
  breakingZ: number;
}

const forward = createVec3();

export class Interaction {
  private readonly world: World;
  private readonly player: Player;
  private readonly lighting: { onBlockChanged: (x: number, y: number, z: number, prev: number, next: number) => void };

  readonly state: InteractionState = {
    target: null, progress: 0, stage: -1, breakingX: 0, breakingY: 0, breakingZ: 0,
  };

  private placeCooldown = 0;
  private breakingActive = false;

  /** Chamado quando um bloco é quebrado — o M4 pluga drops aqui. */
  onBlockBroken: ((x: number, y: number, z: number, state: number) => void) | null = null;
  onBlockPlaced: ((x: number, y: number, z: number, state: number) => void) | null = null;

  constructor(
    world: World,
    player: Player,
    lighting: { onBlockChanged: (x: number, y: number, z: number, prev: number, next: number) => void },
  ) {
    this.world = world;
    this.player = player;
    this.lighting = lighting;
  }

  /** Atualiza o bloco mirado usando a direção da câmera. Chamado todo tick. */
  updateTarget(): void {
    const player = this.player;
    forwardFrom(forward, player.yaw, player.pitch);
    this.updateTargetAlong(forward[0], forward[1], forward[2]);
  }

  /**
   * Idem, mas com uma direção arbitrária. É o que o Modo A de toque usa: o
   * raio parte do dedo, não do centro da tela (doc 09 §2.2).
   */
  updateTargetAlong(dx: number, dy: number, dz: number): void {
    const player = this.player;
    const hit = raycast(
      this.world,
      player.x, player.y + player.eyeHeight, player.z,
      dx, dy, dz,
      player.reach,
    );
    this.state.target = hit.hit ? hit : null;
  }

  /**
   * Um tick de "segurando o botão de quebrar". Soltar o botão ou trocar de
   * alvo zera o progresso (doc 06 §4).
   */
  tickBreaking(holding: boolean, held: ItemStack | null): void {
    const s = this.state;
    if (this.placeCooldown > 0) this.placeCooldown--;

    if (!holding || s.target === null) {
      this.resetBreaking();
      return;
    }

    const target = s.target;
    const sameBlock = this.breakingActive
      && target.x === s.breakingX && target.y === s.breakingY && target.z === s.breakingZ;

    if (!sameBlock) {
      s.progress = 0;
      s.breakingX = target.x;
      s.breakingY = target.y;
      s.breakingZ = target.z;
      this.breakingActive = true;
    }

    const block = defOf(target.state);
    if (this.player.mode === 'creative') {
      this.breakBlock(target.x, target.y, target.z);
      this.resetBreaking();
      return;
    }

    const perTick = breakProgressPerTick(
      block, stackTool(held), this.player.onGround, this.player.inWater,
      levelOf(held, EFFICIENCY),
    );
    if (perTick <= 0) {
      s.stage = -1;
      return;
    }

    s.progress += perTick;
    if (s.progress >= 1) {
      this.breakBlock(target.x, target.y, target.z);
      this.resetBreaking();
      return;
    }
    s.stage = Math.min(BREAK_STAGES - 1, Math.floor(s.progress * BREAK_STAGES));
  }

  private resetBreaking(): void {
    this.state.progress = 0;
    this.state.stage = -1;
    this.breakingActive = false;
  }

  private breakBlock(x: number, y: number, z: number): void {
    const previous = this.world.getBlock(x, y, z);
    if (previous === AIR) return;
    if (!this.world.setBlock(x, y, z, AIR, 'player')) return;
    this.lighting.onBlockChanged(x, y, z, previous, AIR);
    this.onBlockBroken?.(x, y, z, previous);
  }

  /**
   * Coloca o bloco da mão na face mirada.
   * Devolve true se colocou — o chamador consome o item.
   */
  tryPlace(held: ItemStack | null): boolean {
    if (this.placeCooldown > 0) return false;
    const target = this.state.target;
    if (target === null || held === null) return false;

    const blockId = blockIdForItem(held.item);
    if (blockId === undefined) return false;

    // Bloco substituível (grama alta, neve, água) recebe no próprio lugar.
    const targetDef = defOf(target.state);
    let px = target.x;
    let py = target.y;
    let pz = target.z;
    if (!targetDef.replaceable) {
      px += target.nx;
      py += target.ny;
      pz += target.nz;
    }

    const existing = defOf(this.world.getBlock(px, py, pz));
    if (!existing.replaceable && existing.shape !== 'none') return false;

    // Não deixar o jogador se emparedar dentro de si mesmo.
    if (this.intersectsPlayer(px, py, pz)) return false;

    const state = makeState(blockId, this.stateForPlacement(blockId, target));
    if (!this.world.setBlock(px, py, pz, state, 'player')) return false;

    this.lighting.onBlockChanged(px, py, pz, AIR, state);
    this.onBlockPlaced?.(px, py, pz, state);
    this.placeCooldown = PLACE_COOLDOWN;
    return true;
  }

  /**
   * Rotação automática ao colocar (doc 06 §5).
   *
   * Tronco pega o eixo da face clicada; escada, portão, porta, placa e quadro
   * pegam a direção do olhar; laje e alçapão pegam a metade em que o clique
   * caiu; escada de mão e quadro grudam na parede clicada. É tudo derivado do
   * `shape` da tabela — nenhum bloco tem caso próprio aqui.
   */
  private stateForPlacement(blockId: number, hit: RayHit): number {
    const def = defOf(makeState(blockId));
    if (def.name.endsWith('_log')) {
      if (hit.ny !== 0) return 0; // eixo Y
      if (hit.nx !== 0) return 1; // eixo X
      return 2; // eixo Z
    }

    const shape = def.shape;
    if (shape === 'slab' || shape === 'trapdoor') {
      // Metade de cima quando o clique veio por baixo ou na parte alta da face.
      const upperHalf = hit.ny < 0 || (hit.ny === 0 && hit.py - Math.floor(hit.py) > 0.5);
      return shape === 'slab' ? (upperHalf ? 1 : 0) : facingFromYaw(this.player.yaw) | (upperHalf ? 4 : 0);
    }
    if (shape === 'ladder' || shape === 'painting') {
      // Gruda na parede clicada: a face oposta à normal do acerto.
      if (hit.nx > 0) return 1;
      if (hit.nx < 0) return 0;
      if (hit.nz > 0) return 3;
      if (hit.nz < 0) return 2;
      return facingFromYaw(this.player.yaw);
    }
    if (shape === 'stairs' || shape === 'fence_gate' || shape === 'door' || shape === 'sign') {
      return facingFromYaw(this.player.yaw);
    }
    return 0;
  }

  private intersectsPlayer(x: number, y: number, z: number): boolean {
    setAabbFromBase(PLACE_BOX, x + 0.5, y, z + 0.5, 1, 1);
    return aabbOverlap(PLACE_BOX, this.player.aabb);
  }
}

const PLACE_BOX = createAabb();

function aabbOverlap(a: Float32Array, b: Float32Array): boolean {
  return a[0] < b[3] && a[3] > b[0]
    && a[1] < b[4] && a[4] > b[1]
    && a[2] < b[5] && a[5] > b[2];
}

/** Itens de bloco têm `itemId === blockId` (ver doc 05 e `data/items.ts`). */
function blockIdForItem(itemId: number): number | undefined {
  const def = defOf(makeState(itemId));
  return def.id === itemId && itemId !== AIR ? itemId : undefined;
}

/**
 * Direção para onde o jogador olha, nos bits de `FACING_STEP`
 * (0 = +X, 1 = −X, 2 = +Z, 3 = −Z).
 *
 * O bloco fica de frente para quem colocou, que é o que a mão espera: colocar
 * uma escada e ela subir na direção contrária seria irritante toda vez.
 */
export function facingFromYaw(yaw: number): number {
  const dx = -Math.sin(yaw);
  const dz = Math.cos(yaw);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 0 : 1;
  return dz > 0 ? 2 : 3;
}

/**
 * Alterna porta, portão ou alçapão (bit 2 ou 3 do estado).
 * Devolve o estado novo, ou −1 se o bloco não abre.
 */
export function toggleOpenState(state: number): number {
  const def = defOf(state);
  const bits = stateBitsOf(state);
  if (def.shape === 'door' || def.shape === 'fence_gate') {
    return makeState(def.id, bits ^ 4);
  }
  if (def.shape === 'trapdoor') return makeState(def.id, bits ^ 8);
  return -1;
}

/** Reexportado para o renderer desenhar a caixa de seleção. */
export { isSpaceBlocked };
