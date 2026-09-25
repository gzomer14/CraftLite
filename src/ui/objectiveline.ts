/**
 * A linha do alto do HUD: a dica da primeira hora (M17) enquanto ela durar, e
 * depois o próximo objetivo da árvore de conquistas.
 *
 * **Corrige um defeito antigo:** até aqui o objetivo era calculado uma vez, ao
 * entrar no mundo (`main.ts`), e não mudava quando a conquista saía — quem
 * pegava o primeiro tronco continuava lendo "consiga Tronco de Carvalho" até
 * sair e voltar. Agora a linha é conferida uma vez por segundo, e o texto só é
 * montado quando o que ela diz muda (passo, conquista ou forma de jogar).
 *
 * O gesto sai do aparelho na mão: controle ligado ganha dos outros (quem pegou
 * o controle vai jogar com ele), senão toque no modo A ou B, senão teclado —
 * com a tecla da mochila que o jogador remapeou, e os botões do controle com
 * os rótulos da família dele.
 */

import type { StringKey } from '../data/strings/pt';
import { GUIDE_STEPS } from '../data/guide';
import { keyLabel } from '../data/keybinds';
import { nextObjective, objectiveFor } from '../data/achievements';
import { t, tf } from '../core/i18n';
import { ITEM_BY_NAME } from '../data/items';
import { MOB_BY_NAME } from '../data/mobs';
import type { Guide } from '../game/guide';
import type { ItemStack } from '../data/items';
import type { Hud } from './hud';
import type { SettingsStore } from '../game/settings';
import type { Gamepads } from '../input/gamepad';
import type { Keybinds } from '../input/keybinds';

/** Quadros entre uma conferência e outra (~1 s a 60 FPS). */
const CHECK_EVERY = 60;

type InputKind = 'keyboard' | 'touchA' | 'touchB' | 'pad';

export interface ObjectiveLineDeps {
  hud: Pick<Hud, 'setObjective' | 'showMessage'>;
  guide: Guide;
  slots: () => readonly (ItemStack | null)[];
  /** O que o jogador segura na tela aberta (tirado do resultado, por exemplo). */
  cursor: () => ItemStack | null;
  achievementMask: () => number;
  /** A dica só vale no Sobrevivência: no Criativo não há o que ensinar a fazer. */
  survival: () => boolean;
  settings: Pick<SettingsStore, 'get'>;
  gamepads: Pick<Gamepads, 'connected' | 'labels'>;
  keybinds: Pick<Keybinds, 'codeFor'>;
  isTouch: boolean;
}

/** Como a linha chama uma `#tag` de alvo ("um tronco qualquer"). */
const TAG_NAMES: Readonly<Record<string, StringKey>> = {
  '#logs': 'tag.logs',
  '#planks': 'tag.planks',
};

/** Nome legível do alvo de uma conquista: item, mob ou tag. */
export function displayOfTarget(target: string): string {
  const tag = TAG_NAMES[target];
  if (tag !== undefined) return t(tag);
  return ITEM_BY_NAME.get(target)?.display ?? MOB_BY_NAME.get(target)?.display ?? target;
}

export class ObjectiveLine {
  private readonly d: ObjectiveLineDeps;
  private countdown = 0;
  /** O que a linha mostra agora, para só remontar o texto quando mudar. */
  private shownKey = '';

  constructor(deps: ObjectiveLineDeps) {
    this.d = deps;
  }

  /** Chamado a cada quadro; trabalha uma vez por segundo. */
  frame(): void {
    if (--this.countdown > 0) return;
    this.countdown = CHECK_EVERY;
    this.refresh();
  }

  /** Confere já, sem esperar o segundo (ao entrar no mundo). */
  refresh(): void {
    const d = this.d;
    const mask = d.achievementMask();
    const guiding = d.settings.get('guide') && d.survival() && !d.guide.finished;
    if (guiding && d.guide.update(d.slots(), mask, d.cursor()) && d.guide.finished) {
      d.hud.showMessage(t('guide.finished'), 100);
    }

    let key: string;
    if (guiding && !d.guide.finished) {
      key = `g${d.guide.current}:${this.inputKind()}`;
    } else {
      const next = nextObjective(mask);
      key = next === undefined ? 'none' : `o${next.id}`;
    }
    if (key === this.shownKey) return;
    this.shownKey = key;
    d.hud.setObjective(this.text());
  }

  private text(): string | null {
    const d = this.d;
    if (d.settings.get('guide') && d.survival() && !d.guide.finished) {
      const step = GUIDE_STEPS[d.guide.current];
      const [breakIt, useIt, openInventory] = this.gestures();
      return tf('hud.tip', tf(step.text, breakIt, useIt, openInventory));
    }
    const next = nextObjective(d.achievementMask());
    return next === undefined ? null : tf('hud.objective', objectiveFor(next, displayOfTarget));
  }

  private inputKind(): InputKind {
    if (this.d.gamepads.connected) return 'pad';
    if (this.d.isTouch) return this.d.settings.get('touchMode') === 'A' ? 'touchA' : 'touchB';
    return 'keyboard';
  }

  /** `[quebrar, usar, abrir a mochila]` no aparelho em uso. */
  private gestures(): [string, string, string] {
    const kind = this.inputKind();
    if (kind === 'pad') {
      const labels = this.d.gamepads.labels;
      return [
        tf('guide.break_pad', labels.r2), tf('guide.use_pad', labels.l2),
        tf('guide.inventory_pad', labels.faceLeft),
      ];
    }
    if (kind === 'touchA') {
      return [t('guide.break_touch_a'), t('guide.use_touch_a'), t('guide.inventory_touch')];
    }
    if (kind === 'touchB') {
      return [t('guide.break_touch_b'), t('guide.use_touch_b'), t('guide.inventory_touch')];
    }
    return [
      t('guide.break_keyboard'), t('guide.use_keyboard'),
      tf('guide.inventory_keyboard', keyLabel(this.d.keybinds.codeFor('inventory'))),
    ];
  }
}
