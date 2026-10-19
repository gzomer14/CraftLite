/**
 * Folha de estilo do HUD (doc 08 §1–§2) e o ícone da fome, que ela usa como
 * máscara. Saiu de `hud.ts` no M24, que passava de 700 linhas: é folha de
 * estilo, não comportamento — o mesmo corte do `containers/screenstyle.ts`.
 * `hud.ts` re-exporta `DRUMSTICK` e `maskFrom`.
 */

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

let styleInjected = false;
export function injectStyle(): void {
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
