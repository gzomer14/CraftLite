/**
 * O que o jogador faz com as mãos a cada tick: mirar, bater, quebrar, usar e
 * a animação da mão que acompanha (doc 06 §4–§5, doc 09 §2.2).
 *
 * Saiu do `main.ts` em 2026-09-22 (M13). A ordem das decisões é a de sempre:
 * mob na frente do bloco leva o golpe (nos dois modos de jogo), clicar num
 * bicho vence colocar bloco, e soltar o botão de usar é o que encerra comer,
 * carregar o arco e baixar o escudo.
 */

import { createVec3, forwardFrom, type Vec3 } from '../core/math';
import type { Controls } from './controls';
import type { Camera } from '../render/camera';
import type { HandRenderer } from '../render/hand';
import type { Session } from '../game/session';

export class PlayerActions {
  private readonly controls: Controls;
  private readonly session: Session;
  private readonly camera: Camera;
  private readonly hand: HandRenderer;
  /** Direção do olhar reusada — `forwardFrom` escreve nela, sem alocar. */
  private readonly aim = createVec3();
  /** Botões dedicados do Modo B de toque (doc 09 §2.3). */
  modeBBreaking = false;
  modeBPlace = false;

  constructor(controls: Controls, session: Session, camera: Camera, hand: HandRenderer) {
    this.controls = controls;
    this.session = session;
    this.camera = camera;
    this.hand = hand;
  }

  /** Mira: no Modo A vem do dedo; senão, do centro da tela. */
  private aimDirection(): Vec3 {
    const controls = this.controls;
    if (controls.hasAim) return this.camera.rayFromNdc(controls.aimNdcX, controls.aimNdcY);
    const player = this.session.player;
    forwardFrom(this.aim, player.yaw, player.pitch);
    return this.aim;
  }

  /** Tela de contêiner aberta: o mundo roda, as mãos não. */
  idle(): void {
    const { session, hand } = this;
    session.interaction.tickBreaking(false, null);
    session.cancelEating();
    /*
     * A mão continua animando, parada. Sair antes de `hand.tick()` congela o
     * golpe no meio: `previous` e `current` ficam diferentes para sempre e o
     * render interpola entre os dois a cada frame — a mão vibrando até fechar
     * a tela (relato de campo 2026-09-12).
     */
    const held = session.inventory.held;
    hand.setHeld(held === null ? -1 : held.item);
    hand.tick(0);
  }

  tick(): void {
    const { controls, session, hand } = this;
    const { interaction, inventory, player } = session;

    // Espectador (M10): olha, não toca. Sem mira, sem quebrar, sem usar.
    if (player.spectator) {
      interaction.state.target = null;
      this.idle();
      return;
    }

    const dir = this.aimDirection();
    interaction.updateTargetAlong(dir[0], dir[1], dir[2]);

    const breaking = controls.state.breaking || this.modeBBreaking;
    // Mob na frente do bloco: o golpe vai nele, não na parede atrás. Vale
    // **nos dois modos** — no criativo o clique caía direto no `tickBreaking`,
    // que quebrava o bloco atrás do bicho.
    const attacked = breaking && session.combat.attackAlong(dir[0], dir[1], dir[2]);
    interaction.tickBreaking(breaking && !attacked, inventory.held);

    // Mão: o item do slot, o balanço de bater ou usar, e o passo andado.
    const held = inventory.held;
    hand.setHeld(held === null ? -1 : held.item);
    if (attacked || interaction.state.stage >= 0) hand.swing();
    hand.tick(Math.hypot(player.x - player.prevX, player.z - player.prevZ));

    // Soltar o botão de usar é o que **encerra** comer, carregar o arco e
    // baixar o escudo.
    const placing = controls.consumePlace() || this.modeBPlace;
    if (!placing) session.cancelEating();
    if (placing) {
      // Clicar num mob (domar, tosquiar) vence colocar bloco.
      if (!session.useOnMob(dir[0], dir[1], dir[2])) session.useHeld();
      hand.swing();
    }
    this.modeBPlace = false;
  }
}
