/**
 * Quebrar e colocar blocos (doc 06 §4 e §5).
 *
 * A fórmula de progresso é copiada literalmente do doc porque é ela que define
 * quanto tempo cada bloco leva com cada ferramenta — o principal indicador de
 * progressão do jogo. Trocar `/30` por `/32` já muda a sensação de "picareta de
 * pedra vale a pena".
 */

import { defOf, makeState, stateBitsOf, AIR, type BlockDef } from '../data/blocks';
import { MOUNT_CEILING, MOUNT_FLOOR, PISTON_STEP } from '../world/mesh/shapes';
import { partnerOffset, placeMulti } from '../world/multiblock';
import { EFFICIENCY } from '../data/enchants';
import { efficiencyBonus, levelOf } from './enchanting';
import { itemDef, stackTool, type ItemStack, type ToolSpec } from '../data/items';
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
 * Ticks entre duas quebras **dentro do mesmo apertar de botão** (0,25 s).
 *
 * Sem ele, a quebra instantânea acontece **uma vez por tick**: no criativo um
 * clique de 150 ms — que é um clique normal — derrubava três blocos em fila, e
 * era impossível quebrar só um (relato de campo 2026-09-14). O mesmo valia no
 * sobrevivência para tudo que quebra em um tick: os 18 blocos de dureza zero
 * (grama alta, flores, mudas, cana) com a mão, e neve com pá.
 *
 * **Ele não atrasa a mineração normal.** O intervalo só gate a *conclusão* da
 * quebra, e o progresso continua correndo durante ele — qualquer bloco que
 * leve mais de 5 ticks (todos os comuns) nunca o encontra. O que ele limita é
 * exatamente o caso que o jogador não consegue controlar com o dedo.
 *
 * **Soltar o botão zera o intervalo.** Um clique é um bloco, e quem clica
 * rápido de propósito continua quebrando no ritmo que quiser — o limite é para
 * o botão segurado, não para a intenção do jogador.
 */
const BREAK_INTERVAL = 5;

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
  /** Ticks restantes até a próxima quebra poder acontecer. */
  private breakCooldown = 0;
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
      // O raio da interação enxerga planta, neve fina e fogo: é o que o
      // jogador mira. Linha de visão e explosão usam o padrão, que os ignora.
      { replaceable: true },
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
      // Soltar o botão zera o intervalo: um clique, um bloco.
      this.breakCooldown = 0;
      return;
    }
    if (this.breakCooldown > 0) this.breakCooldown--;

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
      // Instantânea continua instantânea; o que o intervalo limita é a fila.
      if (this.breakCooldown > 0) {
        s.stage = -1;
        return;
      }
      this.breakBlock(target.x, target.y, target.z);
      this.breakCooldown = BREAK_INTERVAL;
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
      /*
       * Pronto, mas ainda no intervalo: a rachadura fica cheia e o bloco cai no
       * tick em que o intervalo vencer. Só chega aqui o que quebra em menos de
       * 5 ticks — bloco comum termina muito depois de o intervalo ter passado.
       */
      if (this.breakCooldown > 0) {
        s.stage = BREAK_STAGES - 1;
        return;
      }
      this.breakBlock(target.x, target.y, target.z);
      this.breakCooldown = BREAK_INTERVAL;
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

    if (!this.canReplaceAt(px, py, pz)) return false;

    // Não deixar o jogador se emparedar dentro de si mesmo.
    if (this.intersectsPlayer(px, py, pz)) return false;

    const bits = this.stateForPlacement(blockId, target);
    if (bits < 0) return false;
    if (!this.hasSupport(blockId, bits, px, py, pz)) return false;

    const state = makeState(blockId, bits);
    /*
     * Porta e cama ocupam duas células (M8): as duas nascem na mesma chamada,
     * ou nenhuma nasce. A segunda célula passa pelo mesmo teste de "cabe aqui"
     * da primeira — é o que impede colocar uma porta com a folha de cima
     * dentro da parede, ou uma cama com a cabeceira dentro do jogador.
     */
    const partner = PARTNER_POS;
    const isMultiBlock = partnerCellOf(state, px, py, pz, partner);
    if (isMultiBlock && this.intersectsPlayer(partner[0], partner[1], partner[2])) return false;
    if (!placeMulti(this.world, px, py, pz, state, (ax, ay, az) => this.canReplaceAt(ax, ay, az))) {
      return false;
    }

    this.lighting.onBlockChanged(px, py, pz, AIR, state);
    this.onBlockPlaced?.(px, py, pz, state);
    if (isMultiBlock) {
      const other = this.world.getBlock(partner[0], partner[1], partner[2]);
      this.lighting.onBlockChanged(partner[0], partner[1], partner[2], AIR, other);
      this.onBlockPlaced?.(partner[0], partner[1], partner[2], other);
    }
    this.placeCooldown = PLACE_COOLDOWN;
    return true;
  }

  /** true se a célula aceita receber bloco novo. */
  private canReplaceAt(x: number, y: number, z: number): boolean {
    const existing = defOf(this.world.getBlock(x, y, z));
    return existing.replaceable || existing.shape === 'none';
  }

  /**
   * Rotação automática ao colocar (doc 06 §5).
   *
   * Tronco pega o eixo da face clicada; escada, portão, porta, placa e quadro
   * pegam a direção do olhar; laje e alçapão pegam a metade em que o clique
   * caiu; escada de mão, quadro e tocha grudam na parede clicada. É tudo
   * derivado do `shape` da tabela — nenhum bloco tem caso próprio aqui.
   *
   * Devolve **−1** quando a posição clicada não serve para aquele bloco: é o
   * caso da tocha no teto. Quem chama desiste da colocação.
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
    /*
     * A cama aponta para onde a **cabeceira** vai, que é para longe de quem
     * coloca: deitar de costas para a parede é o gesto natural, e é o que o
     * gênero faz.
     */
    if (shape === 'bed') return facing4FromLook(this.player.yaw);
    /*
     * Tocha: o mesmo encaixe de alavanca e botão, menos o teto. Tocha de
     * cabeça para baixo não existe no gênero, e a geometria de `mesh/complex.ts`
     * não a desenha — recusar a colocação é mais honesto que desenhar errado.
     */
    if (shape === 'torch') {
      const mount = mountFromNormal(hit.nx, hit.ny, hit.nz);
      return mount === MOUNT_CEILING ? -1 : mount;
    }
    // --- redstone (M7) ---------------------------------------------------
    if (shape === 'lever' || shape === 'button') {
      // Encaixa na superfície clicada: o apoio fica do lado oposto à normal.
      return mountFromNormal(hit.nx, hit.ny, hit.nz);
    }
    if (shape === 'repeater') return facing4FromLook(this.player.yaw);
    if (shape === 'piston') return facing6FromLook(this.player.yaw, this.player.pitch);
    return 0;
  }

  /**
   * true se o bloco tem o apoio que a tabela exige (doc 04 §3).
   *
   * Sem isto, pó e placa colocados no ar cairiam no tick seguinte — a checagem
   * de `world/redstone.ts` existe para o apoio que **some depois**, não para
   * deixar o jogador colocar errado de primeira.
   */
  private hasSupport(blockId: number, bits: number, x: number, y: number, z: number): boolean {
    const def = defOf(makeState(blockId));
    if (def.support === 'none') return true;
    let step: readonly [number, number, number] = PISTON_STEP[5];
    if (def.support === 'mount') step = PISTON_STEP[mountIndexOf(bits & 7)];
    const support = defOf(this.world.getBlock(x + step[0], y + step[1], z + step[2]));
    return support.opaque && support.solid;
  }

  private intersectsPlayer(x: number, y: number, z: number): boolean {
    setAabbFromBase(PLACE_BOX, x + 0.5, y, z + 0.5, 1, 1);
    return aabbOverlap(PLACE_BOX, this.player.aabb);
  }
}

const PLACE_BOX = createAabb();
/** Célula da outra metade de um bloco de duas células, reusada por frame. */
const PARTNER_POS = new Int32Array(3);
const PARTNER_OFFSET = new Int8Array(3);

/**
 * Escreve em `out` a célula da segunda metade de `state`.
 * Devolve false quando o bloco ocupa uma célula só.
 */
function partnerCellOf(
  state: number, x: number, y: number, z: number, out: Int32Array,
): boolean {
  if (!partnerOffset(state, PARTNER_OFFSET)) return false;
  out[0] = x + PARTNER_OFFSET[0];
  out[1] = y + PARTNER_OFFSET[1];
  out[2] = z + PARTNER_OFFSET[2];
  return true;
}

function aabbOverlap(a: Float32Array, b: Float32Array): boolean {
  return a[0] < b[3] && a[3] > b[0]
    && a[1] < b[4] && a[4] > b[1]
    && a[2] < b[5] && a[5] > b[2];
}

/**
 * Bloco que o item coloca.
 *
 * Quase sempre é o de mesmo id — a tabela de itens gera um item por bloco —,
 * mas `placesBlock` existe para os casos em que não é: o pó de redstone é um
 * item de material que coloca `redstone_wire`.
 */
function blockIdForItem(itemId: number): number | undefined {
  const places = itemDef(itemId)?.placesBlock;
  return places !== undefined && places !== AIR ? places : undefined;
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
 * Encaixe (`MOUNT_*`) correspondente à face clicada: o apoio de uma alavanca ou
 * de um botão fica sempre do lado oposto à normal do acerto.
 */
export function mountFromNormal(nx: number, ny: number, nz: number): number {
  if (ny > 0) return MOUNT_FLOOR;
  if (ny < 0) return MOUNT_CEILING;
  if (nx > 0) return 1;
  if (nx < 0) return 0;
  if (nz > 0) return 3;
  return 2;
}

/** Índice em `PISTON_STEP` da direção em que fica o apoio de um encaixe. */
function mountIndexOf(mount: number): number {
  if (mount === MOUNT_FLOOR) return 5;
  if (mount === MOUNT_CEILING) return 4;
  return mount & 3;
}

/**
 * Direção do olhar nos bits de `FACING_STEP`, apontando para **longe** de quem
 * coloca — é o que o repetidor precisa: a saída sai na direção em que se olha.
 *
 * Difere de `facingFromYaw` de propósito: lá o bloco fica *de frente* para o
 * jogador, aqui ele aponta *para onde o jogador aponta*.
 */
export function facing4FromLook(yaw: number): number {
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 0 : 1;
  return dz > 0 ? 2 : 3;
}

/**
 * Idem com os seis eixos, na ordem de `PISTON_STEP`. Olhar bem para cima ou
 * bem para baixo (mais de ~45°) coloca o pistão na vertical.
 */
export function facing6FromLook(yaw: number, pitch: number): number {
  const dy = -Math.sin(pitch);
  if (Math.abs(dy) > 0.7071) return dy > 0 ? 4 : 5;
  return facing4FromLook(yaw);
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
