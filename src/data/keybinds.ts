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

export type ActionId =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'sneak' | 'sprint'
  | 'inventory' | 'drop' | 'debug';

export interface KeybindDef {
  id: ActionId;
  label: string;
  /** `KeyboardEvent.code` de fábrica. */
  code: string;
}

/**
 * As dez ações remapeáveis, na ordem em que a tela de opções as mostra.
 *
 * **`Escape` e os dígitos 1–9 ficam de fora, de propósito.** `Escape` é a saída
 * de emergência de toda camada de UI (doc 08 §4.1): remapeá-lo cria o estado em
 * que o jogador não consegue mais sair de uma tela. Os dígitos são a hotbar
 * inteira — nove linhas idênticas que ninguém remapeia, e que colidiriam com
 * qualquer outra coisa que alguém pusesse ali.
 */
export const KEYBINDS: readonly KeybindDef[] = [
  { id: 'forward', label: 'Andar para frente', code: 'KeyW' },
  { id: 'back', label: 'Andar para trás', code: 'KeyS' },
  { id: 'left', label: 'Andar para a esquerda', code: 'KeyA' },
  { id: 'right', label: 'Andar para a direita', code: 'KeyD' },
  { id: 'jump', label: 'Pular', code: 'Space' },
  { id: 'sneak', label: 'Agachar', code: 'ShiftLeft' },
  { id: 'sprint', label: 'Correr', code: 'ControlLeft' },
  { id: 'inventory', label: 'Inventário', code: 'KeyE' },
  { id: 'drop', label: 'Largar item', code: 'KeyQ' },
  { id: 'debug', label: 'Tela de depuração', code: 'F3' },
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
    Space: 'Espaço',
    ShiftLeft: 'Shift esq.', ShiftRight: 'Shift dir.',
    ControlLeft: 'Ctrl esq.', ControlRight: 'Ctrl dir.',
    AltLeft: 'Alt esq.', AltRight: 'Alt dir.',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock',
    Backquote: '`', Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/',
  };
  return named[code] ?? code;
}
