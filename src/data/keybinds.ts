/**
 * Ações remapeáveis do teclado (doc 08 §3.11, seção Controles).
 *
 * Tabela declarativa: acrescentar uma ação é uma linha aqui mais o uso do id em
 * `input/controls.ts` — nunca um `bind('KeyX', …)` solto no meio do código, que
 * é o que impedia a tela de opções de saber que a tecla existia.
 *
 * O código é o **físico** (`KeyboardEvent.code`), não o caractere: `KeyW`
 * continua sendo a tecla de cima num teclado AZERTY, onde o caractere é `Z`.
 * É a mesma escolha de `input/keyboard.ts`, e é por isso que o rótulo mostrado
 * ao jogador passa por `keyLabel`.
 */
import { t, tf } from '../core/i18n';

export type ActionId =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'sneak' | 'sprint'
  | 'inventory' | 'drop' | 'debug' | 'map';

export interface KeybindDef {
  id: ActionId;
  label: string;
  /** `KeyboardEvent.code` de fábrica. */
  code: string;
}

/**
 * As onze ações remapeáveis, na ordem em que a tela de opções as mostra.
 *
 * **`Escape` e os dígitos 1–9 ficam de fora, de propósito.** `Escape` é a saída
 * de emergência de toda camada de UI (doc 08 §4.1): remapeá-lo cria o estado em
 * que o jogador não consegue mais sair de uma tela. Os dígitos são a hotbar
 * inteira — nove linhas idênticas que ninguém remapeia, e que colidiriam com
 * qualquer outra coisa que alguém pusesse ali.
 */
export const KEYBINDS: readonly KeybindDef[] = [
  { id: 'forward', label: t('key.forward'), code: 'KeyW' },
  { id: 'back', label: t('key.back'), code: 'KeyS' },
  { id: 'left', label: t('key.left_move'), code: 'KeyA' },
  { id: 'right', label: t('key.right_move'), code: 'KeyD' },
  { id: 'jump', label: t('touch.jump'), code: 'Space' },
  { id: 'sneak', label: t('touch.sneak'), code: 'ShiftLeft' },
  { id: 'sprint', label: t('key.sprint'), code: 'ControlLeft' },
  { id: 'inventory', label: t('touch.inventory'), code: 'KeyE' },
  { id: 'drop', label: t('key.drop'), code: 'KeyQ' },
  { id: 'debug', label: t('key.debug'), code: 'F3' },
  // M10: o mapa explorado (precisa de um mapa no inventário, ou do Criativo).
  { id: 'map', label: t('map.title'), code: 'KeyM' },
];

/** Teclas que nenhuma ação pode tomar: elas são a saída de toda tela. */
export const RESERVED_CODES: readonly string[] = [
  'Escape', 'Tab', 'F5', 'F11', 'F12',
];

/**
 * Nome legível de um `code`, para o botão da tela de opções.
 *
 * Só o que o `code` **garante**: letra, dígito, função e as teclas com nome
 * próprio. O resto sai como está — é feio, mas é honesto, e o jogador acabou de
 * apertar a tecla, então ele sabe qual é.
 */
export function keyLabel(code: string): string {
  if (code === '') return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const named: Record<string, string> = {
    Space: t('key.space'),
    ShiftLeft: tf('key.left', 'Shift'), ShiftRight: tf('key.right', 'Shift'),
    ControlLeft: tf('key.left', 'Ctrl'), ControlRight: tf('key.right', 'Ctrl'),
    AltLeft: tf('key.left', 'Alt'), AltRight: tf('key.right', 'Alt'),
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock',
    Backquote: '`', Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/',
  };
  return named[code] ?? code;
}
