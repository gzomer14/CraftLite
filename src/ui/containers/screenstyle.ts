/**
 * CSS da tela de contêiner (doc 08 §3.5–§3.10). Saiu de `screen.ts` em
 * 2026-09-22 (M13): é folha de estilo, não comportamento.
 */

import { DOLL_WIDTH_UNITS } from './paperdoll';

let styleInjected = false;
export function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
/* Rolagem da janela (queixa de campo, 2026-09-10). Duas coisas impediam
   arrastar o inventário no celular:
   - touch-action:none no elemento raiz desliga a rolagem por toque do
     navegador. Estava aqui para o arraste de pilha entre slots não rolar a
     tela junto, mas os slots já chamam preventDefault() no pointerdown, então
     o lugar certo da regra é o slot, não a janela inteira. pan-y libera o
     arraste vertical e segue bloqueando o horizontal e o pinch.
   - place-items:center com conteúdo mais alto que a tela deixa o topo
     inalcançável: o painel é centralizado e transborda para os dois lados,
     sem como rolar para antes do começo. safe center centraliza quando cabe e
     alinha no início quando não cabe.
   overscroll-behavior:contain impede a rolagem vazar para a página atrás. */
#container-screen{position:fixed;inset:0;z-index:12;background:#00000080;
  display:grid;place-items:safe center;font:calc(4.5 * var(--px,3px))/1.2 ui-monospace,monospace;
  color:#fff;image-rendering:pixelated;touch-action:pan-y;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;overflow:auto;padding:8px}
#container-screen .panel{background:#c6c6c6;color:#3f3f3f;padding:calc(4 * var(--px,3px));
  border-top:calc(2 * var(--px,3px)) solid #fff;border-left:calc(2 * var(--px,3px)) solid #fff;
  border-right:calc(2 * var(--px,3px)) solid #555;border-bottom:calc(2 * var(--px,3px)) solid #555;
  max-width:min(96vw,640px);outline:none}
#container-screen .title{font-weight:700;margin-bottom:calc(2 * var(--px,3px))}
/* Slot de equipamento vazio: o nome da peça, apagado, some assim que entra item. */
#container-screen .slot.ghost span{font-size:calc(2.4 * var(--px,3px));color:#6b6b6b;
  position:absolute;inset:0;display:grid;place-items:center;text-shadow:none}
#container-screen .footer{display:flex;margin-top:calc(3 * var(--px,3px))}
#container-screen .close{flex:1;min-height:44px;background:#6e6e6e;color:#fff;
  border:2px solid #000;font:14px/1 ui-monospace,monospace;cursor:pointer}
#container-screen .close:hover,#container-screen .close:focus-visible{background:#7b94c7}
/* Dica do toque longo: discreta, abaixo da grade e acima dos botões. */
#container-screen .touch-hint{margin-top:calc(2 * var(--px,3px));color:#3f3f3f;
  font:calc(4 * var(--px,3px))/1.3 ui-monospace,monospace;text-align:center}
#container-screen .panel-header{display:flex;align-items:center;justify-content:space-between;
  gap:calc(4 * var(--px,3px));margin-bottom:calc(2 * var(--px,3px))}
#container-screen .panel-header .title{margin-bottom:0}
#container-screen .book-toggle{flex:none;
  min-height:32px;padding:4px 8px;background:#6e6e6e;color:#fff;border:2px solid #000;
  font:calc(4 * var(--px,3px))/1 ui-monospace,monospace;cursor:pointer}
#container-screen .book-toggle:hover,#container-screen .book-toggle:focus-visible{
  background:#7b94c7;outline:2px solid #fff}
#container-screen .section-title{margin:calc(2 * var(--px,3px)) 0 calc(1 * var(--px,3px));
  font-size:calc(4 * var(--px,3px))}
#container-screen .grid{display:flex;flex-direction:column}
#container-screen .grid-col{display:flex;flex-direction:column;min-width:0}
#container-screen .grid-col:empty{display:none}
#container-screen .panel-body{display:flex;flex-direction:column;align-items:stretch}
#container-screen .panel-main{min-width:0}
/*
 * Tela larga: o livro vira coluna à direita e a grade deita.
 *
 * São os dois lados do mesmo desperdício. A fileira de 9 slots da mochila
 * manda na largura do painel, e a grade 3×3 da bancada, empilhada em cima
 * dela, deixava metade da linha vazia; o livro, empilhado embaixo, estourava a
 * altura da tela. Deitando a grade o vazio some, e o livro passa a ocupar a
 * faixa que sobra à direita, na altura do próprio botão que o abre.
 *
 * 900px é onde as três faixas (criação + mochila + livro) cabem sem apertar.
 */
@media (min-width:900px){
  #container-screen .panel-body{flex-direction:row;align-items:flex-start;
    column-gap:calc(4 * var(--px,3px))}
  #container-screen .panel.with-book{max-width:min(96vw,960px)}
  #container-screen .panel-body .recipe-book{flex:none;width:calc(84 * var(--px,3px));
    margin-top:0;border-top:none;padding-top:0;
    border-left:var(--px,3px) solid #555;padding-left:calc(4 * var(--px,3px));
    align-self:stretch}
  #container-screen .panel-body .recipe-book .list{max-height:calc(96 * var(--px,3px))}
  #container-screen .grid{flex-flow:row wrap;align-items:flex-start;
    column-gap:calc(6 * var(--px,3px))}
}
/*
 * Celular deitado: ~360 px de altura e largura de sobra. Em coluna única o
 * painel do inventário passava de 700 px e o jogador nunca via a grade de
 * criação e a mochila ao mesmo tempo.
 *
 * flex-wrap, e nao multi-coluna do CSS: aquele reparte a largura em partes
 * iguais, e a fileira de 9 slots da mochila é mais larga que metade do painel
 * — ela vazava para fora da borda. Aqui cada coluna toma a largura que precisa
 * e, quando as duas são largas (baú), elas empilham em vez de transbordar.
 */
@media (max-height:560px) and (orientation:landscape){
  #container-screen .grid{flex-flow:row wrap;align-items:flex-start;
    column-gap:calc(6 * var(--px,3px))}
}
/* Boneco: largura em unidades de modelo, para acompanhar a escala da GUI. */
#container-screen .section.doll{align-items:flex-start}
#container-screen .paperdoll{width:calc(${DOLL_WIDTH_UNITS} * var(--px,3px));height:auto;
  image-rendering:pixelated;touch-action:none}
#container-screen .slots{display:grid;grid-template-columns:repeat(var(--cols),auto);
  gap:calc(1 * var(--px,3px));justify-content:start;margin-bottom:calc(2 * var(--px,3px))}
#container-screen .slots.result{grid-template-columns:auto auto;align-items:center;
  gap:calc(3 * var(--px,3px))}
#container-screen .arrow{font-size:calc(6 * var(--px,3px));color:#555}
#container-screen .slot{position:relative;touch-action:none;width:calc(18 * var(--px,3px));
  height:calc(18 * var(--px,3px));background:#8b8b8b;
  border-top:var(--px,3px) solid #373737;border-left:var(--px,3px) solid #373737;
  border-right:var(--px,3px) solid #fff;border-bottom:var(--px,3px) solid #fff;
  display:grid;place-items:center;color:#fff;white-space:pre-line;text-align:center;
  cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;
  text-shadow:var(--px,3px) var(--px,3px) 0 #3f3f3f;min-width:32px;min-height:32px}
#container-screen .slot.filled{background:var(--item-color,#8b8b8b)}
/* Brilho do encantamento: um véu roxo por cima do sprite, sem animação para
   não custar frame em aparelho fraco. */
#container-screen .slot.enchanted{box-shadow:inset 0 0 calc(4 * var(--px,3px)) #b46ee8}
#container-screen .offers{display:flex;flex-direction:column;gap:calc(1 * var(--px,3px));
  margin-bottom:calc(2 * var(--px,3px))}
#container-screen .offer{min-height:36px;padding:4px 8px;text-align:left;white-space:pre-line;
  background:#4a3a5e;color:#cfcfcf;border:2px solid #000;cursor:pointer;
  font:calc(4 * var(--px,3px))/1.25 ui-monospace,monospace}
#container-screen .offer.affordable{background:#5b2a8a;color:#fff}
#container-screen .offer:disabled{cursor:not-allowed;opacity:.6}
#container-screen .offer:focus-visible{outline:2px solid #fff}
/* Troca com aldeão (M9): o item que ele quer, a seta e o que ele dá. */
#container-screen .offer.trade{display:flex;align-items:center;gap:calc(2 * var(--px,3px))}
#container-screen .trade-icon{width:calc(14 * var(--px,3px));height:calc(14 * var(--px,3px));
  pointer-events:none;flex:none}
#container-screen .trade-arrow{font-size:calc(5 * var(--px,3px))}
#container-screen .trade-left{margin-left:auto;font-size:calc(3.5 * var(--px,3px))}
#container-screen .offer-hint{margin-bottom:calc(2 * var(--px,3px));color:#3f3f3f;
  font-size:calc(4 * var(--px,3px))}
/* Sprite: a folha inteira é o fundo e o background-position escolhe o tile. */
#container-screen .slot.sprite,#container-screen .cursor.sprite{
  background-image:var(--item-sheet);background-size:var(--item-sheet-size);
  background-repeat:no-repeat;background-color:#8b8b8b;image-rendering:pixelated}
#container-screen .slot.sprite span{align-self:end;justify-self:end;
  padding:0 calc(1 * var(--px,3px));font-size:calc(5 * var(--px,3px))}
#container-screen .cursor.sprite{width:calc(16 * var(--px,3px));
  height:calc(16 * var(--px,3px));background-color:transparent;padding:0;
  display:grid;place-items:end}
#container-screen .slot.filled span{
  /* Contorno escuro para o texto ficar legível sobre qualquer cor de bloco. */
  text-shadow:0 0 2px #000,var(--px,3px) var(--px,3px) 0 #000}
#container-screen .slot:hover{filter:brightness(1.2)}
#container-screen .slot:focus-visible{outline:calc(2 * var(--px,3px)) solid #7b94c7}
#container-screen .durability{position:absolute;left:var(--px,3px);right:var(--px,3px);
  bottom:var(--px,3px);height:calc(1.5 * var(--px,3px));background:#5ad04a;
  transform-origin:left center}
#container-screen .cursor{position:fixed;left:0;top:0;pointer-events:none;z-index:14;
  background:#00000099;padding:2px 4px;white-space:pre-line;text-align:center;
  font:calc(4.5 * var(--px,3px))/1.1 ui-monospace,monospace;color:#fff}
#container-screen .tooltip{position:fixed;left:0;top:0;pointer-events:none;z-index:13;
  background:#100010f0;border:1px solid #5b2a8a;padding:4px 6px;white-space:pre-line;
  font:12px/1.35 ui-monospace,monospace;color:#fff;max-width:240px}
#container-screen .furnace-progress{display:flex;align-items:center;gap:8px;
  margin-bottom:calc(2 * var(--px,3px))}
#container-screen .flame{width:calc(8 * var(--px,3px));height:calc(8 * var(--px,3px));
  background:#555;position:relative;overflow:hidden}
#container-screen .flame i{position:absolute;inset:0;background:#ff9d2e;
  transform-origin:bottom center;transform:scaleY(0)}
#container-screen .arrow-bar{width:calc(22 * var(--px,3px));height:calc(6 * var(--px,3px));
  background:#555;position:relative;overflow:hidden}
#container-screen .arrow-bar i{position:absolute;inset:0;background:#fff;
  transform-origin:left center;transform:scaleX(0)}
@media (prefers-reduced-motion:reduce){#container-screen *{transition:none!important}}
`;
  document.head.appendChild(css);
}
