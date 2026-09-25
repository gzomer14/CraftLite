/**
 * HUD em jogo: crosshair e hotbar (doc 08 §1–§2 e §3.4).
 *
 * DOM + CSS sobre o canvas, não desenhado nele: é mais barato, dá
 * acessibilidade de graça e escala por `--gui-scale` sem re-renderizar nada.
 *
 * O HUD só toca no DOM quando alguma coisa muda — atualizar `textContent` a
 * 60 Hz é desperdício e gera lixo.
 */

import { t, tf } from '../core/i18n';
import { itemDef, type ItemStack } from '../data/items';
import type { ColorBlindMode, SettingsStore } from '../game/settings';
import { paintDurability } from './containers/slotview';

/** As quatro cores que o HUD usa como **única** portadora de informação. */
const PALETTE_KEYS = ['hearts', 'hunger', 'air', 'xp'] as const;
type PaletteKey = (typeof PALETTE_KEYS)[number];

/**
 * Paletas do modo daltônico (doc 08 §6), da família Okabe-Ito.
 *
 * `off` são as cores do doc 08 §2, repetidas aqui para que desligar o modo as
 * devolva sem recarregar a página.
 */
const COLORBLIND_PALETTES: Record<ColorBlindMode, Record<PaletteKey, string>> = {
  off: { hearts: '#dc0000', hunger: '#c68a45', air: '#8ecbff', xp: '#7bd63b' },
  // Protan e deutan perdem o eixo vermelho–verde: vida e XP viram vermelhão e
  // azul, que são os dois extremos que sobram.
  protanopia: { hearts: '#d55e00', hunger: '#f0e442', air: '#56b4e9', xp: '#0072b2' },
  deuteranopia: { hearts: '#d55e00', hunger: '#f0e442', air: '#56b4e9', xp: '#0072b2' },
  // Tritan perde o eixo azul–amarelo: o ar sai do azul e a fome sai do amarelo.
  tritanopia: { hearts: '#d55e00', hunger: '#cc79a7', air: '#8f8f8f', xp: '#009e73' },
};

export const HOTBAR_SLOTS = 9;

/** Ticks que o toast de conquista fica na tela: 5 s a 20 Hz (doc 08 §3.4). */
const ACHIEVEMENT_TICKS = 100;

/** Escala automática do doc 08 §1: clamp(floor(min(w/320, h/240)), 1, 4). */
/**
 * Escala da interface a partir do tamanho da janela (doc 08 §6).
 *
 * **O piso de toque era 3 e é 2.** Um celular deitado tem ~360 px de altura, o
 * que dá `floor(360/240) = 1`; o piso de 3 forçava a mesma escala de um desktop
 * de 1280×800, e o painel do inventário saía com 755 px numa tela de 360 —
 * duas vezes a altura disponível. Com 2 o slot fica em 36 px e a fileira da
 * hotbar em ~45 px por espaço, que continua tocável, e o painel cabe.
 *
 * Os botões de toque **não** dependem disto: `#touch .tbtn` tem `min-width` e
 * `min-height` de 44 px próprios, então o alvo de dedo está garantido lá,
 * que é onde ele importa.
 */
export function autoGuiScale(width: number, height: number, coarsePointer: boolean): number {
  const raw = Math.floor(Math.min(width / 320, height / 240));
  const scale = Math.max(1, Math.min(4, raw));
  return coarsePointer ? Math.max(2, scale) : scale;
}

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly slots: HTMLDivElement[] = [];
  private readonly labels: HTMLSpanElement[] = [];
  private readonly durabilityBars: HTMLDivElement[] = [];
  private selected = 0;
  /** Último conteúdo desenhado por slot, para evitar mexer no DOM à toa. */
  private readonly rendered: (string | null)[] = new Array(HOTBAR_SLOTS).fill(null);
  private readonly settings: SettingsStore | null;
  private readonly hearts: HTMLDivElement;
  private readonly hunger: HTMLDivElement;
  /** Uma coxa por dois pontos de fome. */
  private readonly hungerIcons: HTMLElement[] = [];
  /** A linha de vida/ar/fome inteira, para sumir no criativo. */
  private readonly bars: HTMLDivElement;
  private readonly air: HTMLDivElement;
  private readonly armor: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  /** Próximo passo sugerido, canto superior esquerdo. */
  private readonly objective: HTMLDivElement;
  /** Borda vermelha do dano, e se ela está ligada nas opções. */
  private readonly damage: HTMLDivElement;
  private damageFlashEnabled = true;
  private readonly subtitle: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  /** Contador de FPS do doc 08 §3.11, sem precisar abrir o F3. */
  private readonly fps: HTMLDivElement;
  private lastFps = -1;
  private readonly achievement: HTMLDivElement;
  private readonly xpBar: HTMLDivElement;
  private readonly xpFill: HTMLElement;
  private readonly xpLevel: HTMLSpanElement;
  /** Últimos valores desenhados, para não mexer no DOM à toa. */
  private lastHealth = -1;
  private lastHungerValue = -1;
  private lastAir = -1;
  private lastArmor = -1;
  private lastXpLevel = -1;
  private lastXpProgress = -1;
  private toastTimer = 0;
  private subtitleTimer = 0;
  private achievementTimer = 0;

  /** Chamado quando o jogador toca um slot da hotbar. */
  onSlotSelected: ((index: number) => void) | null = null;
  /**
   * `background-position` do item na folha de sprites (`render/itemsprites.ts`),
   * ou `null` para cair no rótulo de texto.
   */
  spriteOf: ((item: number) => string | null) | null = null;

  constructor(settings: SettingsStore | null = null) {
    this.settings = settings;
    injectStyle();
    this.root = document.createElement('div');
    this.root.id = 'hud';

    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair';
    this.crosshair.setAttribute('aria-hidden', 'true');

    // Barras de vida e fome (doc 08 §3.4). Ficam acima da hotbar, vida à
    // esquerda e fome à direita, como o jogador espera.
    const bars = document.createElement('div');
    bars.className = 'bars';
    this.hearts = document.createElement('div');
    this.hearts.className = 'hearts';
    this.hearts.setAttribute('role', 'img');
    this.hunger = document.createElement('div');
    this.hunger.className = 'hunger';
    this.hunger.setAttribute('role', 'img');
    /*
     * A fome é desenhada, não escrita.
     *
     * Ela era a string `▮▮▮▯▯` — um retângulo cheio que, na tela do celular,
     * lê como um risco e não como comida (relato de campo 2026-09-14). Agora
     * são dez `<i>` com a silhueta de uma coxa de frango, recortada por
     * máscara: a cor continua vindo do CSS, então a paleta para daltônicos
     * (doc 08 §6) segue valendo, e o desenho segue sendo gerado por código,
     * sem asset de terceiros.
     */
    for (let i = 0; i < 10; i++) {
      const piece = document.createElement('i');
      piece.className = 'empty';
      this.hungerIcons.push(piece);
      this.hunger.appendChild(piece);
    }
    this.air = document.createElement('div');
    this.air.className = 'air';
    this.air.hidden = true;
    bars.append(this.hearts, this.air, this.hunger);
    this.bars = bars;

    // Armadura fica acima dos corações e só aparece com armor > 0 (doc 08 §3.4).
    this.armor = document.createElement('div');
    this.armor.className = 'armor';
    this.armor.setAttribute('role', 'img');
    this.armor.hidden = true;

    /*
     * Linha de objetivo.
     *
     * O jogo não dizia em lugar nenhum o que fazer: a dica inicial ensina as
     * teclas e some, e a tela de conquistas mostrava 18 linhas de "???". Esta
     * linha diz o próximo passo e se atualiza sozinha conforme a árvore avança.
     */
    this.objective = document.createElement('div');
    this.objective.className = 'objective';

    /*
     * Contador de FPS solto.
     *
     * O F3 já mostra o número, mas ele traz vinte linhas junto e tapa o canto
     * da tela — quem só quer conferir se o celular está segurando os 30 não
     * deveria ter que ler a telemetria inteira.
     */
    this.fps = document.createElement('div');
    this.fps.className = 'fps';
    this.fps.hidden = true;
    this.objective.setAttribute('role', 'status');
    this.objective.hidden = true;

    // Borda que pisca ao levar dano. Fica atrás de tudo e não recebe toque.
    this.damage = document.createElement('div');
    this.damage.className = 'damage';
    this.damage.setAttribute('aria-hidden', 'true');

    // Avisos curtos ("há monstros por perto") e legendas de som (doc 10 §4).
    this.toast = document.createElement('div');
    this.toast.className = 'toast';
    this.toast.setAttribute('role', 'status');
    this.toast.hidden = true;
    this.subtitle = document.createElement('div');
    this.subtitle.className = 'subtitle';
    this.subtitle.setAttribute('aria-live', 'polite');
    this.subtitle.hidden = true;

    // Toast de conquista: canto superior direito, entra deslizando e some em
    // 5 s (doc 08 §3.4).
    this.achievement = document.createElement('div');
    this.achievement.className = 'achievement';
    this.achievement.setAttribute('role', 'status');
    this.achievement.hidden = true;

    // Barra de XP: fica entre as barras de vida/fome e a hotbar (doc 08 §3.4),
    // largura de 182 px de GUI e o nível em verde no centro.
    this.xpBar = document.createElement('div');
    this.xpBar.className = 'xp';
    this.xpBar.setAttribute('role', 'img');
    this.xpFill = document.createElement('i');
    this.xpLevel = document.createElement('span');
    this.xpBar.append(this.xpFill, this.xpLevel);

    const hotbar = document.createElement('div');
    hotbar.className = 'hotbar';
    hotbar.setAttribute('role', 'toolbar');
    hotbar.setAttribute('aria-label', t('hud.hotbar'));

    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.setAttribute('role', 'button');
      slot.tabIndex = 0;
      slot.setAttribute('aria-label', tf('hud.slot_empty', i + 1));
      const label = document.createElement('span');
      // A barra de durabilidade também aqui, e não só com a mochila aberta:
      // é na hotbar que se vê a picareta que está para quebrar.
      const bar = document.createElement('div');
      bar.className = 'durability';
      bar.hidden = true;
      slot.append(label, bar);
      // A hotbar é tocável: no celular é a única forma de trocar de item.
      slot.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onSlotSelected?.(i);
      });
      slot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') this.onSlotSelected?.(i);
      });
      hotbar.appendChild(slot);
      this.slots.push(slot);
      this.labels.push(label);
      this.durabilityBars.push(bar);
    }

    this.root.append(
      this.damage, this.crosshair, this.objective, this.fps, this.armor, bars, this.xpBar, hotbar,
      this.toast, this.subtitle, this.achievement,
    );
    document.body.appendChild(this.root);
    this.setSelected(0);
    this.updateScale();

    /*
     * A escala também segue as opções, não só o tamanho da janela.
     *
     * `updateScale` só rodava no boot e no `resize`: mexer em "Escala da
     * interface" trocava o rótulo do slider e não mudava nada na tela até a
     * janela ser redimensionada. Quem tentava diminuir a interface concluía,
     * com razão, que a opção não funcionava.
     */
    settings?.onChange(() => this.updateScale());
    window.addEventListener('resize', () => this.updateScale(), { passive: true });
  }

  setSelected(index: number): void {
    const next = ((index % HOTBAR_SLOTS) + HOTBAR_SLOTS) % HOTBAR_SLOTS;
    if (next === this.selected) return;
    this.slots[this.selected].classList.remove('selected');
    this.selected = next;
    this.slots[next].classList.add('selected');
  }

  get selectedIndex(): number {
    return this.selected;
  }

  /** Redesenha a hotbar. Só mexe nos slots que mudaram. */
  render(stacks: readonly (ItemStack | null)[]): void {
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      const stack = stacks[i] ?? null;
      const sprite = stack === null ? null : this.spriteOf?.(stack.item) ?? null;
      // O sprite entra na chave: a bússola muda de quadro sem mudar de item (M10).
      // O desgaste também: cada golpe da picareta encolhe a barra.
      const key = stack === null ? '' : `${stack.item}x${stack.count}:${stack.damage}@${sprite ?? ''}`;
      if (this.rendered[i] === key) continue;
      this.rendered[i] = key;

      const label = this.labels[i];
      const slot = this.slots[i];
      paintDurability(this.durabilityBars[i], stack);
      if (stack === null) {
        label.textContent = '';
        slot.classList.remove('sprite');
        slot.style.removeProperty('background-position');
        slot.setAttribute('aria-label', tf('hud.slot_empty', i + 1));
        continue;
      }
      const def = itemDef(stack.item);
      const name = def?.display ?? '?';
      if (sprite !== null) {
        slot.classList.add('sprite');
        slot.style.backgroundPosition = sprite;
        label.textContent = stack.count > 1 ? String(stack.count) : '';
      } else {
        slot.classList.remove('sprite');
        slot.style.removeProperty('background-position');
        label.textContent = stack.count > 1
          ? `${name.slice(0, 2)}\n${stack.count}`
          : name.slice(0, 2);
      }
      slot.setAttribute('aria-label', tf('hud.slot', i + 1, name, stack.count));
    }
  }

  /**
   * Atualiza vida, fome e ar. Só toca no DOM quando o valor muda de meio
   * coração para cima — chamar isto 60 vezes por segundo com o mesmo valor
   * seria desperdício puro.
   */
  /**
   * Some com vida, ar, fome e armadura no criativo (doc 08 §3.4).
   *
   * No criativo nada disso muda nunca: a vida não cai, a fome não desce e a
   * armadura não protege de nada. Quatro fileiras de ícones congelados ocupam
   * a faixa mais disputada da tela — logo acima da hotbar — e ainda sugerem
   * uma mecânica que não existe ali.
   */
  /** Acrescenta um painel próprio à raiz do HUD (a faixa de efeitos). */
  mount(child: HTMLElement): void {
    this.root.appendChild(child);
  }

  setCreative(on: boolean): void {
    this.bars.hidden = on;
    this.creative = on;
    if (on) this.armor.hidden = true;
  }

  private creative = false;

  setStats(health: number, hunger: number, air: number, maxAir: number, armor = 0): void {
    const halfHearts = Math.round(health);
    if (halfHearts !== this.lastHealth) {
      this.lastHealth = halfHearts;
      this.hearts.textContent = icons(halfHearts, 20, '♥', '♡');
      this.hearts.classList.toggle('critical', halfHearts <= 4);
      this.hearts.setAttribute('aria-label', tf('hud.health', halfHearts));
    }

    const halfHunger = Math.round(hunger);
    if (halfHunger !== this.lastHungerValue) {
      this.lastHungerValue = halfHunger;
      const full = Math.ceil(halfHunger / 2);
      for (let i = 0; i < this.hungerIcons.length; i++) {
        this.hungerIcons[i].className = i < full ? '' : 'empty';
      }
      this.hunger.setAttribute('aria-label', tf('hud.hunger', halfHunger));
    }

    const armorPoints = Math.round(armor);
    if (armorPoints !== this.lastArmor) {
      this.lastArmor = armorPoints;
      this.armor.hidden = armorPoints <= 0 || this.creative;
      if (armorPoints > 0) {
        this.armor.textContent = icons(armorPoints, 20, '◆', '◇');
        this.armor.setAttribute('aria-label', tf('hud.armor', armorPoints));
      }
    }

    // Bolhas de ar só aparecem debaixo d'água.
    const bubbles = air >= maxAir ? -1 : Math.ceil((air / maxAir) * 10);
    if (bubbles !== this.lastAir) {
      this.lastAir = bubbles;
      this.air.hidden = bubbles < 0;
      if (bubbles >= 0) {
        this.air.textContent = '●'.repeat(Math.max(0, bubbles));
        this.air.setAttribute('aria-label', tf('hud.air', bubbles));
      }
    }
  }

  /**
   * Atualiza a barra e o número do nível (doc 08 §3.4).
   * `progress` é 0..1 dentro do nível atual.
   */
  setExperience(level: number, progress: number): void {
    const rounded = Math.round(progress * 100) / 100;
    if (level !== this.lastXpLevel) {
      this.lastXpLevel = level;
      this.xpLevel.textContent = level > 0 ? String(level) : '';
      this.xpBar.setAttribute('aria-label', tf('hud.level', level));
    }
    if (rounded !== this.lastXpProgress) {
      this.lastXpProgress = rounded;
      this.xpFill.style.transform = `scaleX(${rounded.toFixed(2)})`;
    }
  }

  /**
   * Toast de conquista no canto superior direito (doc 08 §3.4).
   * Fica 5 s e sai; um toast novo substitui o anterior.
   */
  showAchievement(title: string, description: string): void {
    this.achievement.textContent = '';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const detail = document.createElement('span');
    detail.textContent = description;
    this.achievement.append(heading, detail);
    this.achievement.hidden = false;
    // Reinicia a animação de entrada mesmo se o toast já estava visível.
    this.achievement.classList.remove('in');
    void this.achievement.offsetWidth;
    this.achievement.classList.add('in');
    this.achievementTimer = ACHIEVEMENT_TICKS;
  }

  /** Aviso curto no centro-baixo da tela; some sozinho. */
  /**
   * A linha do alto — dica da primeira hora ou objetivo, já com o prefixo
   * (`ui/objectiveline.ts`) —, ou `null` para escondê-la.
   */
  setObjective(text: string | null): void {
    if (text === null) {
      this.objective.hidden = true;
      return;
    }
    this.objective.textContent = text;
    this.objective.hidden = false;
  }

  showMessage(text: string, ticks = 60): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    this.toastTimer = ticks;
  }

  /**
   * Legenda de som com a direção relativa (doc 10 §4).
   * `direction` em radianos: 0 = à frente, positivo = à direita.
   */
  showSubtitle(text: string, direction: number): void {
    const arrow = arrowFor(direction);
    this.subtitle.textContent = `« ${text} ${arrow} »`;
    this.subtitle.hidden = false;
    this.subtitleTimer = 60;
  }

  /** Um tick: conta o tempo dos avisos. Chamado a 20 Hz. */
  tick(): void {
    if (this.toastTimer > 0 && --this.toastTimer === 0) this.toast.hidden = true;
    if (this.subtitleTimer > 0 && --this.subtitleTimer === 0) this.subtitle.hidden = true;
    if (this.achievementTimer > 0 && --this.achievementTimer === 0) {
      this.achievement.hidden = true;
      this.achievement.classList.remove('in');
    }
  }

  private updateScale(): void {
    const override = this.settings?.get('guiScale') ?? 0;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const scale = override > 0
      ? override
      : autoGuiScale(window.innerWidth, window.innerHeight, coarse);
    document.documentElement.style.setProperty('--gui-scale', String(scale));
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /**
   * Acessibilidade do HUD (doc 08 §6): fundo sólido atrás do texto e tamanho
   * do texto. O contorno por sombra some contra céu claro e contra neve, e
   * 7 px de fonte a escala 2 é pequeno para muita gente.
   */
  applyAccessibility(
    highContrast: boolean, textScale: number, damageFlash: boolean,
    colorBlind: ColorBlindMode = 'off',
  ): void {
    this.root.classList.toggle('high-contrast', highContrast);
    document.documentElement.style.setProperty('--hud-text', String(textScale / 100));
    this.damageFlashEnabled = damageFlash;
    this.applyPalette(colorBlind);
  }

  /**
   * Modo daltônico (doc 08 §6): troca as cores do HUD por uma paleta que se
   * distingue sem depender do eixo que falta.
   *
   * O HUD codifica quatro informações **só por cor** — vida, fome, ar e
   * experiência —, e três delas (vermelho, laranja, verde) caem no mesmo eixo
   * que protanopia e deuteranopia perdem: para 8% dos homens, a barra de vida e
   * a de experiência eram a mesma cor. As substitutas saem da paleta de
   * Okabe-Ito, desenhada justamente para isso.
   */
  private applyPalette(mode: ColorBlindMode): void {
    const palette = COLORBLIND_PALETTES[mode];
    const style = document.documentElement.style;
    for (const key of PALETTE_KEYS) {
      style.setProperty(`--hud-${key}`, palette[key]);
    }
  }

  /**
   * Mostra ou esconde a mira central.
   *
   * No **Modo A** de toque o alvo é a posição do dedo (doc 09 §2.2), e a mira
   * branca no meio da tela aponta para outro lugar: são duas miras ao mesmo
   * tempo, e o jogador não tem como saber qual delas manda. Desenhá-la ali é
   * dizer algo falso — no Modo A ela sai.
   */
  setCrosshairVisible(visible: boolean): void {
    if (this.crosshair.hidden === !visible) return;
    this.crosshair.hidden = !visible;
  }

  /** Contador de FPS. Só mexe no DOM quando o número inteiro muda. */
  setFps(value: number, visible: boolean): void {
    if (this.fps.hidden === visible) this.fps.hidden = !visible;
    if (!visible) return;
    const rounded = Math.round(value);
    if (rounded === this.lastFps) return;
    this.lastFps = rounded;
    this.fps.textContent = `${rounded} FPS`;
  }

  /**
   * Clarão vermelho nas bordas ao levar dano.
   *
   * Até agora o único aviso de dano era a fileira de corações mudar no canto de
   * baixo — fácil de perder quando se está olhando para o creeper. O efeito é
   * uma borda, não uma tela cheia: ele avisa sem tapar o que causou o dano.
   */
  flashDamage(): void {
    if (!this.damageFlashEnabled) return;
    this.damage.classList.remove('on');
    // Reinicia a animação: sem ler o layout, dois danos seguidos não repetem.
    void this.damage.offsetWidth;
    this.damage.classList.add('on');
  }
}

/**
 * A coxa de frango da barra de fome, em 9×9 — a mesma resolução dos ícones do
 * gênero, e a mesma grade de pixel do resto da interface.
 *
 * Desenhar por grade e não por curva é o que mantém o ícone legível em
 * `--px: 2` num celular velho: cada `#` vira um quadrado inteiro, sem
 * suavização para borrar o contorno.
 */
export const DRUMSTICK = [
  '...###...',
  '..#####..',
  '.#######.',
  '.#######.',
  '.#######.',
  '..#####..',
  '..###....',
  '.##......',
  '###......',
] as const;

/**
 * Transforma a grade num SVG de retângulos, para servir de máscara em CSS.
 *
 * Máscara e não imagem colorida: assim a cor continua saindo de
 * `var(--hud-hunger)`, e a paleta para daltônicos (doc 08 §6) segue trocando o
 * tom do ícone como trocava o da letra. Cada linha vira **um** retângulo por
 * sequência de `#`, e não um por pixel — são 9 retângulos em vez de 50.
 */
export function maskFrom(grid: readonly string[]): string {
  const size = grid[0].length;
  let rects = '';
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    let x = 0;
    while (x < size) {
      if (row[x] !== '#') { x++; continue; }
      let run = 1;
      while (x + run < size && row[x + run] === '#') run++;
      rects += `<rect x="${x}" y="${y}" width="${run}" height="1"/>`;
      x += run;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${grid.length}">`
    + `<g fill="#000">${rects}</g></svg>`;
  // `encodeURIComponent` e não base64: o SVG continua legível no inspetor, e é
  // menor para um desenho deste tamanho.
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** A máscara da coxa, montada uma vez. */
const COXA = maskFrom(DRUMSTICK);

/** Monta a fileira de ícones cheios/vazios em pares (meio-coração). */
function icons(value: number, max: number, full: string, empty: string): string {
  const total = max / 2;
  const filled = Math.floor(value / 2);
  const half = value % 2 === 1;
  let out = full.repeat(filled);
  if (half) out += full;
  out += empty.repeat(Math.max(0, total - filled - (half ? 1 : 0)));
  return out;
}

/** Seta da direção de um som, em 8 rumos. */
function arrowFor(direction: number): string {
  const normalized = ((direction % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const sector = Math.round(normalized / (Math.PI / 4)) % 8;
  return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][sector];
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  // Paleta e escala do doc 08 §1–§2.
  css.textContent = `
:root{--gui-scale:3;--px:calc(var(--gui-scale) * 1px);--slot:calc(20 * var(--px));
  --slot-bg:#8b8b8b;--panel-shadow:#555;--panel-light:#fff;--text:#fff;--text-shadow:#3f3f3f}
#hud{position:fixed;inset:0;pointer-events:none;z-index:4;image-rendering:pixelated}
#hud .crosshair{position:absolute;left:50%;top:50%;width:calc(9 * var(--px));
  height:calc(9 * var(--px));transform:translate(-50%,-50%);mix-blend-mode:difference;
  background:
    linear-gradient(#fff,#fff) center/100% var(--px) no-repeat,
    linear-gradient(#fff,#fff) center/var(--px) 100% no-repeat}
#hud .bars{position:absolute;left:50%;transform:translateX(-50%);
  bottom:calc(33 * var(--px) + env(safe-area-inset-bottom,0px));
  display:flex;justify-content:space-between;align-items:center;gap:calc(4 * var(--px));
  width:calc(182 * var(--px));
  /* --touch-pad e publicado pela TouchUi: sem isto o botao de pular, que fica
     no canto de baixo, passa por cima do fim da barra de fome. */
  max-width:calc(100vw - 16px - 2 * var(--touch-pad, 0px));
  font:calc(7 * var(--px) * var(--hud-text,1))/1 ui-monospace,monospace;letter-spacing:calc(0.5 * var(--px));
  text-shadow:var(--px) var(--px) 0 #000;pointer-events:none}
/* Objetivo: canto superior esquerdo, discreto. Sai do caminho do F3, que ocupa
   a mesma região só quando ligado. */
#hud .objective{position:absolute;left:calc(4 * var(--px));
  top:calc(4 * var(--px) + env(safe-area-inset-top,0px));
  font:calc(5 * var(--px) * var(--hud-text,1))/1.3 ui-monospace,monospace;color:#e8e2c8;
  text-shadow:var(--px) var(--px) 0 #000;max-width:60vw;pointer-events:none}
#hud.high-contrast .objective{text-shadow:none;background:#000000cc;
  padding:calc(1 * var(--px)) calc(2 * var(--px));border-radius:2px}
/* Dano: vinheta vermelha nas bordas, 350 ms. Borda, não tela cheia — ela avisa
   sem esconder o que causou o dano. */
#hud .damage{position:absolute;inset:0;pointer-events:none;opacity:0;
  background:radial-gradient(ellipse at center,transparent 45%,#c0202088 100%)}
#hud .damage.on{animation:hud-damage .35s ease-out}
@keyframes hud-damage{from{opacity:1}to{opacity:0}}
@media (prefers-reduced-motion:reduce){#hud .damage.on{animation-duration:.15s}}
/* Alto contraste: chapa escura atrás do texto, em vez de sombra projetada. */
#hud.high-contrast .bars,#hud.high-contrast .armor,#hud.high-contrast .toast,
#hud.high-contrast .subtitle{text-shadow:none;background:#000000cc;
  padding:calc(1 * var(--px)) calc(2 * var(--px));border-radius:2px}
#hud.high-contrast .hotbar{background:#000000cc}
#hud .armor{position:absolute;left:50%;transform:translateX(-50%);
  bottom:calc(41 * var(--px) + env(safe-area-inset-bottom,0px));color:#c0c0c0;
  font:calc(7 * var(--px) * var(--hud-text,1))/1 ui-monospace,monospace;letter-spacing:calc(0.5 * var(--px));
  text-shadow:var(--px) var(--px) 0 #000}
#hud .toast{position:absolute;left:50%;transform:translateX(-50%);
  bottom:calc(53 * var(--px) + env(safe-area-inset-bottom,0px));
  padding:calc(2 * var(--px)) calc(4 * var(--px));background:#00000099;color:#fff;
  font:calc(6 * var(--px))/1.3 ui-monospace,monospace;text-align:center;max-width:80vw}
#hud .subtitle{position:absolute;right:calc(4 * var(--px) + env(safe-area-inset-right,0px));
  bottom:calc(47 * var(--px) + env(safe-area-inset-bottom,0px));
  padding:calc(2 * var(--px)) calc(3 * var(--px));background:#00000099;color:#e8e8e8;
  font:calc(5 * var(--px))/1.3 ui-monospace,monospace;max-width:50vw;text-align:right}
#hud .xp{position:absolute;left:50%;transform:translateX(-50%);
  bottom:calc(27 * var(--px) + env(safe-area-inset-bottom,0px));
  width:calc(182 * var(--px));max-width:calc(100vw - 16px);height:calc(5 * var(--px));
  background:#1c1c1cCC;overflow:visible;pointer-events:none}
#hud .xp i{display:block;height:100%;background:var(--hud-xp,#7bd63b);transform-origin:left center;
  transform:scaleX(0)}
#hud .xp span{position:absolute;left:50%;top:calc(-5 * var(--px));transform:translateX(-50%);
  color:var(--hud-xp,#7bd63b);font:calc(7 * var(--px) * var(--hud-text,1))/1 ui-monospace,monospace;
  text-shadow:var(--px) var(--px) 0 #000,calc(-1 * var(--px)) 0 0 #000}
#hud .achievement{position:absolute;top:calc(4 * var(--px) + env(safe-area-inset-top,0px));
  right:calc(4 * var(--px) + env(safe-area-inset-right,0px));
  display:grid;gap:calc(1 * var(--px));max-width:min(70vw,calc(120 * var(--px)));
  padding:calc(3 * var(--px)) calc(4 * var(--px));background:#1c1420ee;
  border:var(--px) solid #b46ee8;color:#fff;
  font:calc(5 * var(--px))/1.3 ui-monospace,monospace;
  transform:translateX(120%);transition:transform .25s ease-out}
#hud .achievement.in{transform:translateX(0)}
#hud .achievement strong{color:#f7d94c;font-weight:700}
#hud .achievement span{color:#d8d0e0;font-size:calc(4.5 * var(--px))}
@media (prefers-reduced-motion:reduce){#hud .achievement{transition:none}}
#hud .fps{position:absolute;right:calc(4 * var(--px));
  top:calc(4 * var(--px) + env(safe-area-inset-top,0px));
  font:calc(5 * var(--px) * var(--hud-text,1))/1 ui-monospace,monospace;color:#e8e2c8;
  text-shadow:var(--px) var(--px) 0 #000;pointer-events:none}
#hud.high-contrast .fps{text-shadow:none;background:#000000cc;
  padding:calc(1 * var(--px)) calc(2 * var(--px))}
#hud .hearts{color:var(--hud-hearts,#dc0000)}
#hud .hearts.critical{animation:hud-shake .5s infinite}
#hud .hunger{color:var(--hud-hunger,#c68a45);display:flex;gap:calc(0.5 * var(--px))}
/* A cor sai do CSS, então a paleta para daltônicos continua mandando no ícone. */
/* O lado acompanha a fonte da barra: assim a coxa e o coração têm o mesmo
   tamanho aparente, e a opção de texto grande da acessibilidade vale nos dois. */
#hud .hunger i{display:block;background:currentColor;
  width:calc(7 * var(--px) * var(--hud-text,1));
  height:calc(7 * var(--px) * var(--hud-text,1));
  -webkit-mask:${COXA} center/contain no-repeat;mask:${COXA} center/contain no-repeat}
#hud .hunger i.empty{opacity:.26}
#hud .air{color:var(--hud-air,#8ecbff)}
@keyframes hud-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-1px)}
  75%{transform:translateX(1px)}}
@media (prefers-reduced-motion:reduce){#hud .hearts.critical{animation:none}}
#hud .hotbar{position:absolute;left:50%;bottom:calc(4 * var(--px) + env(safe-area-inset-bottom,0px));
  transform:translateX(-50%);display:flex;gap:0;padding:var(--px);background:#00000066;
  border:var(--px) solid #2f2f2f;box-shadow:inset var(--px) var(--px) 0 #00000059;
  pointer-events:auto;touch-action:none;max-width:calc(100vw - 8px)}
#hud .slot{position:relative;width:var(--slot);height:var(--slot);background:var(--slot-bg);
  border:var(--px) solid #373737;display:grid;place-items:center;
  font:calc(5 * var(--px))/1 ui-monospace,"Courier New",monospace;color:var(--text);
  text-shadow:var(--px) var(--px) 0 var(--text-shadow);white-space:pre-line;text-align:center;
  -webkit-tap-highlight-color:transparent;user-select:none;box-sizing:content-box}
#hud .slot.sprite{background-image:var(--item-sheet);background-size:var(--item-sheet-size);
  background-repeat:no-repeat;image-rendering:pixelated;align-items:end;justify-items:end}
#hud .slot.sprite span{padding:0 var(--px);font-size:calc(5 * var(--px));
  text-shadow:0 0 2px #000,var(--px) var(--px) 0 #000}
#hud .slot .durability{position:absolute;left:var(--px);right:var(--px);bottom:var(--px);
  height:calc(1.5 * var(--px));transform-origin:left center;pointer-events:none}
#hud .slot .durability[hidden]{display:none}
#hud .slot.selected{outline:calc(2 * var(--px)) solid #fff;outline-offset:calc(-1 * var(--px));
  z-index:1}
#hud .slot:focus-visible{outline:calc(2 * var(--px)) solid #7b94c7}
/* Em tela estreita a hotbar encolhe para não passar da borda. */
@media (max-width:560px){#hud .hotbar{--slot:calc(16 * var(--px))}}
@media (prefers-reduced-motion:reduce){#hud *{transition:none!important}}
`;
  document.head.appendChild(css);
}
