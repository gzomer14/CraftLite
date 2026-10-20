/**
 * CSS da tela de contêiner (doc 08 §3.5–§3.10). Saiu de `screen.ts` em
 * 2026-09-22 (M13): é folha de estilo, não comportamento.
 *
 * **M32 (interface nova):** o painel cinza de bordas em relevo virou o painel
 * azul-noite de `ui/theme.ts`, os slots viraram casas fundas de cantos
 * redondos, e as três exceções de layout por tamanho de tela (coluna única,
 * deitado, larga) saíram. Agora o painel é **sempre** em linha — à esquerda o
 * que é da tela (criação, fornalha, baú), à direita a mochila — e quem garante
 * que ele cabe é `ContainerScreen.fit`, que escolhe o `--px` local. Nada rola.
 */

import { DOLL_WIDTH_UNITS } from './paperdoll';
import { injectTheme } from '../theme';

/** Fantasmas das casas de armadura vazias: o contorno da peça, não o nome. */
const GHOSTS: Record<string, string> = {
  head: 'M5 14V10a7 7 0 0 1 14 0v4h-4v-3H9v3z',
  chest: 'M8 3l4 2 4-2 4 4-3 3v11H7V10L4 7z',
  legs: 'M7 4h10v8l-1 9h-3l-1-7-1 7H8l-1-9z',
  feet: 'M6 6h4v9h6v4H6zM14 15v4',
  offhand: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
};

function ghostCss(): string {
  let out = '';
  for (const [name, d] of Object.entries(GHOSTS)) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='${d}' fill='none' stroke='white' stroke-width='2' stroke-linejoin='round'/></svg>`;
    out += `#container-screen .slot.ghost[data-ghost=${name}]{background-image:url("data:image/svg+xml,${encodeURIComponent(svg)}");`
      + 'background-size:60%;background-position:center;background-repeat:no-repeat}\n';
  }
  return out;
}

let styleInjected = false;
export function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  injectTheme();
  const css = document.createElement('style');
  css.textContent = `
#container-screen{position:fixed;inset:0;z-index:12;background:var(--cl-dim);display:grid;place-items:center;
  font:700 calc(4.5 * var(--px,3px))/1.2 var(--cl-font);color:var(--cl-ink);overflow:hidden;
  touch-action:none;overscroll-behavior:contain;padding:6px;box-sizing:border-box}
#container-screen .panel{position:relative;background:var(--cl-panel);border-radius:18px;
  box-shadow:0 0 0 3px var(--cl-edge),0 18px 40px rgba(0,0,0,.55);
  padding:calc(3 * var(--px,3px)) calc(4 * var(--px,3px)) calc(4 * var(--px,3px));outline:none;
  display:flex;flex-direction:column;gap:calc(3 * var(--px,3px))}
#container-screen .panel-header{display:flex;align-items:center;gap:10px;min-height:44px}
#container-screen .title{font:900 max(16px,calc(6 * var(--px,3px)))/1.1 var(--cl-font);white-space:nowrap}
#container-screen .tabs{display:flex;gap:8px;margin-left:6px}
#container-screen .spacer{flex:1}
#container-screen .panel-body{display:flex;flex-direction:row;align-items:stretch;gap:calc(5 * var(--px,3px))}
#container-screen .panel-main{min-width:0;display:flex}
#container-screen .grid{display:flex;flex-direction:row;align-items:flex-start;gap:calc(6 * var(--px,3px))}
#container-screen .grid-col{display:flex;flex-direction:column;justify-content:center;align-self:stretch;min-width:0;
  gap:calc(2 * var(--px,3px))}
#container-screen .grid-col:empty{display:none}
#container-screen .grid-col.side-row{flex-direction:row;align-items:center;gap:calc(5 * var(--px,3px))}
#container-screen .section-title{font:800 max(11px,calc(3.6 * var(--px,3px)))/1.2 var(--cl-font);
  color:#9fb4d6;letter-spacing:.06em;text-transform:uppercase;margin:0 0 calc(1 * var(--px,3px))}
#container-screen .slots{display:grid;grid-template-columns:repeat(var(--cols),auto);
  gap:calc(1.2 * var(--px,3px));justify-content:start}
#container-screen .hotbar .slots{padding:calc(1.2 * var(--px,3px));margin:calc(-1.2 * var(--px,3px));
  border-radius:12px;background:rgba(255,200,61,.08)}
#container-screen .slots.result{grid-template-columns:auto;justify-items:center;gap:calc(1.5 * var(--px,3px))}
#container-screen .arrow{display:grid;place-items:center;color:var(--cl-gold);
  font:900 calc(8 * var(--px,3px))/1 var(--cl-font)}
/* A casa: funda, de cantos redondos. A borda tem a cor do fundo e faz o
   respiro em volta do sprite (que pinta só a caixa de dentro). */
#container-screen .slot{position:relative;touch-action:none;box-sizing:border-box;
  width:calc(18 * var(--px,3px));height:calc(18 * var(--px,3px));min-width:28px;min-height:28px;
  border-radius:calc(2.6 * var(--px,3px));background-color:var(--cl-slot);background-clip:padding-box;
  border:calc(1.6 * var(--px,3px)) solid var(--cl-slot);border-top-color:#060b14;
  box-shadow:0 0 0 calc(.7 * var(--px,3px)) var(--cl-slot-edge);
  display:grid;place-items:center;color:#fff;white-space:pre-line;text-align:center;cursor:pointer;
  -webkit-tap-highlight-color:transparent;user-select:none}
#container-screen .slot.big{width:calc(24 * var(--px,3px));height:calc(24 * var(--px,3px));
  box-shadow:0 0 0 calc(1 * var(--px,3px)) var(--cl-gold),0 0 calc(5 * var(--px,3px)) rgba(255,200,61,.35)}
#container-screen .slot.ghost span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
#container-screen .slot.ghost{opacity:.85}
${ghostCss()}
#container-screen .slot.filled{background-color:var(--item-color,#3a4a66)}
#container-screen .slot.enchanted{box-shadow:0 0 0 calc(.7 * var(--px,3px)) #b46ee8,0 0 calc(4 * var(--px,3px)) #b46ee8}
#container-screen .slot:hover{filter:brightness(1.25)}
#container-screen .slot:focus-visible{outline:calc(1 * var(--px,3px)) solid var(--cl-gold);outline-offset:1px}
#container-screen .slot.sprite,#container-screen .cursor.sprite{background-image:var(--item-sheet);
  background-size:var(--item-sheet-size);background-repeat:no-repeat;image-rendering:pixelated}
#container-screen .slot span{pointer-events:none}
#container-screen .slot.sprite span,#container-screen .slot.filled span{position:absolute;right:calc(-.6 * var(--px,3px));
  bottom:calc(-1.2 * var(--px,3px));font:900 max(11px,calc(4.4 * var(--px,3px)))/1 var(--cl-font);
  text-shadow:1px 1px 0 #000,-1px 1px 0 #000,1px -1px 0 #000,-1px -1px 0 #000}
#container-screen .slot.filled:not(.sprite) span{position:static;font-size:max(9px,calc(3 * var(--px,3px)))}
#container-screen .durability{position:absolute;left:0;right:0;bottom:calc(-.8 * var(--px,3px));
  height:calc(1.2 * var(--px,3px));background:#5ad04a;transform-origin:left center;border-radius:2px}
/* Mochila: armadura em coluna ao lado do boneco, a mão secundária embaixo. */
#container-screen .loadout{display:flex;align-items:center;gap:calc(3 * var(--px,3px))}
#container-screen .loadout .armor{display:flex;flex-direction:column;gap:calc(1.2 * var(--px,3px))}
#container-screen .loadout .figure{display:flex;flex-direction:column;align-items:center;gap:calc(2 * var(--px,3px))}
#container-screen .paperdoll{width:calc(${DOLL_WIDTH_UNITS} * var(--px,3px));height:auto;image-rendering:pixelated;
  touch-action:none;border-radius:14px;background:radial-gradient(circle at 50% 40%,#2a4067,#15223a 70%);
  padding:calc(2 * var(--px,3px))}
#container-screen .craft{display:flex;flex-direction:column;align-items:center;gap:calc(1.5 * var(--px,3px))}
/* Fornalha: entrada em cima, chama no meio, combustível embaixo; a barra
   anda até a saída. */
#container-screen .furnace{display:flex;align-items:center;gap:calc(4 * var(--px,3px))}
#container-screen .furnace .stack{display:flex;flex-direction:column;align-items:center;gap:calc(1.5 * var(--px,3px))}
#container-screen .flame{width:calc(9 * var(--px,3px));height:calc(9 * var(--px,3px));border-radius:4px;
  background:#2a1b14;position:relative;overflow:hidden}
#container-screen .flame i{position:absolute;inset:0;background:linear-gradient(#ffd75a,#ff7a1a);
  transform-origin:bottom center;transform:scaleY(0)}
#container-screen .arrow-bar{width:calc(22 * var(--px,3px));height:calc(6 * var(--px,3px));border-radius:6px;
  background:#0c1524;position:relative;overflow:hidden}
#container-screen .arrow-bar i{position:absolute;inset:0;background:var(--cl-gold);transform-origin:left center;
  transform:scaleX(0)}
#container-screen .slot-caption{margin-top:2px;color:var(--cl-muted);white-space:nowrap;text-align:center;
  font:700 max(10px,calc(3.2 * var(--px,3px)))/1.2 var(--cl-font)}
/* Estação de trabalho (mesa, bigorna, preparo): slots com o nome embaixo. */
#container-screen .station{display:flex;align-items:flex-start;gap:calc(2 * var(--px,3px))}
#container-screen .station-cell{display:flex;flex-direction:column;align-items:center}
#container-screen .station .slot.ghost span{display:none}
#container-screen .station-sign{display:flex;align-items:center;color:var(--cl-gold);
  height:max(34px,calc(18 * var(--px,3px)));font:900 max(16px,calc(6 * var(--px,3px)))/1 var(--cl-font)}
#container-screen .station-help{color:var(--cl-ink);max-width:max(190px,calc(84 * var(--px,3px)));
  font:600 max(11px,calc(3.6 * var(--px,3px)))/1.35 var(--cl-font)}
#container-screen .station-help.blocked{color:#ff8a8d}
#container-screen .station-note{color:var(--cl-muted);font:600 max(10px,calc(3.2 * var(--px,3px)))/1.3 var(--cl-font)}
#container-screen .offers{display:flex;flex-direction:column;gap:calc(1.2 * var(--px,3px))}
#container-screen .offer{min-height:36px;padding:4px 10px;text-align:left;white-space:pre-line;border:0;border-radius:10px;
  background:#2a2342;color:#cfc4e6;cursor:pointer;font:700 max(11px,calc(3.8 * var(--px,3px)))/1.25 var(--cl-font)}
#container-screen .offer.affordable{background:#5b2a8a;color:#fff;box-shadow:0 3px 0 #2c1245}
#container-screen .offer.short{color:#f0b8b8}
#container-screen .offer:disabled{cursor:not-allowed;opacity:.6}
#container-screen .offer:focus-visible{outline:2px solid var(--cl-gold)}
#container-screen .enchant,#container-screen .anvil{display:flex;flex-direction:column;gap:calc(1.5 * var(--px,3px))}
#container-screen .anvil input{width:max(170px,calc(60 * var(--px,3px)));min-height:36px;padding:2px 10px;
  border:0;border-radius:10px;background:#0d1626;color:#fff;box-shadow:0 0 0 2px var(--cl-edge);
  font:700 max(14px,calc(4 * var(--px,3px)))/1.25 var(--cl-font)}
#container-screen .anvil input:disabled{opacity:.5}
#container-screen .offer.trade{display:flex;align-items:center;gap:calc(2 * var(--px,3px))}
#container-screen .trade-icon{width:calc(14 * var(--px,3px));height:calc(14 * var(--px,3px));pointer-events:none;flex:none}
#container-screen .trade-arrow{font-size:calc(5 * var(--px,3px))}
#container-screen .trade-left{margin-left:auto;font-size:calc(3.5 * var(--px,3px))}
#container-screen .offer-hint{color:var(--cl-muted);font-size:max(11px,calc(3.8 * var(--px,3px)))}
/* O livro de receitas, em coluna à esquerda: ocupa a altura que a mochila
   já tem, e a lista rola dentro dele — é a lista longa que a regra 1 deixa. */
#container-screen .book-slot{position:relative;flex:none;width:max(180px,calc(66 * var(--px,3px)))}
#container-screen .book-slot[hidden]{display:none}
#container-screen .book-slot .recipe-book{position:absolute;inset:0;margin:0;padding:0;border:0}
#container-screen .cursor{position:fixed;left:0;top:0;pointer-events:none;z-index:14;background:#000a;
  padding:2px 4px;border-radius:6px;white-space:pre-line;text-align:center;
  font:900 calc(4.5 * var(--px,3px))/1.1 var(--cl-font);color:#fff}
#container-screen .cursor.sprite{width:calc(16 * var(--px,3px));height:calc(16 * var(--px,3px));
  background-color:transparent;padding:0;display:grid;place-items:end;text-shadow:1px 1px 0 #000}
#container-screen .tooltip{position:fixed;left:0;top:0;pointer-events:none;z-index:13;background:#0b1220f2;
  border-radius:8px;box-shadow:0 0 0 2px var(--cl-edge);padding:5px 8px;white-space:pre-line;
  font:600 12px/1.35 var(--cl-font);color:#fff;max-width:240px}
@media (prefers-reduced-motion:reduce){#container-screen *{transition:none!important}}
`;
  document.head.appendChild(css);
}
