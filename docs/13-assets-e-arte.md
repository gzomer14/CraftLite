# 13 — Assets, Arte e Licenciamento

## 1. Regra fundamental

**Nenhum asset do jogo original entra neste projeto.** Nem texturas, nem sons, nem fontes, nem
modelos, nem os textos de splash, nem o nome, nem o logo, nem paletas extraídas de arquivos do
jogo. Também não usamos "resource packs" de terceiros sem licença compatível.

Isso não é só uma questão jurídica — é uma decisão técnica que **serve ao orçamento**: gerar as
texturas por código custa ~0 KB de download e ~15 ms de boot, contra centenas de KB de PNGs.

O que copiamos é o que não é protegido: **mecânicas, constantes de gameplay e convenções de layout**
(um inventário com 27 slots em grade 9×3 é uma escolha funcional, não uma obra de arte).

**Identidade própria obrigatória:** nome, logo, fonte, paleta e frases de splash são criações
originais do projeto.

## 2. Geração procedural de texturas

Todas as texturas de bloco são 16×16 RGBA, desenhadas em um `OffscreenCanvas` no boot e
enviadas para um `TEXTURE_2D_ARRAY`.

### 2.1 Motor de textura

```ts
interface TexRecipe {
  base: [r: number, g: number, b: number];
  variance: number;          // 0..1, quanto o ruído desvia da cor base
  noise: 'value' | 'cell' | 'stripes' | 'grain' | 'flat';
  scale: number;             // frequência do ruído
  seed: number;              // determinístico por textura
  ops?: TexOp[];             // camadas: speckle, border, gradient, overlay, mask
}
```

Operadores disponíveis (todos são ~10 linhas cada):

| Op | Efeito | Usado em |
|---|---|---|
| `valueNoise(scale, amp)` | ruído suave por célula | pedra, terra |
| `speckle(color, density, size)` | pontinhos aleatórios | minérios, cascalho |
| `stripes(dir, period, contrast)` | listras | madeira (anéis), tábuas |
| `border(color, width)` | moldura | tábuas, tijolos |
| `bricks(w, h, mortar)` | padrão de tijolo deslocado | stone_bricks, brick |
| `blobs(color, count, radius)` | manchas orgânicas | folhas, grama |
| `gradientV(top, bottom)` | degradê vertical | areia, lateral de grama |
| `dither(intensity)` | dithering ordenado (Bayer 4×4) | tudo, para dar cara de pixel art |
| `alphaMask(shape)` | recorte | folhas (buracos), vidro, grade |
| `emboss(strength)` | relevo falso via derivada | pedra, minério |

### 2.2 Receitas de exemplo

```ts
stone:      { base:[125,125,125], noise:'value', scale:4, variance:0.12, ops:[dither(0.06), emboss(0.2)] }
cobblestone:{ base:[122,122,122], noise:'cell',  scale:3, variance:0.22, ops:[emboss(0.5), dither(0.05)] }
dirt:       { base:[134,96,67],   noise:'grain', scale:6, variance:0.16, ops:[speckle([110,78,54],0.15,1)] }
grass_top:  { base:[255,255,255], noise:'value', scale:5, variance:0.10 }   // cinza → tintado por bioma
sand:       { base:[219,207,163], noise:'grain', scale:8, variance:0.08 }
oak_log_side:{ base:[105,84,50],  noise:'stripes', scale:2, variance:0.18, ops:[dither(0.08)] }
oak_log_top:{ base:[152,122,73],  noise:'cell',   scale:2, ops:[rings(4)] }
oak_planks: { base:[159,132,77],  noise:'stripes',scale:1, variance:0.10, ops:[border([120,98,56],1), plankLines(4)] }
leaves:     { base:[255,255,255], noise:'cell',   scale:4, variance:0.25, ops:[alphaMask('holes', 0.25)] }
coal_ore:   { inherit:'stone', ops:[oreBlobs([28,28,28], 6)] }
iron_ore:   { inherit:'stone', ops:[oreBlobs([216,175,147], 6)] }
diamond_ore:{ inherit:'stone', ops:[oreBlobs([94,225,224], 5)] }
water:      { base:[63,118,228], noise:'value', scale:3, variance:0.06, alpha:0.75, animated:8 }
```

`oreBlobs` desenha blobs de 2–4 px arredondados com contorno mais escuro — é o que dá o
reconhecimento imediato do minério.

**Legibilidade é requisito, não acabamento.** Bloco construído (baú, bancada, fornalha, estante,
porta, cama, TNT) precisa de **estrutura desenhada**, não de `inherit` do material com um
`tintBy(0.9x)` por cima: ferragem, dobradiça, gaveta, lombada de livro, faixa. Um baú que é tábua
8% mais escura só se distingue pelo tooltip, e num bloco como o TNT isso deixa de ser estética.
As primitivas para isso são `rect` e `outline`.

O critério é a **diferença média por pixel** contra o material de origem, em [0, 255]. Tábuas de
carvalho contra tábuas de bétula — um par que se distingue sem esforço — dá 48; abaixo de **22** o
jogador não separa os dois em jogo. `tests/texgen.test.ts` verifica os pares construídos contra
esse piso, e falha se algum voltar a ser tinta sobre o material.

### 2.3 Texturas animadas
Água, lava e fogo: gerar N quadros (8 para água, 16 para lava/fogo) usando o mesmo ruído com
offset de tempo, e alternar a camada do texture array a cada 2–4 ticks. Custo: N camadas a mais.

### 2.4 Sprites de item
16×16, desenhados por código com um mini-DSL de formas:

```ts
pickaxe: [ shape('handle', [7,8,2,7], BROWN), shape('head', 'pickaxe', MATERIAL_COLOR) ]
```
Ferramentas compartilham a mesma silhueta e só trocam a cor do material — 5 tiers × 5 tipos = 25
sprites com 5 desenhos. O mesmo vale para armadura.

Itens que são blocos: renderizar o cubo em projeção isométrica (2:1) usando as três texturas de
face — feito uma vez no boot, em canvas 2D. Isso resolve ~60 sprites de graça.

## 3. Texturas de entidade

Cada mob usa uma textura 64×64 (layout de "box mapping"), também gerada por código: retângulos
de cor sólida com ruído leve + detalhes (olhos, boca) desenhados com `fillRect`. É pixel art de
baixa resolução; 15–30 linhas por mob.

## 4. Fonte

Fonte bitmap **original** de 5×7 px (mais 1 px de espaçamento), cobrindo:
- ASCII imprimível (0x20–0x7E)
- Acentos do português: `À Á Â Ã Ç É Ê Í Ó Ô Õ Ú` e minúsculas
- Símbolos: `♥ ★ ← → ↑ ↓ ▲ ▼ ■ □ ⛏`

Armazenada como um array de máscaras de bits (`Uint8Array`, 7 bytes por glifo = ~700 bytes para
100 glifos) e rasterizada para um canvas no boot. Sombra: desenhar o glifo em `#3F3F3F` com
offset (1,1) e depois em branco.

Fallback CSS para textos longos: `ui-monospace, "Courier New", monospace`.

## 5. Ícones de HUD

Coração, coxa, escudo, bolha, armadura: desenhados em código com paths de canvas 2D em 9×9 px.
Estados: cheio, meio, vazio, e variantes (envenenado = verde, congelado = azul, absorção = dourado).

## 6. Ícone do app / PWA

Gerar 192×192 e 512×512 no boot (ou em build time por um script Node) a partir do logo do projeto,
e registrar via `Blob URL` no manifest — ou simplesmente comitar 2 PNGs pequenos (< 8 KB total),
já que o manifest precisa de URLs reais.

## 7. Se um dia quiser texturas "de verdade"

Suporte opcional a **resource pack**: o jogador arrasta um `.zip` com PNGs nomeados conforme a
convenção (`block/stone.png`, `item/diamond.png`) e o jogo substitui as camadas do atlas em
runtime. Assim quem quiser arte customizada usa a própria, sem que o projeto distribua nada.
Deixar o carregador do atlas preparado para isso (uma função `loadOverrides(map)`).

## 8. Créditos e licença

- Código: MIT (ou o que você preferir).
- Assets gerados: mesma licença do código, já que são gerados por ele.
- Adicionar um `CREDITS.md` e uma tela de créditos no jogo.
- No README e na tela de título, deixar claro que é um projeto independente, sem afiliação com
  nenhuma empresa de jogos.
