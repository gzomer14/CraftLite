/**
 * Pausa, troca de modo, voo e o atalho de inventário — o que o jogador faz
 * **com o jogo**, e não dentro dele (doc 08 §3.10 e §4.1).
 *
 * Saiu do `main.ts` em 2026-09-22 (M13).
 */

import { PauseMenu } from './screens/pause';
import type { Controls } from '../input/controls';
import type { Player, GameMode } from '../entity/player';
import type { Session } from '../game/session';
import type { CreativeScreen } from './containers/creative';
import type { ContainerScreen } from './containers/screen';
import type { Hud } from './hud';
import type { TouchUi } from './touchui';

export interface GameFlowDeps {
  player: Player;
  session: Session;
  controls: Controls;
  hud: Hud;
  containerScreen: ContainerScreen;
  creativeScreen: CreativeScreen;
  /** Os controles de toque nascem depois: lidos na hora. */
  touchUi: () => TouchUi;
  /** Opções a partir da pausa; `back` volta para ela. */
  openOptions: (back: () => void) => void;
  saveAll: () => Promise<void>;
}

export class GameFlow {
  paused = false;
  readonly pauseMenu: PauseMenu;
  private readonly d: GameFlowDeps;

  constructor(deps: GameFlowDeps) {
    this.d = deps;
    const { player, session } = deps;
    this.pauseMenu = new PauseMenu({
      onResume: () => { this.paused = false; this.pauseMenu.hide(); },
      onOptions: () => {
        this.pauseMenu.hide();
        deps.openOptions(() => this.pauseMenu.show());
      },
      achievements: () => session.achievements.mask,
      gameMode: () => player.mode,
      onToggleMode: () => this.setGameMode(player.mode === 'creative' ? 'survival' : 'creative'),
      onSaveAndQuit: () => {
        this.pauseMenu.setStatus('salvando…');
        void (async () => {
          await deps.saveAll();
          // Recarregar é a saída honesta para voltar ao título: garante que nada
          // do mundo antigo (workers, VBOs, listeners) sobreviva ao próximo.
          location.reload();
        })();
      },
    });
  }

  togglePause(): void {
    const { controls } = this.d;
    this.paused = !this.paused;
    controls.reset();
    if (this.paused) {
      controls.mouse.exitLock();
      this.pauseMenu.show();
    } else {
      this.pauseMenu.hide();
    }
  }

  /** Esc fecha uma camada por vez (doc 08 §4.1). */
  escape(): void {
    const { creativeScreen, containerScreen, session } = this.d;
    if (creativeScreen.isOpen) creativeScreen.close();
    else if (containerScreen.isOpen) session.workbench.closeScreen();
    else this.togglePause();
  }

  /** No criativo, `E` abre a paleta de itens; no sobrevivência, a mochila. */
  toggleInventory(): void {
    const { player, session, creativeScreen, containerScreen, controls } = this.d;
    if (player.mode !== 'creative') { session.workbench.toggleInventory(); return; }
    if (creativeScreen.isOpen) { creativeScreen.close(); return; }
    // Mochila aberta pelo atalho da paleta: `E` fecha ela em vez de abrir a
    // paleta por cima — uma camada por vez, como o `Esc` (doc 08 §4.1).
    if (containerScreen.isOpen) { session.workbench.closeScreen(); return; }
    controls.mouse.exitLock();
    creativeScreen.open(session.inventory);
  }

  /** Duplo toque no pulo, ou o botão de voo do toque: só no criativo. */
  toggleFly(): void {
    const player = this.d.player;
    if (player.mode !== 'creative') return;
    player.flying = !player.flying;
    if (player.flying) player.vy = 0;
  }

  /**
   * Troca o modo **no mesmo mundo** (pedido de campo 2026-09-14).
   *
   * O save já guardava o modo junto da meta desde o M4, então persistir é só
   * salvar depois de trocar. Três cuidados:
   *
   * - **para de voar**. Entrar no sobrevivência voando deixaria o jogador
   *   parado no ar; sair dele com o voo ligado daria voo de graça.
   * - **fecha a tela aberta**. A paleta do criativo e a mochila do
   *   sobrevivência são telas diferentes para o mesmo botão.
   * - **salva na hora**. Trocar de modo é raro e deliberado; esperar o
   *   autosave arriscaria perder justamente o que o jogador acabou de pedir.
   */
  setGameMode(next: GameMode): void {
    const { player, creativeScreen, containerScreen, session, hud } = this.d;
    if (player.mode === next) return;
    player.mode = next;
    player.flying = false;
    if (creativeScreen.isOpen) creativeScreen.close();
    if (containerScreen.isOpen) session.workbench.closeScreen();
    this.applyGameMode();
    hud.showMessage(next === 'creative' ? 'Modo Criativo' : 'Modo Sobrevivência', 60);
    void this.d.saveAll();
  }

  /** Põe a interface de acordo com o modo atual. */
  applyGameMode(): void {
    const creative = this.d.player.mode === 'creative';
    this.d.touchUi().setCreative(creative);
    this.d.hud.setCreative(creative);
  }
}
