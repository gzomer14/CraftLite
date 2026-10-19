/**
 * O que o jogo baixa **depois**, na primeira vez que precisa (M25): telas e
 * funções que quase ninguém usa a cada partida — exportar e importar mundo,
 * os créditos do fim, o editor de placa e a tela de armazenamento cheio.
 *
 * Saíram do pedaço principal para abrir folga para o conteúdo dos M26–M29:
 * medido com gzip, ~3 KB a menos para abrir o jogo. O pedaço vai para `u/`, entra no
 * precache do service worker (funciona offline) e é importado por URL em
 * `ui/lategate.ts`, como a sala do M20 — sem o ajudante de pré-carga do Vite,
 * que viraria um arquivo a mais para todo mundo.
 */

export { archiveFileName, exportWorld, importWorld } from '../save/archive';
export { CreditsScreen } from './screens/credits';
export { SignEditor } from './screens/signeditor';
export { StorageFullScreen } from './screens/storagefull';
