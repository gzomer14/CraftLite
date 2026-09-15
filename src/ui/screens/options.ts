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
  buildFields, buildKeybinds, menuButton, menuPanel, menuRoot, menuSection, type Field,
} from './menu';
import type { Keybinds } from '../../input/keybinds';
import type { Gamepads } from '../../input/gamepad';
import { PadTester } from './padtester';
import { BUSES, BUS_LABELS, BUS_SETTING } from '../../data/soundbuses';
import type { SettingsStore } from '../../game/settings';

const percent = (value: number): string => `${Math.round(value * 100)}%`;

const VIDEO: readonly Field[] = [
  {
    /*
     * Muda no próximo carregamento, e não agora: o tier decide quantos workers
     * o pipeline cria, e eles nascem junto com o mundo. Trocar ao vivo exigiria
     * derrubar e refazer o pool inteiro no meio da partida.
     */
    kind: 'choice', key: 'quality', label: 'Qualidade (recarrega)',
    options: [
      { value: -1, label: 'Automática' },
      { value: 0, label: 'Baixa' },
      { value: 1, label: 'Média' },
      { value: 2, label: 'Alta' },
    ],
  },
  {
    /*
     * Igual à qualidade, e pelo mesmo motivo: o estilo decide os pixels do
     * atlas, que já foi enviado para a GPU, e os da folha de sprites, que já é
     * `background-image` de dezenas de slots. Regerar ao vivo seria refazer os
     * dois e reconstruir toda a interface.
     */
    kind: 'choice', key: 'textureStyle', label: 'Texturas (recarrega)',
    options: [
      { value: 'nitido', label: 'Nítidas — com relevo e volume' },
      { value: 'classico', label: 'Clássicas — chapadas' },
    ],
  },
  {
    kind: 'range', key: 'renderDistance', label: 'Distância de render',
    min: 0, max: 16, step: 1,
    format: (v) => (v === 0 ? 'automática' : `${v} chunks`),
  },
  {
    /*
     * Distância de **simulação**: o raio em que mob nasce e continua vivo
     * (doc 07 §4). É outra coisa da distância de render, e num aparelho fraco
     * baixá-la vale mais que baixar a de render — mob custa tick, não pixel.
     */
    kind: 'range', key: 'simulationDistance', label: 'Distância de simulação',
    min: 0, max: 8, step: 1,
    format: (v) => (v === 0 ? 'automática' : `${v} chunks`),
  },
  {
    kind: 'choice', key: 'graphics', label: 'Gráficos',
    options: [
      { value: 'auto', label: 'Do aparelho' },
      { value: 'fast', label: 'Rápido — ajusta tudo para baixo' },
      { value: 'fancy', label: 'Bonito — ajusta tudo para cima' },
    ],
  },
  {
    kind: 'choice', key: 'clouds', label: 'Nuvens',
    options: [
      { value: 'auto', label: 'Do aparelho' },
      { value: 'off', label: 'Desligadas' },
      { value: 'fast', label: 'Rápidas' },
      { value: 'fancy', label: 'Bonitas' },
    ],
  },
  {
    kind: 'choice', key: 'particles', label: 'Partículas',
    options: [
      { value: 'auto', label: 'Do aparelho' },
      { value: 'min', label: 'Mínimo' },
      { value: 'reduced', label: 'Reduzido' },
      { value: 'all', label: 'Todas' },
    ],
  },
  {
    kind: 'choice', key: 'fog', label: 'Névoa',
    options: [
      { value: 'far', label: 'Distante' },
      { value: 'near', label: 'Próxima' },
      { value: 'off', label: 'Mínima' },
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
    kind: 'range', key: 'guiScale', label: 'Escala da interface',
    min: 0, max: 4, step: 0.5,
    format: (v) => (v === 0 ? 'automática' : `${v.toFixed(1).replace('.', ',')}×`),
  },
  {
    kind: 'range', key: 'maxFps', label: 'Limite de FPS',
    min: 0, max: 240, step: 10,
    format: (v) => (v === 0 ? 'do monitor' : String(v)),
  },
  {
    kind: 'range', key: 'fov', label: 'Campo de visão',
    min: 30, max: 110, step: 5, format: (v) => `${v}°`,
  },
  {
    kind: 'range', key: 'brightness', label: 'Brilho',
    min: 0, max: 100, step: 5,
    format: (v) => (v === 50 ? 'padrão' : `${v}%`),
  },
  { kind: 'toggle', key: 'dynamicResolution', label: 'Resolução dinâmica' },
  { kind: 'toggle', key: 'entityShadows', label: 'Sombra de criaturas' },
  { kind: 'toggle', key: 'handItem', label: 'Item na mão' },
  { kind: 'toggle', key: 'cameraBob', label: 'Balanço da câmera' },
  { kind: 'toggle', key: 'showFps', label: 'Mostrar FPS' },
  {
    // Desligar encolhe o mesh além de tirar a sombra de canto — ver
    // `GreedyMesher.smoothLighting`.
    kind: 'toggle', key: 'smoothLighting', label: 'Iluminação suave (recarrega)',
  },
  {
    /*
     * No navegador não se desliga o vsync: quem apresenta o quadro é o
     * compositor. O que este controle mexe é `desynchronized` — ver
     * `game/settings.ts` e `render/gl.ts`. Desligar já causou piscada num
     * painel de taxa variável, então o rótulo avisa.
     */
    kind: 'toggle', key: 'vsync', label: 'VSync (recarrega)',
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
  { kind: 'range', key: 'masterVolume', label: 'Principal', min: 0, max: 1, step: 0.05, format: percent },
  ...BUSES.map((bus): Field => ({
    kind: 'range', key: BUS_SETTING[bus], label: BUS_LABELS[bus],
    min: 0, max: 1, step: 0.05, format: percent,
  })),
  { kind: 'toggle', key: 'subtitles', label: 'Legendas de som' },
];

const CONTROLS: readonly Field[] = [
  {
    kind: 'range', key: 'lookSensitivity', label: 'Sensibilidade',
    min: 0.0004, max: 0.008, step: 0.0002,
    format: (v) => `${(v * 1000).toFixed(1)}`,
  },
  { kind: 'toggle', key: 'invertY', label: 'Inverter eixo Y' },
  { kind: 'toggle', key: 'autoJump', label: 'Pulo automático' },
  {
    kind: 'choice', key: 'touchMode', label: 'Modo de toque',
    options: [
      { value: 'A', label: 'A — mira no dedo' },
      { value: 'B', label: 'B — botões dedicados' },
    ],
  },
  {
    kind: 'range', key: 'longPressMs', label: 'Toque longo',
    min: 150, max: 1000, step: 50, format: (v) => `${v} ms`,
  },
  {
    kind: 'range', key: 'touchButtonScale', label: 'Tamanho dos botões',
    min: 0.7, max: 1.5, step: 0.1, format: (v) => `${v.toFixed(1)}×`,
  },
  { kind: 'toggle', key: 'leftHanded', label: 'Canhoto' },
  { kind: 'toggle', key: 'toggleSprint', label: 'Correr alterna' },
  { kind: 'toggle', key: 'toggleSneak', label: 'Agachar alterna' },
];

/**
 * Controle (doc 09 §3).
 *
 * Fica em seção própria porque a lista de Controles já é a mais longa da tela,
 * e porque nada aqui serve a quem joga de teclado ou de dedo.
 */
const GAMEPAD: readonly Field[] = [
  {
    kind: 'range', key: 'padSensitivity', label: 'Sensibilidade do analógico',
    min: 0.3, max: 3, step: 0.1, format: (v) => `${v.toFixed(1).replace('.', ',')}×`,
  },
  {
    /*
     * Zona morta: é o que salva analógico gasto. Um controle com desgaste no
     * centro reporta 0,1 parado e o jogador anda sozinho para um lado.
     */
    kind: 'range', key: 'padDeadZone', label: 'Zona morta',
    min: 0.05, max: 0.4, step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    kind: 'choice', key: 'padProfile', label: 'Layout',
    options: [
      { value: 'auto', label: 'Detectar automaticamente' },
      { value: 'dualsense', label: 'DualSense (PS5)' },
      { value: 'dualshock4', label: 'DualShock 4 (PS4)' },
      { value: 'xbox', label: 'Xbox' },
      { value: 'switch', label: 'Nintendo Switch Pro' },
      { value: 'generic', label: 'Genérico' },
    ],
  },
  { kind: 'toggle', key: 'vibration', label: 'Vibração' },
];

/**
 * Acessibilidade (doc 08 §6).
 *
 * A seção não existia: quem não enxerga bem o texto branco com sombra contra
 * neve, ou para quem o clarão de dano incomoda, não tinha para onde ir.
 */
const ACCESSIBILITY: readonly Field[] = [
  { kind: 'toggle', key: 'highContrast', label: 'Alto contraste' },
  { kind: 'toggle', key: 'highContrastOutline', label: 'Contorno de bloco em alto contraste' },
  {
    kind: 'range', key: 'textScale', label: 'Tamanho do texto',
    min: 80, max: 150, step: 10, format: (v) => `${v}%`,
  },
  {
    kind: 'choice', key: 'colorBlind', label: 'Modo daltônico',
    options: [
      { value: 'off', label: 'Desligado' },
      { value: 'protanopia', label: 'Protanopia' },
      { value: 'deuteranopia', label: 'Deuteranopia' },
      { value: 'tritanopia', label: 'Tritanopia' },
    ],
  },
  { kind: 'toggle', key: 'damageFlash', label: 'Clarão ao levar dano' },
  { kind: 'toggle', key: 'hideSkyFlashes', label: 'Esconder flashes do céu' },
  {
    /*
     * Distorção: hoje é o "puxão" de campo de visão ao correr. Em 0% a câmera
     * não mexe — que é o que quem tem enjoo de movimento precisa — e o balanço
     * tem o interruptor próprio, logo acima, em Vídeo.
     */
    kind: 'range', key: 'distortion', label: 'Efeitos de distorção',
    min: 0, max: 100, step: 10, format: (v) => `${v}%`,
  },
  { kind: 'toggle', key: 'cameraBob', label: 'Balanço da câmera' },
  { kind: 'toggle', key: 'subtitles', label: 'Legendas de som' },
];

const GAMEPLAY: readonly Field[] = [
  {
    kind: 'choice', key: 'difficulty', label: 'Dificuldade',
    options: [
      { value: 0, label: 'Pacífico' },
      { value: 1, label: 'Fácil' },
      { value: 2, label: 'Normal' },
      { value: 3, label: 'Difícil' },
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
    const { panel, body } = menuPanel('Opções');

    const sections: [string, readonly Field[]][] = [
      ['Vídeo', VIDEO],
      ['Som', SOUND],
      ['Controles', CONTROLS],
      ['Controle', GAMEPAD],
      ['Acessibilidade', ACCESSIBILITY],
      ['Jogo', GAMEPLAY],
    ];
    for (const [title, fields] of sections) {
      const section = menuSection(title);
      buildFields(section, settings, fields);
      body.appendChild(section);
      // As teclas fecham a seção de Controles: elas são a lista mais longa, e
      // deixá-las no fim mantém os sliders no alto, onde se mexe mais.
      if (title === 'Controles') buildKeybinds(section, keybinds);
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
      if (title === 'Controle') section.append(this.padStatus, this.padTester.element);
    }

    const reset = menuButton('Restaurar padrões', () => {
      settings.reset();
      // Recriar a tela é mais simples — e mais confiável — que reposicionar
      // cada controle na mão.
      location.reload();
    }, 'danger');
    this.closeButton = menuButton('Voltar', () => this.hide(), 'primary');

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
        'Nenhum controle detectado. Conecte por cabo ou Bluetooth e aperte um botão dele.';
      return;
    }
    const warning = pads.nonStandard
      ? ' — o navegador não reconheceu este modelo, então o mapeamento é o da família.'
      : '';
    /*
     * A segunda frase não é curiosidade: num Android, o sistema entrega os
     * botões do controle como tecla e o navegador fica com alguns antes de a
     * página ver — no Chrome, `L1` e `R1` trocam de aba, e o jogo nunca os
     * recebe (confirmado em campo, 2026-09-14, com o painel abaixo lendo o
     * controle cru). Não há o que corrigir do lado do jogo; o que há é dizer
     * qual é o caminho que funciona, aqui, onde o jogador está procurando.
     */
    this.padStatus.textContent = `Conectado: ${pads.labels.family}${warning}`
      + ' Aperte os botões: o painel abaixo mostra o que o aparelho manda de verdade.'
      + ' Se algum botão não aparecer nele, o navegador ficou com ele antes do jogo —'
      + ' é o que acontece com L1/R1 no Chrome do Android, que os usa para trocar de aba.'
      + ' O direcional ←→ também troca o item da mão.';
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    // Sem isto o painel continuaria lendo o controle com a tela fechada.
    this.padTester.stop();
    this.onClose?.();
  }
}
