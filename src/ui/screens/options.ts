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

import { buildFields, menuButton, menuPanel, menuRoot, menuSection, type Field } from './menu';
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
];

const SOUND: readonly Field[] = [
  { kind: 'range', key: 'masterVolume', label: 'Volume geral', min: 0, max: 1, step: 0.05, format: percent },
  { kind: 'range', key: 'musicVolume', label: 'Música', min: 0, max: 1, step: 0.05, format: percent },
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
  {
    kind: 'range', key: 'textScale', label: 'Tamanho do texto',
    min: 80, max: 150, step: 10, format: (v) => `${v}%`,
  },
  { kind: 'toggle', key: 'damageFlash', label: 'Clarão ao levar dano' },
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
  private onClose: (() => void) | null = null;

  constructor(settings: SettingsStore) {
    this.root = menuRoot('options-screen');
    const { panel, body } = menuPanel('Opções');

    const sections: [string, readonly Field[]][] = [
      ['Vídeo', VIDEO],
      ['Som', SOUND],
      ['Controles', CONTROLS],
      ['Acessibilidade', ACCESSIBILITY],
      ['Jogo', GAMEPLAY],
    ];
    for (const [title, fields] of sections) {
      const section = menuSection(title);
      buildFields(section, settings, fields);
      body.appendChild(section);
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
    this.closeButton.focus();
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.onClose?.();
  }
}
