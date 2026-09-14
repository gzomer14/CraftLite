# 08 — Interface do Usuário

> Toda a UI é **DOM + CSS** sobreposta ao canvas. Isso é mais barato que desenhar no canvas, dá
> acessibilidade de graça e permite escalar por `--gui-scale` sem re-renderizar nada.
> A arte é **original** do projeto (ver [13-assets-e-arte.md](13-assets-e-arte.md)) — o layout segue
> as convenções do gênero porque são as que o jogador já sabe usar.
> Wireframes originais de cada tela estão em [mockups/](mockups/).

## 1. Sistema de escala

```css
:root {
  --gui-scale: 3;                    /* 1..4, auto por resolução */
  --px: calc(var(--gui-scale) * 1px); /* unidade base: 1 "pixel de GUI" */
  --slot: calc(18 * var(--px));       /* slot = 18px de GUI (16 + 1 de borda) */
}
```
Auto-scale: `scale = clamp(floor(min(w/320, h/240)), 1, 4)`. No celular, mínimo 3 para que os
alvos de toque tenham ≥ 44 px reais.

**Toda a UI usa `image-rendering: pixelated`** e posições em múltiplos de `--px`.

## 2. Paleta e estilo

| Token | Valor | Uso |
|---|---|---|
| `--panel-bg` | `#C6C6C6` | fundo de painel de container |
| `--panel-shadow` | `#555555` | borda inferior/direita (3D) |
| `--panel-light` | `#FFFFFF` | borda superior/esquerda (3D) |
| `--slot-bg` | `#8B8B8B` | fundo de slot |
| `--slot-hover` | `#FFFFFF80` | overlay branco no slot sob o cursor |
| `--btn` / `--btn-hover` | `#6E6E6E` / `#7B94C7` | botão normal / com foco |
| `--btn-disabled` | `#4A4A4A` | |
| `--text` / `--text-shadow` | `#FFFFFF` / `#3F3F3F` | sombra offset (1px, 1px) |
| `--overlay-dim` | `#00000080` | escurece o mundo atrás do menu |
| `--heart-red` / `--hunger` / `--armor` / `--xp` | `#DC0000` / `#C68A45` / `#C0C0C0` / `#7FFF00` | |

Fonte: bitmap monoespaçada 5×7 desenhada em código (ver doc 13), com fallback
`ui-monospace, "Courier New", monospace`.

Botão padrão: 200×20 px de GUI, texto centralizado, borda 3D de 1px, `:hover` clareia e mostra
outline branco.

---

## 3. Telas

### 3.1 Tela de título — `mockups/01-title.svg`

```
┌───────────────────────────────────────────────┐
│        (fundo: panorama 3D girando            │
│         lentamente — cena de mundo real        │
│         renderizada com FOV 85, yaw += 0.02°   │
│         por frame; em T0, imagem estática      │
│         com leve pan para economizar GPU)      │
│                                               │
│             ██  LOGO DO JOGO  ██               │
│                (splash amarelo girando)        │
│                                               │
│            ┌───────────────────┐              │
│            │   Um Jogador      │              │
│            └───────────────────┘              │
│            ┌───────────────────┐              │
│            │   Multijogador    │  (desabilitado no MVP)
│            └───────────────────┘              │
│            ┌───────────────────┐              │
│            │   Opções...       │              │
│            └───────────────────┘              │
│            ┌────────┐ ┌────────┐              │
│            │ Idioma │ │  Sair  │              │
│            └────────┘ └────────┘              │
│ v0.1.0                        © projeto livre  │
└───────────────────────────────────────────────┘
```
- **Splash text**: frase aleatória em amarelo, rotacionada −20°, escalando com
  `1 + sin(t*0.006)*0.1`. Lista de frases **originais** (não copiar as do jogo original).
- Botão "Um Jogador" tem foco por padrão (navegável por teclado e gamepad).

### 3.2 Seleção de mundos — `mockups/02-worlds.svg`

Lista rolável de cards, cada um:
```
┌──────┬────────────────────────────────────────┐
│ [16] │ Meu Mundo                              │
│ img  │ 05/09/2026 14:32 — Sobrevivência, Normal│
│      │ 4,2 MB                                  │
└──────┴────────────────────────────────────────┘
```
- Miniatura: screenshot do último frame salvo (128×72 JPEG em IndexedDB).
- Ações no rodapé: **Jogar**, **Editar**, **Excluir**, **Recriar (mesma seed)**, **Criar Novo Mundo**.
- Excluir pede confirmação em modal.
- Campo de busca no topo se houver > 6 mundos.

### 3.3 Criar mundo — `mockups/03-create-world.svg`

| Campo | Controle | Padrão |
|---|---|---|
| Nome do Mundo | texto | "Novo Mundo" |
| Modo de Jogo | ciclo: Sobrevivência / Criativo | Sobrevivência |
| Dificuldade | ciclo: Pacífico / Fácil / Normal / Difícil | Normal |
| Seed | texto (vazio = aleatória) | vazio |
| Gerar Estruturas | toggle | ON |
| Bônus de Baú | toggle | OFF |
| Tipo de Mundo | ciclo: Padrão / Superplano / Ilhas / Amplificado | Padrão |
| **Mais Opções...** | expande: ciclo de dia/noite, dano de fogo, drop ao morrer, tick de fogo | |

Rodapé: **Criar Novo Mundo** / **Cancelar**.

### 3.4 HUD em jogo — `mockups/04-hud.svg`

```
                       ┌─┐
                       │+│  crosshair (9×9, blend "difference" p/ ficar visível em tudo)
                       └─┘

  ♥♥♥♥♥♥♥♥♥♥                              🍗🍗🍗🍗🍗🍗🍗🍗🍗🍗
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ XP ▓▓▓▓▓▓▓▓▓▓▓▓  (nível "12" centralizado sobre a barra)
  ┌──┬──┬──┬──┬──┬──┬──┬──┬──┐
  │  │  │▓▓│  │  │  │  │  │  │   hotbar 9 slots, 20×20 de GUI cada
  └──┴──┴──┴──┴──┴──┴──┴──┴──┘   slot selecionado com moldura branca 24×24
```
Elementos, todos em `position:fixed`, `pointer-events:none`:

| Elemento | Posição | Regra |
|---|---|---|
| Crosshair | centro | Some no Espectador; vira ponto no mobile (o toque manda) |
| Hotbar | bottom center, 8px de GUI de margem | 9 slots; item + contagem + barra de durabilidade |
| Corações | acima da hotbar, esquerda | 10 corações, meio-coração; **tremem** quando vida ≤ 4; overlay dourado = Absorção |
| Fome | acima da hotbar, direita | 10 coxas; balançam quando envenenado (verde) |
| Armadura | acima dos corações | só aparece se armor > 0 |
| Bolhas de ar | acima da fome | só debaixo d'água, 10 bolhas |
| Barra de XP | acima da hotbar, largura total (182 px de GUI) | + nível em verde com contorno preto |
| Nome do item | acima da hotbar, centralizado | aparece 2 s ao trocar de slot, fade out |
| Chat/logs | canto superior esquerdo | últimas 10 linhas, fade após 10 s |
| Barra de montaria | substitui a fome ao montar | |
| Vinheta | tela toda | escurece nas bordas conforme a luz do ambiente / vida baixa |
| **Toast de conquista** | canto superior direito | slide-in, 5 s |
| Indicador de autosave | canto inferior direito | ícone girando |

### 3.5 Inventário (Sobrevivência) — `mockups/05-inventory.svg`

Painel de **176 × 166** px de GUI:
```
┌─────────────────────────────────────────┐
│ [cabeça]                    ┌──┬──┐  ╔═╗ │
│ [peito ]   ┌──────────┐     │  │  │  ║→║ │  crafting 2×2 + resultado
│ [calça ]   │ boneco 3D │     ├──┼──┤  ╚═╝ │
│ [botas ]   │ do jogador│     │  │  │      │
│            └──────────┘                   │
│ [offhand]                                 │
│                                           │
│ ┌──┬──┬──┬──┬──┬──┬──┬──┬──┐             │
│ │  │  │  │  │  │  │  │  │  │  ← 27 slots │
│ ├──┼──┼──┼──┼──┼──┼──┼──┼──┤    (9×3)    │
│ │  │  │  │  │  │  │  │  │  │             │
│ ├──┼──┼──┼──┼──┼──┼──┼──┼──┤             │
│ │  │  │  │  │  │  │  │  │  │             │
│ └──┴──┴──┴──┴──┴──┴──┴──┴──┘             │
│ ┌──┬──┬──┬──┬──┬──┬──┬──┬──┐  ← hotbar   │
│ │  │  │  │  │  │  │  │  │  │             │
│ └──┴──┴──┴──┴──┴──┴──┴──┴──┘             │
└─────────────────────────────────────────┘
      [📖 livro de receitas]  (botão à esquerda)
```
- **Slots totais: 4 armadura + 1 offhand + 27 principal + 9 hotbar + 4 craft + 1 resultado = 46.**
- **Boneco 3D**: renderiza o modelo do jogador num canvas WebGL pequeno (ou reusa o principal com
  scissor). Segue o mouse/toque com a cabeça. Em T0, pode ser um sprite estático.
- **Livro de receitas**: painel lateral esquerdo de 147 px, com abas
  (Tudo / Construção / Equipamento / Diversos / Redstone), busca por texto e grade de receitas.
  Clicar numa receita **preenche a grade automaticamente** com itens do inventário.
  Receitas desconhecidas aparecem em silhueta cinza. O filtro "só o que dá" nasce **desligado**:
  ligado, o livro de quem acabou de entrar no mundo abria vazio, que é o oposto do que ele serve. Novas receitas geram toast ao serem desbloqueadas.

**Meia pilha e uma unidade no dedo.** A tabela abaixo é escrita em botões de
mouse, e no toque **não existe botão direito** — `PointerEvent.button` é sempre
0. Sem um gesto para ele, todo toque move a pilha inteira, e montar uma receita
que pede uma tábua em cada célula fica impossível: o jogador coloca as 24 de
uma vez. **No toque, o toque longo vale como o botão direito** — pega metade
com a mão vazia, solta uma unidade com a mão cheia.

Para isso a ação de toque resolve **ao soltar o dedo**, e não ao encostar. O
arraste de distribuição entre slots não se perde nessa troca porque ele nunca
funcionou no dedo: o ponteiro de toque recebe captura implícita no elemento do
`pointerdown`, então os outros slots nunca recebem `pointerenter`. Ele é, e
segue sendo, um gesto de mouse. Escorregar o dedo cancela os dois — é rolagem,
não escolha.

O gesto não tem como ser descoberto sozinho (no mouse o botão direito é
convenção de trinta anos; no dedo não há convenção nenhuma), então o painel
mostra uma linha de dica no ponteiro grosso.

**Nome do item sem mouse.** No toque não há hover, e o `title` do HTML nunca aparece — tocar um
item da paleta criativa o mandava para a hotbar sem nunca dizer o que ele era. **Toque longo**
(mesmo `longPressMs` das opções) mostra o rótulo e **cancela a ação daquele toque**; o toque curto
continua fazendo o que fazia. Na tela de container a ação resolve no `pointerdown`, de que depende
o arraste de distribuição entre slots — lá o rótulo aparece **junto** com a ação, em vez de no
lugar dela. Escorregar o dedo cancela a consulta: é rolagem, não pergunta.

**Interações de slot (obrigatório reproduzir todas):**

| Ação | Efeito |
|---|---|
| Clique esquerdo em slot com item | Pega o stack inteiro no "cursor" |
| Clique esquerdo com cursor cheio, slot vazio | Solta tudo |
| Clique esquerdo com cursor cheio, slot com item igual | Junta até o limite de stack |
| Clique esquerdo com cursor cheio, slot com item diferente | Troca |
| **Clique direito** em slot com item | Pega **metade** (arredondando pra cima) |
| **Clique direito** com cursor cheio | Solta **1 item** |
| **Shift + clique** | Move o stack para o "outro" contêiner (inventário↔hotbar↔baú) |
| **Arrastar com botão esquerdo** por vários slots | Distribui igualmente entre eles |
| **Arrastar com botão direito** | Distribui 1 por slot |
| **Duplo clique** | Junta todos os stacks iguais do inventário no cursor |
| **Tecla 1–9** com mouse sobre um slot | Troca com aquele slot da hotbar |
| **Q** / **Ctrl+Q** | Joga 1 item / o stack inteiro no chão |
| Clicar fora do painel com cursor cheio | Joga no chão |

> **O que é jogado fora sai na direção do olhar.** Largar um item com um
> empurrão aleatório o deixa a menos de meio bloco de quem o largou — dentro da
> caixa de coleta — e ele volta para a mochila sozinho meio segundo depois, o
> que na prática é não ter como se livrar de nada. O item sai para a frente, e
> o que o jogador jogou fora só pode ser recolhido **dois segundos** depois; o
> que cai de um bloco quebrado continua sendo pego na hora.

**Tooltip** ao passar o mouse: nome (cor por raridade) + descrição + durabilidade
("Durabilidade: 231 / 250") + encantamentos em azul-claro. Fundo `#100010F0` com borda roxa.

### 3.6 Inventário Criativo — `mockups/06-creative.svg`

- **Abas** no topo e no rodapé (ícone de bloco representativo cada):
  Blocos de Construção · Decoração · Redstone · Transporte · Diversos · Comida · Ferramentas ·
  Combate · Poções · **Busca** 🔍 · **Inventário do Jogador** 💾 · **Salvar Hotbar** ⭐
- Grade de **9×5 = 45 slots** por página + barra de rolagem à direita.
- Aba de busca: campo de texto no topo, filtra por nome e por tag.
- Pegar item da grade = cópia infinita. Arrastar item para a grade = deletar.
- Botão "Destruir item" (ícone de lixeira) no canto.

### 3.7 Bancada de trabalho — `mockups/07-crafting.svg`
Painel 176×166. Grade **3×3** (posição x=30,y=17 em px de GUI), seta, slot de resultado
(x=124,y=35), inventário e hotbar embaixo. Botão de livro de receitas.

### 3.8 Fornalha — `mockups/08-furnace.svg`
```
┌──────────────────────────────┐
│         Fornalha             │
│      ┌──┐                    │
│      │▒▒│  ← entrada         │
│      └──┘   ╱▔▔▔╲            │
│      ┌──┐  │ ═══► │   ┌──┐   │
│      │🔥│   ╲___╱     │  │ ← saída
│      └──┘  seta de     └──┘   │
│    combustível  progresso     │
│  [inventário 3×9]             │
│  [hotbar]                     │
└──────────────────────────────┘
```
- Chama animada (altura proporcional ao combustível restante, 0–13 px).
- Seta de progresso preenchendo da esquerda para a direita (0–22 px).

### 3.9 Baú — `mockups/09-chest.svg`
Painel 176×(114 + 54): **27 slots (9×3)** no topo; baú duplo = **54 (9×6)**, painel mais alto.
Animação de tampa abrindo no mundo + som.

### 3.10 Menu de pausa — `mockups/10-pause.svg`
Fundo desfocado (`backdrop-filter: blur(4px)` — desligar em T0, usar só dim) e escurecido.
Botões: **Voltar ao Jogo** · Conquistas · Estatísticas · Opções... · **Salvar e Sair**.
No mobile, o botão de pause fica no canto superior direito do HUD.

### 3.11 Opções — `mockups/11-options.svg`

Menu raiz: **Vídeo**, **Controles**, **Som**, **Idioma**, **Acessibilidade**, e no rodapé
**Concluído**. Cada submenu é uma lista rolável de 2 colunas.

**Vídeo**
| Opção | Tipo | Valores | Padrão |
|---|---|---|---|
| Distância de Renderização | slider | 2–16 chunks | auto por tier |
| Distância de Simulação | slider | 2–8 | 4 |
| Escala de Renderização | slider | 50–100% | 100 |
| FPS Máximo | slider | 30 / 60 / 120 / ilimitado | 60 |
| VSync | toggle | on/off | on |
| Gráficos | ciclo | Rápido / Bonito | por tier |
| Iluminação Suave (AO) | toggle | | on |
| Nuvens | ciclo | Off / Rápido / Bonito | por tier |
| Partículas | ciclo | Mínimo / Reduzido / Todas | por tier |
| Sombras de Entidade | toggle | | por tier |
| Brilho (gamma) | slider | 0–100% | 50 |
| FOV | slider | 30–110 | 70 |
| Escala da GUI | slider | Auto/1/2/3/4 | auto |
| Balanço da Câmera | toggle | | on |
| Mostrar FPS | toggle | | off |
| Névoa (fog) | ciclo | Off / Próxima / Distante | Distante |

**Controles**
- Sensibilidade do mouse (0–200%), Inverter Y, Auto-pulo (padrão **ON no mobile**, OFF no desktop),
  Agachar/Correr como alternar ou segurar.
- Lista completa de teclas remapeáveis (clicar → pressionar tecla; conflito fica em vermelho).
- **Controles de Toque** (só no mobile): tamanho do joystick, opacidade dos botões,
  sensibilidade do arraste de câmera, **Editar layout dos botões** (ver [09-controles-mobile.md](09-controles-mobile.md)).

**Som**
Sliders 0–100%: Principal, Música, Blocos, Mobs Hostis, Mobs Amigáveis, Jogadores, Ambiente,
Clima, Interface. Toggle de legendas de som (closed captions).

**Acessibilidade**
Alto contraste, opacidade de fundo de texto, tamanho do texto, balanço da câmera, efeitos de
distorção (0–100%), clarão de dano, esconder flashes do céu, contorno de bloco em alto contraste,
modo daltônico (protanopia/deuteranopia/tritanopia — remapeia a paleta de HUD).

> **Escala da GUI e alvo de toque são coisas separadas.** A escala automática já valeu
> `max(3, …)` no ponteiro grosso, para garantir 44 px de alvo. O efeito foi o contrário do
> pretendido: num celular deitado (~360 px de altura) o cálculo honesto dá 1, o piso forçava 3 —
> a mesma escala de um desktop de 1280×800 — e o painel do inventário saía com 755 px numa tela
> de 360. O piso é **2**, e os 44 px são garantidos onde importam: nos botões de toque, por
> `min-width`/`min-height` próprios.

**Painel de container em tela baixa.** Abaixo de 560 px de altura em paisagem, as seções do painel
fluem em **duas colunas** (equipamento/criação/resultado de um lado, mochila/hotbar do outro). Em
coluna única o inventário não cabe em nenhum celular deitado, e a largura sobra justamente ali.

> As duas colunas são **contêineres no DOM com `flex-wrap`**, não multi-coluna do CSS. O
> multi-coluna reparte a largura em partes iguais, e a fileira de 9 slots da mochila é mais larga
> que metade do painel — ela vazava para fora da borda. Com contêineres, cada coluna toma a largura
> de que precisa e, quando as duas são largas (baú), elas empilham em vez de transbordar.

**Escala da GUI: passo de meio.** O slider vai de `automática` a 4× em passos de 0,5. Com passo 1 o
vizinho de `automática` era 1×, e num aparelho cuja automática já é 2× não havia como pedir só um
pouco menor. Num aparelho de DPR ≥ 2 o meio passo cai em pixel inteiro de tela, então a arte não
borra. A escala reage à opção na hora — ela só era recalculada no boot e no `resize`, então mexer
no slider trocava o rótulo e não mudava nada na tela.

**Linha de objetivo.** O HUD mostra, no canto superior esquerdo, o próximo passo da árvore de
conquistas (`nextObjective`). É o único lugar onde o jogo diz o que fazer: a dica de teclas some
ao travar o ponteiro e a tela de conquistas está atrás de duas telas.

**Conquistas à vista.** A lista revela **um passo à frente**: conquista sem `parent`, ou cujo
`parent` já foi obtido, mostra nome e objetivo; o resto continua em "???". Mostrar todas de uma
vez entrega o jogo, e esconder todas — como era — deixa a tela sem função.

### 3.12 Tela de morte — `mockups/12-death.svg`
Overlay vermelho translúcido (`#5A0000A0`), texto grande **"Você morreu!"**, mensagem da causa
("Você caiu de um lugar alto"), pontuação, botões **Reaparecer** e **Sair do Mundo**.

### 3.13 Tela de debug (F3)
Texto monoespaçado, 2 colunas, fundo `#00000060`. Conteúdo em [02-orcamento-performance.md](02-orcamento-performance.md) §6.

### 3.14 Chat / comandos (pós-MVP)
Abre com `T` ou `/`. Comandos: `/gamemode`, `/time set`, `/tp`, `/give`, `/seed`, `/weather`,
`/difficulty`, `/kill`, `/summon`. Autocomplete com Tab.

## 4. Regras de UI transversais

1. **`Esc` fecha uma camada por vez** (tooltip → container → menu → jogo).
2. Abrir qualquer container **libera o pointer lock** e pausa a rotação de câmera (mas o mundo
   continua rodando — não é pausa de verdade, exceto o menu de pausa em single-player).
3. Todas as telas são navegáveis por **teclado** (Tab/setas/Enter) e por **gamepad** (D-pad/A/B).
   No gamepad o direcional anda pela **geometria da tela** — o vizinho mais próximo na direção
   pedida, não o próximo na ordem do documento —, o **analógico direito vira cursor** e aponta
   direto no alvo, e o gatilho esquerdo vale **clique direito** nos slots (doc 09 §3.2).
4. `aria-label` em todo botão; `role="dialog"` + focus trap nos modais.
5. Animações respeitam `prefers-reduced-motion`.
6. **Nada de layout thrash:** a UI só re-renderiza quando o estado muda; o HUD atualiza campos
   individuais (largura de barra via `transform: scaleX()`, nunca `width`).
