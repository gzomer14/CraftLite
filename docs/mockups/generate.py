#!/usr/bin/env python3
"""
Gera os wireframes SVG de referência das telas do CraftLite.

São diagramas ORIGINAIS de layout (caixas, grades e rótulos) — servem para
comunicar posição, tamanho e hierarquia dos elementos de UI ao implementar.
Não contêm arte de terceiros.

Uso:  python3 docs/mockups/generate.py
"""
import os

OUT = os.path.dirname(os.path.abspath(__file__))
W, H = 960, 540

# ---------------------------------------------------------------- primitivas
CSS = """
  .bg    { fill:#1b1d21 }
  .panel { fill:#2b2f36; stroke:#7d8794; stroke-width:2 }
  .panel2{ fill:#232830; stroke:#5c6672; stroke-width:1.5 }
  .slot  { fill:#3a4049; stroke:#6f7885; stroke-width:1 }
  .slotA { fill:#4a5460; stroke:#cfd6e0; stroke-width:2 }
  .btn   { fill:#3d4450; stroke:#8b94a3; stroke-width:1.5 }
  .btnA  { fill:#4d5a75; stroke:#cfd6e0; stroke-width:2 }
  .t     { fill:#e6eaf0; font-family:ui-monospace,'DejaVu Sans Mono',monospace; font-size:12px }
  .tc    { fill:#e6eaf0; font-family:ui-monospace,'DejaVu Sans Mono',monospace; font-size:12px;
           text-anchor:middle }
  .ts    { fill:#98a2b3; font-family:ui-monospace,'DejaVu Sans Mono',monospace; font-size:10px }
  .tsc   { fill:#98a2b3; font-family:ui-monospace,'DejaVu Sans Mono',monospace; font-size:10px;
           text-anchor:middle }
  .th    { fill:#ffd166; font-family:ui-monospace,'DejaVu Sans Mono',monospace; font-size:15px;
           text-anchor:middle }
  .tt    { fill:#7dd3a0; font-family:ui-monospace,'DejaVu Sans Mono',monospace; font-size:11px }
  .dim   { fill:#000; opacity:.45 }
  .heart { fill:#dc4040 }
  .hung  { fill:#c68a45 }
  .xp    { fill:#7fc94b }
  .guide { stroke:#5c6672; stroke-width:1; stroke-dasharray:4 3; fill:none }
  .note  { fill:#ffd166; font-family:ui-monospace,'DejaVu Sans Mono',monospace; font-size:10px }
"""


def svg(body, title, w=W, h=H):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
            f'width="{w}" height="{h}" role="img" aria-label="{title}">\n'
            f'<title>{title}</title>\n<style>{CSS}</style>\n'
            f'<rect class="bg" width="{w}" height="{h}"/>\n{body}\n</svg>\n')


def rect(x, y, w, h, cls="panel", rx=2):
    return f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}"/>\n'


def text(x, y, s, cls="t"):
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return f'<text class="{cls}" x="{x}" y="{y}">{s}</text>\n'


def header(title, subtitle=""):
    o = text(W / 2, 26, title, "th")
    if subtitle:
        o += text(W / 2, 44, subtitle, "tsc")
    return o


def button(x, y, w, h, label, active=False):
    return (rect(x, y, w, h, "btnA" if active else "btn")
            + text(x + w / 2, y + h / 2 + 4, label, "tc"))


def slots(x, y, cols, rows, s=26, gap=2, cls="slot", label=None):
    o = ""
    for r in range(rows):
        for c in range(cols):
            o += rect(x + c * (s + gap), y + r * (s + gap), s, s, cls, 1)
    if label:
        o += text(x, y - 6, label, "ts")
    return o


def dimension(x1, y1, x2, y2, label):
    """Cota simples com rótulo (documenta tamanhos em px de GUI)."""
    o = f'<line class="guide" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"/>\n'
    o += text((x1 + x2) / 2, (y1 + y2) / 2 - 4, label, "tsc")
    return o


def callout(x, y, s):
    return text(x, y, "← " + s, "note")


# ------------------------------------------------------------------ 01 título
def title_screen():
    b = header("01 — Tela de Título", "fundo: panorama 3D girando (T0: imagem estática com pan)")
    b += rect(60, 60, 840, 450, "panel2")
    b += text(W / 2, 130, "[ LOGO DO JOGO — arte original ]", "tc")
    b += f'<g transform="rotate(-20 640 150)">' + text(640, 150, "frase aleatória!", "note") + "</g>\n"
    ys = 190
    for i, (lbl, act) in enumerate([("Um Jogador", True), ("Multijogador  (bloqueado no MVP)", False),
                                    ("Opções...", False)]):
        b += button(380, ys + i * 46, 200, 32, lbl, act)
    b += button(380, 328, 96, 32, "Idioma")
    b += button(484, 328, 96, 32, "Sair")
    b += text(72, 500, "v0.1.0", "ts")
    b += text(760, 500, "projeto independente", "ts")
    b += callout(600, 206, "foco inicial do teclado")
    b += callout(600, 344, "botões 200x20 px de GUI")
    return svg(b, "Tela de título")


# ------------------------------------------------------------------ 02 mundos
def worlds():
    b = header("02 — Seleção de Mundos")
    b += rect(160, 70, 640, 34, "panel2") + text(172, 92, "Buscar mundo...", "ts")
    for i, (n, meta) in enumerate([("Meu Mundo", "05/09/2026 14:32 — Sobrevivência, Normal — 4,2 MB"),
                                   ("Teste de Caverna", "03/09/2026 21:10 — Criativo — 1,1 MB"),
                                   ("Seed 12345", "28/08/2026 08:44 — Sobrevivência, Difícil — 12,8 MB")]):
        y = 116 + i * 76
        b += rect(160, y, 640, 68, "btnA" if i == 0 else "btn")
        b += rect(172, y + 8, 88, 52, "slot") + text(216, y + 38, "thumb", "tsc")
        b += text(276, y + 28, n) + text(276, y + 48, meta, "ts")
    b += callout(812, 150, "miniatura 128x72 JPEG")
    for i, lbl in enumerate(["Jogar", "Editar", "Excluir", "Recriar", "Criar Novo Mundo"]):
        b += button(112 + i * 150, 380, 138, 32, lbl, i == 0)
    b += button(380, 428, 200, 32, "Voltar")
    b += text(160, 490, "> 6 mundos: aparece a busca.  Excluir pede confirmação em modal.", "ts")
    return svg(b, "Seleção de mundos")


# ------------------------------------------------------------- 03 criar mundo
def create_world():
    b = header("03 — Criar Novo Mundo")
    rows = [("Nome do Mundo", "[ Novo Mundo            ]"),
            ("Modo de Jogo", "< Sobrevivência >"),
            ("Dificuldade", "< Normal >"),
            ("Seed (vazio = aleatória)", "[                       ]"),
            ("Tipo de Mundo", "< Padrão >"),
            ("Gerar Estruturas", "[ ON  ]"),
            ("Bônus de Baú", "[ OFF ]")]
    for i, (lbl, val) in enumerate(rows):
        y = 78 + i * 44
        b += text(180, y + 20, lbl)
        b += rect(520, y, 260, 30, "btn") + text(650, y + 20, val, "tc")
    b += button(180, 392, 260, 32, "Mais Opções...")
    b += text(460, 412, "ciclo dia/noite, dano de fogo, drop ao morrer", "ts")
    b += button(300, 452, 160, 32, "Criar Novo Mundo", True)
    b += button(480, 452, 160, 32, "Cancelar")
    return svg(b, "Criar novo mundo")


# --------------------------------------------------------------------- 04 HUD
def hud():
    b = header("04 — HUD em Jogo", "tudo position:fixed, pointer-events:none")
    b += rect(60, 60, 840, 450, "panel2")
    # crosshair
    cx, cy = 480, 270
    b += (f'<line x1="{cx-9}" y1="{cy}" x2="{cx+9}" y2="{cy}" stroke="#e6eaf0" stroke-width="2"/>'
          f'<line x1="{cx}" y1="{cy-9}" x2="{cx}" y2="{cy+9}" stroke="#e6eaf0" stroke-width="2"/>\n')
    b += callout(500, 274, "crosshair 9x9, blend difference")
    # barras
    for i in range(10):
        b += f'<circle class="heart" cx="{300 + i*18}" cy="398" r="7"/>\n'
        b += f'<rect class="hung" x="{552 + i*18 - 7}" y="391" width="14" height="14" rx="3"/>\n'
    b += text(200, 402, "vida", "ts") + text(760, 402, "fome", "ts")
    b += rect(300, 416, 360, 10, "panel2") + rect(300, 416, 200, 10, "xp", 0)
    b += text(474, 412, "12", "tsc")
    b += callout(676, 424, "barra de XP 182px de GUI + nível")
    # hotbar
    b += slots(300, 436, 9, 1, 38, 2)
    b += rect(300 + 3 * 40 - 2, 434, 42, 42, "slotA")
    b += text(480, 494, "hotbar 9 slots — teclas 1-9 / roda do mouse", "tsc")
    # cantos
    b += text(76, 84, "chat / logs (10 linhas, fade 10s)", "ts")
    b += rect(740, 70, 150, 44, "panel") + text(815, 96, "toast conquista", "tc")
    b += text(760, 496, "autosave ⟳", "ts")
    b += callout(300, 378, "armadura aqui, se > 0; bolhas de ar acima da fome")
    return svg(b, "HUD em jogo")


# -------------------------------------------------------------- 05 inventário
def inventory():
    b = header("05 — Inventário (Sobrevivência)", "painel 176x166 px de GUI — 46 slots no total")
    px, py, pw, ph = 240, 62, 480, 430
    b += rect(px, py, pw, ph)
    b += text(px + 16, py + 24, "Inventário")
    # armadura
    b += slots(px + 20, py + 40, 1, 4, 30, 4, label="armadura")
    b += text(px + 16, py + 190, "off-hand", "ts")
    b += slots(px + 20, py + 196, 1, 1, 30, 4)
    # boneco
    b += rect(px + 70, py + 40, 100, 160, "panel2")
    b += text(px + 120, py + 124, "boneco 3D", "tsc")
    b += text(px + 120, py + 140, "segue o cursor", "tsc")
    # craft 2x2
    b += slots(px + 250, py + 60, 2, 2, 30, 4, label="craft 2x2")
    b += text(px + 322, py + 108, "→", "tc")
    b += rect(px + 340, py + 76, 34, 34, "slotA")
    b += text(px + 357, py + 60, "saída", "tsc")
    # main + hotbar
    b += slots(px + 24, py + 244, 9, 3, 44, 3, label="27 slots principais (9x3)")
    b += slots(px + 24, py + 388, 9, 1, 44, 3, label="hotbar (9)")
    b += button(px - 130, py + 40, 120, 28, "📖 receitas")
    b += text(px - 130, py + 92, "livro de receitas:", "ts")
    for i, s in enumerate(["abas: Tudo/Construção/", "Equipamento/Diversos/", "Redstone + busca.",
                           "Clicar preenche a grade."]):
        b += text(px - 130, py + 110 + i * 15, s, "ts")
    b += text(730, 120, "interações de slot:", "tt")
    for i, s in enumerate(["clique esq: pega stack", "clique dir: pega metade",
                           "shift+clique: move tudo", "arrastar esq: distribui",
                           "arrastar dir: 1 por slot", "duplo clique: junta iguais",
                           "1-9: troca com hotbar", "Q / Ctrl+Q: joga fora"]):
        b += text(730, 142 + i * 17, "• " + s, "ts")
    return svg(b, "Inventário de sobrevivência")


# ----------------------------------------------------------------- 06 criativo
def creative():
    b = header("06 — Inventário Criativo")
    px, py, pw, ph = 200, 84, 560, 400
    tabs = ["Constr", "Decor", "Redst", "Transp", "Div", "Comida", "Ferram", "Combate", "Busca"]
    for i, t in enumerate(tabs):
        b += rect(px + i * 62, py - 26, 58, 26, "btnA" if i == 0 else "btn")
        b += text(px + i * 62 + 29, py - 8, t, "tsc")
    b += rect(px, py, pw, ph)
    b += rect(px + 16, py + 12, 460, 26, "panel2") + text(px + 26, py + 30, "🔍 buscar item...", "ts")
    b += slots(px + 16, py + 50, 9, 5, 50, 3)
    b += rect(px + 500, py + 50, 12, 262, "panel2")
    b += rect(px + 500, py + 50, 12, 90, "btn")
    b += callout(px + 520, py + 96, "scrollbar")
    b += slots(px + 16, py + 320, 9, 1, 50, 3, label="hotbar")
    for i, t in enumerate(["Inventário 💾", "Salvar hotbar ⭐", "Lixeira 🗑"]):
        b += rect(px + i * 190, py + ph + 10, 180, 26, "btn")
        b += text(px + i * 190 + 90, py + ph + 28, t, "tsc")
    b += text(200, 520, "grade 9x5 = 45 por página · pegar = cópia infinita · arrastar p/ grade = deletar", "ts")
    return svg(b, "Inventário criativo")


# ----------------------------------------------------------------- 07 bancada
def crafting():
    b = header("07 — Bancada de Trabalho", "grade 3x3 — receitas com deslocamento e espelhamento horizontal")
    px, py, pw, ph = 260, 62, 440, 420
    b += rect(px, py, pw, ph)
    b += text(px + 16, py + 24, "Criação")
    b += slots(px + 40, py + 46, 3, 3, 44, 4, label="3x3")
    b += text(px + 210, py + 116, "→", "tc")
    b += rect(px + 240, py + 92, 48, 48, "slotA")
    b += text(px + 264, py + 76, "resultado", "tsc")
    b += button(px + 320, py + 46, 100, 26, "📖")
    b += slots(px + 20, py + 210, 9, 3, 44, 3, label="inventário")
    b += slots(px + 20, py + 352, 9, 1, 44, 3, label="hotbar")
    b += text(720, 140, "matching:", "tt")
    for i, s in enumerate(["1. bbox mínimo dos slots", "2. compara com o pattern",
                           "3. tenta espelhado (h)", "4. shapeless: multiset",
                           "", "shift+clique no resultado", "= craft em lote"]):
        b += text(720, 162 + i * 17, s, "ts")
    return svg(b, "Bancada de trabalho")


# ---------------------------------------------------------------- 08 fornalha
def furnace():
    b = header("08 — Fornalha")
    px, py, pw, ph = 260, 62, 440, 420
    b += rect(px, py, pw, ph)
    b += text(px + 16, py + 24, "Fornalha")
    b += rect(px + 80, py + 50, 44, 44, "slot") + text(px + 102, py + 42, "entrada", "tsc")
    b += rect(px + 80, py + 140, 44, 44, "slot") + text(px + 102, py + 200, "combustível", "tsc")
    b += f'<path d="M{px+96} {py+134} l6 -18 l6 18 z" fill="#ffb347"/>\n'
    b += text(px + 150, py + 128, "🔥 altura ∝ queima restante (0-13px)", "ts")
    b += rect(px + 180, py + 96, 88, 16, "panel2") + rect(px + 180, py + 96, 52, 16, "xp", 0)
    b += text(px + 224, py + 88, "progresso 0-22px", "tsc")
    b += rect(px + 300, py + 86, 52, 52, "slotA") + text(px + 326, py + 156, "saída", "tsc")
    b += slots(px + 20, py + 216, 9, 3, 44, 3, label="inventário")
    b += slots(px + 20, py + 358, 9, 1, 44, 3, label="hotbar")
    b += text(730, 160, "1 item = 200 ticks (10s)", "ts")
    b += text(730, 178, "continua queimando com", "ts")
    b += text(730, 196, "a tela fechada, enquanto", "ts")
    b += text(730, 214, "o chunk estiver carregado", "ts")
    return svg(b, "Fornalha")


# -------------------------------------------------------------------- 09 baú
def chest():
    b = header("09 — Baú / Baú Duplo")
    for k, (title_, rows, px) in enumerate([("Baú (27)", 3, 110), ("Baú Duplo (54)", 6, 520)]):
        py = 80
        ph = 130 + rows * 47 + 60
        b += rect(px, py, 330, ph)
        b += text(px + 16, py + 24, title_)
        b += slots(px + 20, py + 40, 6, rows, 48, 3)
        b += slots(px + 20, py + 52 + rows * 51, 6, 3, 48, 3, label="inventário")
        b += slots(px + 20, py + 52 + rows * 51 + 160, 6, 1, 48, 3, label="hotbar")
    b += text(110, 512, "baús adjacentes viram um duplo · animação de tampa + som ao abrir", "ts")
    b += text(110, 528, "(grade mostrada em 6 colunas por espaço no diagrama; na UI real são 9)", "note")
    return svg(b, "Baú")


# ------------------------------------------------------------------ 10 pausa
def pause():
    b = header("10 — Menu de Pausa", "mundo continua atrás, escurecido (T0: sem blur)")
    b += rect(60, 60, 840, 450, "panel2")
    b += rect(60, 60, 840, 450, "dim", 0)
    b += text(W / 2, 130, "Jogo Pausado", "th")
    labels = [("Voltar ao Jogo", True), ("Conquistas", False), ("Estatísticas", False),
              ("Opções...", False), ("Salvar e Sair", False)]
    for i, (lbl, act) in enumerate(labels):
        b += button(380, 170 + i * 46, 200, 32, lbl, act)
    b += callout(600, 190, "Esc fecha uma camada por vez")
    b += text(120, 490, "no mobile o botão de pausa fica no canto superior direito do HUD", "ts")
    return svg(b, "Menu de pausa")


# ----------------------------------------------------------------- 11 opções
def options():
    b = header("11 — Opções ▸ Vídeo", "lista rolável de 2 colunas")
    rows = [("Distância de Renderização", "|====----| 6 chunks"), ("Distância de Simulação", "|===-----| 4"),
            ("Escala de Renderização", "|=======-| 90%"), ("FPS Máximo", "< 60 >"),
            ("VSync", "[ ON ]"), ("Gráficos", "< Rápido >"),
            ("Iluminação Suave", "[ ON ]"), ("Nuvens", "< Off >"),
            ("Partículas", "< Reduzido >"), ("Sombras de Entidade", "[ OFF ]"),
            ("Brilho", "|====----| 50%"), ("FOV", "|=====---| 70"),
            ("Escala da GUI", "< Auto (3) >"), ("Mostrar FPS", "[ ON ]")]
    for i, (lbl, val) in enumerate(rows):
        col, row = i % 2, i // 2
        x = 90 + col * 400
        y = 80 + row * 44
        b += rect(x, y, 380, 32, "btn")
        b += text(x + 12, y + 21, lbl, "t")
        b += text(x + 368, y + 21, val, "ts")
    b += button(380, 400, 200, 32, "Concluído", True)
    b += text(90, 456, "submenus: Vídeo · Controles · Som · Idioma · Acessibilidade", "ts")
    b += text(90, 474, "no mobile aparece também: Controles de Toque ▸ Editar layout dos botões", "ts")
    b += text(90, 492, "presets automáticos por tier, sempre sobrescrevíveis pelo jogador", "note")
    return svg(b, "Opções de vídeo")


# ------------------------------------------------------------------ 12 morte
def death():
    b = header("12 — Tela de Morte")
    b += rect(60, 60, 840, 450, "panel2")
    b += f'<rect x="60" y="60" width="840" height="450" fill="#5a0000" opacity="0.55"/>\n'
    b += text(W / 2, 200, "Você morreu!", "th")
    b += text(W / 2, 236, "Você caiu de um lugar alto", "tc")
    b += text(W / 2, 262, "Pontuação: 143", "tsc")
    b += button(380, 300, 200, 32, "Reaparecer", True)
    b += button(380, 346, 200, 32, "Sair do Mundo")
    b += text(120, 470, "Sobrevivência: inventário todo dropa no local da morte; XP parcialmente perdido.", "ts")
    return svg(b, "Tela de morte")


# ------------------------------------------------------------ 13 mobile touch
def mobile():
    b = header("13 — Controles de Toque (landscape)",
               "alvos >= 44x44 px CSS reais · Pointer Events + multitoque por pointerId")
    b += rect(40, 60, 880, 440, "panel2")
    # HUD topo
    for i in range(10):
        b += f'<circle class="heart" cx="{70 + i*16}" cy="86" r="6"/>\n'
        b += f'<rect class="hung" x="{64 + i*16}" y="104" width="12" height="12" rx="3"/>\n'
    b += rect(856, 72, 48, 48, "btn") + text(880, 102, "⏸", "tc")
    # crosshair
    b += f'<circle cx="480" cy="270" r="4" fill="#e6eaf0"/>\n'
    b += text(480, 250, "ponto (o dedo é que mira, no Modo A)", "tsc")
    # joystick
    b += f'<circle cx="180" cy="330" r="66" fill="none" stroke="#8b94a3" stroke-width="2"/>\n'
    b += f'<circle cx="196" cy="316" r="26" class="btn"/>\n'
    b += text(180, 418, "joystick flutuante", "tsc")
    b += text(180, 434, "surge onde o dedo tocar", "tsc")
    b += text(180, 450, "empurrar 300ms = correr", "tsc")
    # zonas
    b += f'<rect class="guide" x="40" y="60" width="440" height="440"/>\n'
    b += f'<rect class="guide" x="480" y="60" width="440" height="440"/>\n'
    b += text(120, 78, "ZONA MOVIMENTO", "note")
    b += text(560, 78, "ZONA CÂMERA + INTERAÇÃO", "note")
    # botões direita
    for i, (lbl, yy) in enumerate([("▲ pular", 200), ("⬇ agachar", 268), ("⬆ voar", 336)]):
        b += rect(830, yy, 74, 56, "btn") + text(867, yy + 32, lbl, "tsc")
    b += rect(560, 366, 74, 56, "btn") + text(597, 398, "⛏", "tc")
    b += text(597, 434, "só no Modo B", "tsc")
    b += rect(740, 366, 62, 56, "btn") + text(771, 398, "🎒", "tc")
    # hotbar
    b += slots(280, 448, 9, 1, 40, 3)
    b += text(480, 500, "hotbar: tocar seleciona · arrastar rola os slots", "tsc")
    return svg(b, "Controles de toque")


# ---------------------------------------------------------------- 14 pipeline
def pipeline():
    b = header("14 — Pipeline de Chunk (referência de arquitetura)")
    stages = ["EMPTY", "GENERATING", "GENERATED", "LIGHTING", "LIT", "MESHING", "READY"]
    for i, s in enumerate(stages):
        x = 40 + i * 130
        b += rect(x, 120, 112, 44, "btnA" if s == "READY" else "btn")
        b += text(x + 56, 147, s, "tc")
        if i < len(stages) - 1:
            b += text(x + 122, 147, "→", "tc")
    b += text(40, 96, "estados", "tt")
    lanes = [("main thread", 210, "input · tick 20Hz · física · UI · render · upload de VBO (≤2ms/frame)"),
             ("gen.worker", 280, "ruído → terreno → cavernas → minérios → decoração"),
             ("mesh.worker", 350, "greedy meshing binário + AO + separação opaco/transparente")]
    for name, y, desc in lanes:
        b += rect(40, y, 880, 52, "panel2")
        b += text(56, y + 22, name, "tt")
        b += text(56, y + 40, desc, "ts")
    b += text(40, 440, "toda transferência usa postMessage(buf, [buf]) — zero cópia", "note")
    b += text(40, 460, "meshing recebe a section + 1 camada de borda dos 6 vizinhos = 18³ voxels", "ts")
    b += text(40, 480, "fila de prioridade por distância² ao jogador, com bônus para o frustum", "ts")
    b += text(40, 500, "máx. 2×nWorkers chunks em voo · 1 anel de chunks por segundo no tier T0", "ts")
    return svg(b, "Pipeline de chunk")


SCREENS = [
    ("01-title.svg", title_screen), ("02-worlds.svg", worlds),
    ("03-create-world.svg", create_world), ("04-hud.svg", hud),
    ("05-inventory.svg", inventory), ("06-creative.svg", creative),
    ("07-crafting.svg", crafting), ("08-furnace.svg", furnace),
    ("09-chest.svg", chest), ("10-pause.svg", pause),
    ("11-options.svg", options), ("12-death.svg", death),
    ("13-mobile-controls.svg", mobile), ("14-chunk-pipeline.svg", pipeline),
]

if __name__ == "__main__":
    for fname, fn in SCREENS:
        with open(os.path.join(OUT, fname), "w", encoding="utf-8") as f:
            f.write(fn())
        print("wrote", fname)
