# 09 — Controles: Desktop e Mobile

O celular antigo **é o alvo principal**, não uma adaptação. O layout de toque precisa ser
projetado primeiro e o de teclado depois.

## 1. Desktop (teclado + mouse)

| Ação | Tecla padrão |
|---|---|
| Andar frente/trás/esquerda/direita | `W` `S` `A` `D` |
| Pular / nadar para cima | `Espaço` |
| Agachar / descer voando | `Shift` |
| Correr | `Ctrl` ou duplo-`W` |
| Quebrar bloco / atacar | Botão esquerdo (segurar) |
| Colocar bloco / usar | Botão direito |
| Pick block | Botão do meio |
| Soltar item | `Q` (`Ctrl+Q` = stack) |
| Inventário | `E` |
| Trocar item da mão principal/secundária | `F` |
| Selecionar hotbar | `1`–`9` ou roda do mouse |
| Chat / comando | `T` / `/` |
| Lista de jogadores | `Tab` |
| Debug | `F3` |
| Screenshot | `F2` |
| Esconder HUD | `F1` |
| Tela cheia | `F11` |
| Perspectiva (1ª/3ª pessoa) | `F5` |
| Pausa | `Esc` |

**Pointer lock:** ao clicar no canvas, `canvas.requestPointerLock()`. Usar `movementX/Y` do evento.
Aplicar sensibilidade: `yaw += movementX * sens * 0.15`, `pitch` clampado a ±89.9°.
Tratar `pointerlockerror` (alguns navegadores exigem gesto do usuário) com uma mensagem
"Clique para jogar".

## 2. Mobile — layout de toque

```
┌────────────────────────────────────────────────────────┐
│ ♥♥♥♥♥♥♥♥♥♥                       ⏸    (pausa)          │
│ 🍗🍗🍗🍗🍗🍗🍗🍗🍗🍗                                       │
│                                                        │
│                          ·          ← crosshair (ponto)│
│                                                        │
│                                              ┌───┐     │
│      ┌─────┐                                 │ ▲ │     │  pular
│      │  ●  │  ← joystick virtual              └───┘     │
│      │     │    (aparece onde tocar na        ┌───┐     │
│      └─────┘     metade esquerda)             │ ⬇ │     │  agachar/descer
│                                               └───┘     │
│      ┌───┐                                   ┌────┐    │
│      │ ⛏ │ ← quebrar/atacar (segurar)         │ ⬆ │    │  voar (criativo)
│      └───┘                                    └────┘    │
│   ┌──┬──┬──┬──┬──┬──┬──┬──┬──┐        ┌───┐            │
│   │  │  │  │  │  │  │  │  │  │        │ 🎒│ inventário │
│   └──┴──┴──┴──┴──┴──┴──┴──┴──┘        └───┘            │
└────────────────────────────────────────────────────────┘
```

### 2.1 Zonas

| Zona | Região | Comportamento |
|---|---|---|
| **Movimento** | metade esquerda, acima da hotbar | Joystick flutuante: aparece onde o dedo tocar, raio morto 8 px, raio máximo 60 px. Empurrar até o limite por 300 ms = **correr** (anel do joystick fica dourado) |
| **Câmera** | metade direita | Arrastar gira a câmera. `deltaYaw = dx * sens * 0.12` |
| **Interação** | qualquer toque na zona de câmera | ver §2.2 |
| **Botões** | fixos | Pular, Agachar, Voar, Inventário, Pausa, Perspectiva |
| **Hotbar** | rodapé | Tocar seleciona; **arrastar horizontalmente** rola os slots |

### 2.2 Modelo de interação por toque (a decisão mais importante do mobile)

Oferecer **dois modos**, escolhíveis nas opções, com o **Modo A como padrão**:

**Modo A — "Toque no mundo" (recomendado, é o que o jogo mobile original usa)**
| Gesto | Ação |
|---|---|
| Toque curto (< 150 ms) na zona de câmera | **Colocar bloco** / usar item na face apontada |
| Toque longo (segurar) parado | **Quebrar** o bloco apontado, com barra de progresso circular no ponto |
| Toque curto sobre um mob | **Atacar** |
| Arrastar | Girar a câmera (cancela o toque curto se mover > 10 px) |
| Segurar sobre um bloco no Criativo | Quebra instantânea |
| Toque duplo no botão de pulo | Alterna voo (Criativo) |
| Dois dedos pinçando | (opcional) FOV / zoom |

> O raycast usa a **posição do dedo**, não o centro da tela. Isso é o que faz o modo A funcionar:
> converter `(clientX, clientY)` → ray via inversa da matriz de projeção.

**Modo B — "Botões dedicados" (clássico, alvo fixo no crosshair)**
Dois botões grandes no lado direito: ⛏ (quebrar, segurar) e ▣ (colocar). A câmera só gira por
arraste. Sempre mira no centro da tela. Melhor para quem vem do desktop e para telas pequenas.

### 2.3 Requisitos de toque

- **Alvos ≥ 44 × 44 px CSS reais** (não px de GUI). Verificar em tela de 320 px de largura.
- `touch-action: none` no canvas e nos controles; `user-select: none`; `-webkit-tap-highlight-color: transparent`.
- Usar **Pointer Events** (`pointerdown/move/up/cancel`) com `setPointerCapture` — cobre mouse,
  toque e caneta com um código só. Tratar `pointercancel` (chamada, notificação) resetando o estado.
- **Multitoque real**: rastrear por `pointerId` em um `Map`. Andar + olhar + pular ao mesmo tempo
  precisa funcionar. Testar com 3 dedos.
- Prevenir gestos do navegador: `overscroll-behavior: none`, bloquear pull-to-refresh, e
  `viewport-fit=cover` + `env(safe-area-inset-*)` para notch.
- Tela cheia + travar orientação em landscape ao entrar no jogo:
  `document.documentElement.requestFullscreen()` e `screen.orientation.lock('landscape')`
  (falha silenciosamente em iOS — mostrar um aviso "gire o aparelho" em portrait).
- **Haptics:** `navigator.vibrate(10)` ao quebrar um bloco e ao levar dano. Desligável.
- Opacidade padrão dos botões: 55%; sobe para 90% durante o toque.

### 2.4 Editor de layout

Tela nas opções onde o jogador **arrasta os botões** para onde quiser, redimensiona (slider de
escala 70–150%) e salva. Guardar em `localStorage`. Botão "Restaurar padrão". Presets:
"Destro", "Canhoto", "Compacto".

## 3. Gamepad (bônus barato)

Usar a Gamepad API. Mapeamento padrão:
- Analógico esquerdo: mover · Analógico direito: câmera (com curva quadrática e dead zone 0.15)
- `A`: pular · `B`: agachar · `X`: colocar/usar · `Y`: soltar item
- `RT`/`LT`: quebrar/usar · `LB`/`RB`: rolar hotbar · `Start`: pausa · `Select`: inventário
- `L3`: correr · duplo toque em `A`: alternar voo no criativo (doc 06 §9)
- Direcional: navegar a interface (ver §3.1) · Vibração leve ao quebrar bloco.

### 3.1 Perfis de controle e o que realmente muda entre eles

**O mapeamento quase não é o problema.** Quando o navegador reconhece o
aparelho ele reporta `mapping: 'standard'`, e aí os índices de botão são os
mesmos para DualSense, Xbox, Switch Pro e qualquer outro — é o layout que a
especificação desenha. Esse é o caminho normal no Chrome e no Firefox, no
computador e no Android.

O que muda de verdade é o **nome impresso no botão**. Dizer "aperte `A` para
colocar" a quem segura um DualSense manda o jogador procurar um botão que não
existe no aparelho dele. Por isso cada família tem um perfil com os rótulos das
oito teclas que a interface cita, e **toda mensagem que nomeia um botão usa o
rótulo do controle conectado**.

O perfil tem um segundo papel, de rede de segurança: quando o navegador **não**
reconhece o aparelho, os índices viram a ordem crua do relatório HID, que é
diferente por família — num controle de PlayStation as faces vêm na ordem
`□ ✕ ○ △`. Sem a tabela da família, apertar `□` faria o jogador pular.

A detecção usa o par fabricante/produto do `Gamepad.id`, **não o nome**: um
Xbox reporta "Xbox Wireless Controller" e um DualShock 4 reporta "Wireless
Controller", e casar por nome troca os dois. Controle fora da tabela continua
jogável com os rótulos da especificação. A escolha é sobrescritível em
Opções → Controle, pelo mesmo motivo que a Qualidade é: a detecção lê uma
string escrita pelo fabricante e pode errar.

### 3.2 Navegação de interface

O doc 08 §4.3 pede que toda tela seja navegável por gamepad. Direcional (ou
analógico esquerdo) move o foco, o botão de baixo confirma e o da direita
volta — e **esquerda/direita mexem no valor do controle focado** em vez de
pular de campo, porque a tela de opções é quase toda slider.

O alvo da navegação é o elemento com `role="dialog"` visível mais acima, e não
uma lista de telas: o doc 08 §4.4 já exige esse atributo em todo modal, então
tela nova entra na navegação sozinha.

> **O que o controle não consegue fazer sozinho.** Ligar o áudio e entrar em
> tela cheia exigem um **gesto do usuário**, e aperto de botão de controle não
> conta como gesto em navegador nenhum. Quem só tem o controle na mão precisa
> tocar a tela ou apertar uma tecla uma vez; o jogo avisa isso quando um
> controle conecta e o áudio ainda não subiu.

## 4. Acessibilidade de input

- Todo controle de toque tem equivalente por teclado.
- Opção "toque para alternar" em vez de "segurar" para correr/agachar/quebrar.
- Opção de aumentar o tempo de toque longo (300–1000 ms).
- Suporte a leitor de tela nos menus (não no jogo 3D).


## Ajustes vindos da revisão de UX (2026-09-11)

**Pulo automático.** Ligado por padrão no toque, desligado no desktop. Sobe degrau de **um** bloco
na direção do movimento; nunca dois, e nunca com o jogador parado. Sem ele, subir uma borda de
terra no celular exige soltar o joystick e acertar o botão de pulo a cada passo.

**O botão de voar só aparece no criativo.** Ele sempre foi desenhado, mas `onFlyToggle` devolve
cedo fora do criativo: o jogador de sobrevivência tinha um controle em posição nobre que não fazia
nada e não explicava por quê.

**O HUD não passa por baixo dos pads.** A `TouchUi` publica `--touch-pad` com a largura que os
botões ocupam nos cantos, e a barra de vida e fome desconta isso dos dois lados. Antes o botão de
pular cobria o fim da barra de fome.
