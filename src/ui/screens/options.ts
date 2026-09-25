/**
 * Tela de opções (doc 08 §3.11).
 *
 * As configurações já eram persistidas desde o M3; o que faltava era **onde
 * mexer nelas**. Sem esta tela, volume, dificuldade e acessibilidade só existiam
 * para quem sabia editar o `localStorage`.
 *
 * Os campos são declarados como dados e ligados por `buildFields` — acrescentar
 * uma opção é uma linha nas listas abaixo.
 */

import {
  buildFields, buildKeybinds, menuButton, menuPanel, menuRoot, menuRow, menuSection, type Field,
} from './menu';
import type { Keybinds } from '../../input/keybinds';
import type { Gamepads } from '../../input/gamepad';
import { PadTester } from './padtester';
import { BUSES, BUS_LABELS, BUS_SETTING } from '../../data/soundbuses';
import type { SettingsStore } from '../../game/settings';
import { decimal, t, tf } from '../../core/i18n';

const percent = (value: number): string => `${Math.round(value * 100)}%`;

const VIDEO: readonly Field[] = [
  {
    /*
     * Muda no próximo carregamento, e não agora: o tier decide quantos workers
     * o pipeline cria, e eles nascem junto com o mundo. Trocar ao vivo exigiria
     * derrubar e refazer o pool inteiro no meio da partida.
     */
    kind: 'choice', key: 'quality', label: t('opt.quality'),
    options: [
      { value: -1, label: t('opt.auto_f') },
      { value: 0, label: t('opt.low') },
      { value: 1, label: t('opt.medium') },
      { value: 2, label: t('opt.high') },
    ],
  },
  {
    /*
     * Igual à qualidade, e pelo mesmo motivo: o estilo decide os pixels do
     * atlas, que já foi enviado para a GPU, e os da folha de sprites, que já é
     * `background-image` de dezenas de slots. Regerar ao vivo seria refazer os
     * dois e reconstruir toda a interface.
     */
    kind: 'choice', key: 'textureStyle', label: t('opt.textures'),
    options: [
      { value: 'nitido', label: t('opt.tex_sharp') },
      { value: 'classico', label: t('opt.tex_classic') },
    ],
  },
  {
    kind: 'range', key: 'renderDistance', label: t('opt.render_distance'),
    min: 0, max: 16, step: 1,
    format: (v) => (v === 0 ? t('opt.automatic') : tf('opt.chunks', v)),
  },
  {
    /*
     * Distância de **simulação**: o raio em que mob nasce e continua vivo
     * (doc 07 §4). É outra coisa da distância de render, e num aparelho fraco
     * baixá-la vale mais que baixar a de render — mob custa tick, não pixel.
     */
    kind: 'range', key: 'simulationDistance', label: t('opt.simulation_distance'),
    min: 0, max: 8, step: 1,
    format: (v) => (v === 0 ? t('opt.automatic') : tf('opt.chunks', v)),
  },
  {
    kind: 'choice', key: 'graphics', label: t('opt.graphics'),
    options: [
      { value: 'auto', label: t('opt.from_device') },
      { value: 'fast', label: t('opt.graphics_fast') },
      { value: 'fancy', label: t('opt.graphics_fancy') },
    ],
  },
  {
    kind: 'choice', key: 'clouds', label: t('opt.clouds'),
    options: [
      { value: 'auto', label: t('opt.from_device') },
      { value: 'off', label: t('opt.clouds_off') },
      { value: 'fast', label: t('opt.clouds_fast') },
      { value: 'fancy', label: t('opt.clouds_fancy') },
    ],
  },
  {
    kind: 'choice', key: 'particles', label: t('opt.particles'),
    options: [
      { value: 'auto', label: t('opt.from_device') },
      { value: 'min', label: t('opt.particles_min') },
      { value: 'reduced', label: t('opt.particles_reduced') },
      { value: 'all', label: t('opt.particles_all') },
    ],
  },
  {
    kind: 'choice', key: 'fog', label: t('opt.fog'),
    options: [
      { value: 'far', label: t('opt.fog_far') },
      { value: 'near', label: t('opt.fog_near') },
      { value: 'off', label: t('opt.fog_off') },
    ],
  },
  {
    /*
     * Passo de meio, não de um.
     *
     * Com passo 1 o vizinho de "automática" era 1×, e num celular cuja
     * automática já é 2× não havia como pedir só um pouco menor — ou o dobro,
     * ou metade. Meio passo dá 0,5× a 4×, e num aparelho de DPR ≥ 2 o meio
     * continua caindo em pixel inteiro de tela, então a arte não borra.
     */
    kind: 'range', key: 'guiScale', label: t('opt.gui_scale'),
    min: 0, max: 4, step: 0.5,
    format: (v) => (v === 0 ? t('opt.automatic') : `${decimal(v, 1)}×`),
  },
  {
    kind: 'range', key: 'maxFps', label: t('opt.max_fps'),
    min: 0, max: 240, step: 10,
    format: (v) => (v === 0 ? t('opt.monitor') : String(v)),
  },
  {
    kind: 'range', key: 'fov', label: t('opt.fov'),
    min: 30, max: 110, step: 5, format: (v) => `${v}°`,
  },
  {
    kind: 'range', key: 'brightness', label: t('opt.brightness'),
    min: 0, max: 100, step: 5,
    format: (v) => (v === 50 ? t('opt.default') : `${v}%`),
  },
  { kind: 'toggle', key: 'dynamicResolution', label: t('opt.dynamic_resolution') },
  { kind: 'toggle', key: 'entityShadows', label: t('opt.entity_shadows') },
  { kind: 'toggle', key: 'handItem', label: t('opt.hand_item') },
  { kind: 'toggle', key: 'cameraBob', label: t('opt.camera_bob') },
  { kind: 'toggle', key: 'showFps', label: t('opt.show_fps') },
  {
    // Desligar encolhe o mesh além de tirar a sombra de canto — ver
    // `GreedyMesher.smoothLighting`.
    kind: 'toggle', key: 'smoothLighting', label: t('opt.smooth_lighting'),
  },
  {
    /*
     * No navegador não se desliga o vsync: quem apresenta o quadro é o
     * compositor. O que este controle mexe é `desynchronized` — ver
     * `game/settings.ts` e `render/gl.ts`. Desligar já causou piscada num
     * painel de taxa variável, então o rótulo avisa.
     */
    kind: 'toggle', key: 'vsync', label: t('opt.vsync'),
  },
];

/**
 * Som: os **nove** sliders do doc 08 §3.11.
 *
 * Existiam dois (geral e música) porque o motor só tinha cinco barramentos e
 * nenhum deles separava mob hostil de mob amigável. A lista é montada a partir
 * de `data/soundbuses.ts`, então barramento novo aparece aqui sozinho.
 */
const SOUND: readonly Field[] = [
  { kind: 'range', key: 'masterVolume', label: t('opt.master_volume'), min: 0, max: 1, step: 0.05, format: percent },
  ...BUSES.map((bus): Field => ({
    kind: 'range', key: BUS_SETTING[bus], label: BUS_LABELS[bus],
    min: 0, max: 1, step: 0.05, format: percent,
  })),
  { kind: 'toggle', key: 'subtitles', label: t('opt.subtitles') },
];

const CONTROLS: readonly Field[] = [
  {
    kind: 'range', key: 'lookSensitivity', label: t('opt.sensitivity'),
    min: 0.0004, max: 0.008, step: 0.0002,
    format: (v) => `${(v * 1000).toFixed(1)}`,
  },
  { kind: 'toggle', key: 'invertY', label: t('opt.invert_y') },
  { kind: 'toggle', key: 'autoJump', label: t('opt.auto_jump') },
  {
    kind: 'choice', key: 'touchMode', label: t('opt.touch_mode'),
    options: [
      { value: 'A', label: t('opt.touch_a') },
      { value: 'B', label: t('opt.touch_b') },
    ],
  },
  {
    kind: 'range', key: 'longPressMs', label: t('opt.long_press'),
    min: 150, max: 1000, step: 50, format: (v) => `${v} ms`,
  },
  {
    kind: 'range', key: 'touchButtonScale', label: t('opt.button_size'),
    min: 0.7, max: 1.5, step: 0.1, format: (v) => `${decimal(v, 1)}×`,
  },
  { kind: 'toggle', key: 'leftHanded', label: t('opt.left_handed') },
  { kind: 'toggle', key: 'toggleSprint', label: t('opt.toggle_sprint') },
  { kind: 'toggle', key: 'toggleSneak', label: t('opt.toggle_sneak') },
];

/**
 * Controle (doc 09 §3).
 *
 * Fica em seção própria porque a lista de Controles já é a mais longa da tela,
 * e porque nada aqui serve a quem joga de teclado ou de dedo.
 */
const GAMEPAD: readonly Field[] = [
  {
    kind: 'range', key: 'padSensitivity', label: t('opt.stick_sensitivity'),
    min: 0.3, max: 3, step: 0.1, format: (v) => `${decimal(v, 1)}×`,
  },
  {
    /*
     * Zona morta: é o que salva analógico gasto. Um controle com desgaste no
     * centro reporta 0,1 parado e o jogador anda sozinho para um lado.
     */
    kind: 'range', key: 'padDeadZone', label: t('opt.dead_zone'),
    min: 0.05, max: 0.4, step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    kind: 'choice', key: 'padProfile', label: t('opt.layout'),
    options: [
      { value: 'auto', label: t('opt.detect_auto') },
      { value: 'dualsense', label: 'DualSense (PS5)' },
      { value: 'dualshock4', label: 'DualShock 4 (PS4)' },
      { value: 'xbox', label: 'Xbox' },
      { value: 'switch', label: 'Nintendo Switch Pro' },
      { value: 'generic', label: t('opt.generic') },
    ],
  },
  { kind: 'toggle', key: 'vibration', label: t('opt.vibration') },
];

/**
 * Acessibilidade (doc 08 §6).
 *
 * A seção não existia: quem não enxerga bem o texto branco com sombra contra
 * neve, ou para quem o clarão de dano incomoda, não tinha para onde ir.
 */
const ACCESSIBILITY: readonly Field[] = [
  { kind: 'toggle', key: 'highContrast', label: t('opt.high_contrast') },
  { kind: 'toggle', key: 'highContrastOutline', label: t('opt.high_contrast_outline') },
  {
    kind: 'range', key: 'textScale', label: t('opt.text_size'),
    min: 80, max: 150, step: 10, format: (v) => `${v}%`,
  },
  {
    kind: 'choice', key: 'colorBlind', label: t('opt.color_blind'),
    options: [
      { value: 'off', label: t('opt.off') },
      { value: 'protanopia', label: 'Protanopia' },
      { value: 'deuteranopia', label: 'Deuteranopia' },
      { value: 'tritanopia', label: 'Tritanopia' },
    ],
  },
  { kind: 'toggle', key: 'damageFlash', label: t('opt.damage_flash') },
  { kind: 'toggle', key: 'hideSkyFlashes', label: t('opt.hide_sky_flashes') },
  {
    /*
     * Distorção: hoje é o "puxão" de campo de visão ao correr. Em 0% a câmera
     * não mexe — que é o que quem tem enjoo de movimento precisa — e o balanço
     * tem o interruptor próprio, logo acima, em Vídeo.
     */
    kind: 'range', key: 'distortion', label: t('opt.distortion'),
    min: 0, max: 100, step: 10, format: (v) => `${v}%`,
  },
  { kind: 'toggle', key: 'cameraBob', label: t('opt.camera_bob') },
  { kind: 'toggle', key: 'subtitles', label: t('opt.subtitles') },
];

const GAMEPLAY: readonly Field[] = [
  {
    kind: 'choice', key: 'difficulty', label: t('opt.difficulty'),
    options: [
      { value: 0, label: t('opt.peaceful') },
      { value: 1, label: t('opt.easy') },
      { value: 2, label: t('opt.normal') },
      { value: 3, label: t('opt.hard') },
    ],
  },
  { kind: 'toggle', key: 'guide', label: t('opt.guide') },
];

/**
 * Idioma (doc 08 §3.11, M17).
 *
 * O nome de cada idioma vai **nele mesmo**, e não traduzido: quem abriu o jogo
 * no idioma errado procura a palavra que sabe ler. Vale no próximo
 * carregamento (`core/i18n.ts`), e o botão logo abaixo recarrega na hora.
 */
const LANGUAGE: readonly Field[] = [
  {
    kind: 'choice', key: 'language', label: t('opt.language'),
    options: [
      { value: 'auto', label: t('opt.from_device') },
      { value: 'pt', label: 'Português' },
      { value: 'en', label: 'English' },
    ],
  },
];

export class OptionsScreen {
  private readonly root: HTMLDivElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly padStatus: HTMLParagraphElement;
  private readonly padTester = new PadTester();
  private readonly gamepads: Gamepads | null;
  private onClose: (() => void) | null = null;

  constructor(settings: SettingsStore, keybinds: Keybinds, gamepads: Gamepads | null = null) {
    this.gamepads = gamepads;
    this.padStatus = document.createElement('p');
    this.padStatus.className = 'menu-empty';
    this.padStatus.setAttribute('role', 'status');
    this.root = menuRoot('options-screen');
    const { panel, body } = menuPanel(t('opt.title'));

    const sections: [string, readonly Field[]][] = [
      [t('opt.video'), VIDEO],
      [t('opt.sound'), SOUND],
      [t('opt.controls'), CONTROLS],
      [t('opt.gamepad'), GAMEPAD],
      [t('opt.language_section'), LANGUAGE],
      [t('opt.accessibility'), ACCESSIBILITY],
      [t('opt.game'), GAMEPLAY],
    ];
    for (const [title, fields] of sections) {
      const section = menuSection(title);
      buildFields(section, settings, fields);
      body.appendChild(section);
      // As teclas fecham a seção de Controles: elas são a lista mais longa, e
      // deixá-las no fim mantém os sliders no alto, onde se mexe mais.
      if (title === t('opt.controls')) buildKeybinds(section, keybinds);
      /*
       * A primeira pergunta de quem liga um controle é "o jogo está vendo?".
       * A linha de estado responde isso sem o jogador ter que entrar num mundo
       * e tentar andar.
       */
      /*
       * E a segunda pergunta é "o jogo está vendo **este botão**?". O painel de
       * teste responde ela lendo o controle cru, sem perfil nem remapeamento:
       * é o único jeito de separar "o mapeamento está errado" de "o aparelho
       * não manda esse botão".
       */
      if (title === t('opt.gamepad')) section.append(this.padStatus, this.padTester.element);
      /*
       * Recarregar é o mesmo caminho de "Restaurar padrões": com um mundo
       * aberto, o `beforeunload` grava a rede de segurança do save antes.
       */
      if (fields === LANGUAGE) {
        section.appendChild(menuRow(menuButton(t('opt.language_apply'), () => location.reload())));
      }
    }

    const reset = menuButton(t('opt.reset'), () => {
      settings.reset();
      // Recriar a tela é mais simples — e mais confiável — que reposicionar
      // cada controle na mão.
      location.reload();
    }, 'danger');
    this.closeButton = menuButton(t('opt.back'), () => this.hide(), 'primary');

    const actions = document.createElement('div');
    actions.className = 'menu-row';
    actions.append(reset, this.closeButton);
    body.appendChild(actions);

    this.root.appendChild(panel);
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.hide(); }
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(onClose?: () => void): void {
    this.onClose = onClose ?? null;
    this.root.hidden = false;
    this.refreshPadStatus();
    this.padTester.start();
    this.closeButton.focus();
  }

  /** Diz se há controle ligado, qual é, e se o navegador o normalizou. */
  private refreshPadStatus(): void {
    const pads = this.gamepads;
    if (pads === null || !pads.connected) {
      this.padStatus.textContent =
        t('opt.no_pad');
      return;
    }
    const warning = pads.nonStandard
      ? t('opt.pad_nonstandard')
      : '';
    /*
     * A segunda frase não é curiosidade: num Android, o sistema entrega os
     * botões do controle como tecla e o navegador fica com alguns antes de a
     * página ver — no Chrome, `L1` e `R1` trocam de aba, e o jogo nunca os
     * recebe (confirmado em campo, 2026-09-14, com o painel abaixo lendo o
     * controle cru). Não há o que corrigir do lado do jogo; o que há é dizer
     * qual é o caminho que funciona, aqui, onde o jogador está procurando.
     */
    this.padStatus.textContent = tf('opt.pad_connected', pads.labels.family, warning);
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    // Sem isto o painel continuaria lendo o controle com a tela fechada.
    this.padTester.stop();
    this.onClose?.();
  }
}
