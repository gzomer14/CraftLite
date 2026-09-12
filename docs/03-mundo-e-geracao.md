# 03 — Mundo e Geração Procedural

## 1. Dimensões do mundo

| Parâmetro | Valor | Nota |
|---|---|---|
| Altura | **Y = 0 .. 127** | Reduzido vs. original (−64..319) para caber em celular |
| Bedrock | Y = 0 (camada sólida) + Y=1..3 irregular | Indestrutível |
| Nível do mar | **Y = 63** | Água até 62, superfície de praia em 63 |
| Nuvens | Y = 100 | |
| Limite horizontal | ±30.000.000 blocos (praticamente infinito) | limite de precisão float32 |
| Chunk | 16 × 128 × 16 | 8 sections de 16³ |

> Se no futuro quiser mais espaço vertical, aumente para 192 **apenas no tier T2**. O formato de
> save já deve gravar a altura para permitir isso sem quebrar mundos.

## 2. Seed e determinismo

- Seed é `int64` (usar `BigInt` só na derivação, nunca no loop). Input do usuário: string →
  hash FNV-1a 64 → seed. Campo vazio = seed aleatória.
- **Toda** aleatoriedade de geração deriva da seed por posição:
  `rngAt(seed, x, z, salt)` — determinístico e independente de ordem de carregamento.
  Isso é obrigatório: chunks são gerados fora de ordem em workers.
- PRNG: **xoroshiro128\*\*** (rápido e bom). Ruído: **OpenSimplex2** ou Perlin melhorado.

## 3. Pipeline de geração de um chunk

```
1. Noise maps 2D      (continentalness, erosion, temperature, humidity, weirdness)
2. Seleção de bioma   (lookup em espaço 5D → bioma)
3. Heightmap          (altura base + variação do bioma, com blend 5×5 entre biomas)
4. Terreno base       (stone abaixo da altura, water até Y=63, air acima)
5. Cavernas 3D        (noise "cheese" + "spaghetti" + túneis worm)
6. Superfície         (grass/dirt, sand em praia/deserto, snow acima de Y=100)
7. Minérios           (blobs por faixa de Y)
8. Decoração          (árvores, grama alta, flores, cactos, cana, cogumelos, abóboras)
9. Estruturas         (aldeia, dungeon, ravina, poço no deserto) — pós-MVP
10. Iluminação        (skylight de cima para baixo + luzes de bloco)
```

> **Cuidado com decoração em bordas:** árvores atravessam fronteiras de chunk. Solução: cada chunk
> gera decoração para si **e** consulta um raio de 1 chunk ao redor, escrevendo em "buffers de
> transbordo" que são aplicados quando o vizinho carregar. Alternativa mais simples e usada aqui:
> gerar decoração só depois que os 8 vizinhos existirem (estado `GENERATED` → `DECORATED`).

## 4. Ruído e biomas

### 4.1 Mapas de ruído (2D, escala em blocos)

| Mapa | Escala | Oitavas | Uso |
|---|---|---|---|
| `continentalness` | 1/2000 | 4 | oceano ↔ continente; controla altura base |
| `erosion` | 1/1500 | 4 | plano ↔ montanhoso; controla amplitude |
| `temperature` | 1/1200 | 3 | frio ↔ quente |
| `humidity` | 1/1000 | 3 | seco ↔ úmido |
| `weirdness` | 1/800 | 3 | variação/raridade, cria vales e picos |
| `detail` | 1/60 | 3 | rugosidade local do terreno |

**Domain warping** no `detail` (deslocar as coordenadas de amostragem por outro ruído) dá formas
muito mais orgânicas por custo baixo — usar.

### 4.2 Cálculo de altura

```ts
const cont = fbm(continentalness, x, z);              // -1..1
const ero  = fbm(erosion, x, z);
const base = splineContinental(cont);                  // -1 → Y=40 (oceano), 1 → Y=90
const amp  = lerp(28, 3, (ero + 1) / 2);               // erosão alta = terreno plano
const h    = base + fbm(detail, x, z) * amp + biome.heightOffset;
const height = Math.round(clamp(h, 4, 124));
```

Splines (curvas de controle) são o truque que faz o terreno parecer "certo": não use ruído linear.
Sugestão de spline de continentalidade (pontos `[entrada, saída]`):
`[-1.0, 32] [-0.4, 48] [-0.15, 60] [0.0, 65] [0.3, 72] [0.6, 84] [1.0, 100]`.

### 4.3 Biomas (MVP: 10)

| Bioma | Temp | Umid. | Superfície | Altura | Vegetação | Mobs extras |
|---|---|---|---|---|---|---|
| Ocean | qualquer | — | gravel/sand | 30–50 | kelp (pós) | squid |
| Beach | qualquer | — | sand | 62–65 | — | — |
| Plains | 0.3–0.8 | 0.2–0.6 | grass | 64–72 | grama alta, flores, árvore rara | cow, sheep, pig, horse |
| Forest | 0.2–0.7 | 0.5–1.0 | grass | 64–78 | oak/birch denso, cogumelos | wolf |
| Taiga | −0.3–0.2 | 0.4–1.0 | grass+podzol | 66–84 | spruce, samambaia | wolf, fox |
| Desert | 0.8–1.0 | 0.0–0.3 | sand + sandstone | 63–72 | cactus, dead bush | husk |
| Savanna | 0.7–1.0 | 0.3–0.5 | grass (seco) | 64–76 | acacia esparsa | — |
| Snowy Plains | −1.0–−0.4 | qualquer | snow + grass | 64–74 | spruce raro | stray, rabbit |
| Mountains | qualquer | qualquer (ero baixo) | stone/snow | 90–124 | spruce até Y=100 | goat |
| Swamp | 0.5–0.8 | 0.8–1.0 | grass + water | 60–64 | oak com vine, lily pad | slime |

**Blend de biomas:** amostrar 5×5 pontos ao redor (a cada 4 blocos) e fazer média ponderada da
altura e da cor de tint da grama/folhagem. Sem isso, aparecem paredes retas entre biomas.

**Cor de tint:** grama, folhas e água têm cor por bioma (multiplicada na textura em escala de cinza).
Ex.: `plains #91BD59`, `forest #79C05A`, `desert #BFB755`, `swamp #6A7039`, `taiga #86B783`,
`snowy #80B497`. Água: `plains #3F76E4`, `swamp #617B64`.

## 5. Cavernas

Três sistemas combinados, todos em 3D:

1. **Cheese caves** — cavernas grandes e abertas.
   `abs(noise3(x/70, y/40, z/70)) < 0.08` e `Y < 60`.
2. **Spaghetti caves** — túneis longos e finos.
   Dois ruídos: `abs(n1) < 0.06 && abs(n2) < 0.06` (interseção de dois campos = tubo).
3. **Ravinas** — raras (1 a cada ~150 chunks): fenda vertical de 3–12 blocos de largura,
   40–70 de comprimento, do Y=10 até a superfície.

Regras:
- **Nunca esculpir bedrock** (Y ≤ 3).
- Abaixo de Y=10, preencher a caverna com **lava** (lagos de lava).
- Não esculpir dentro de água quando o resultado deixaria o oceano vazar — checar se há água acima.
- Depois de esculpir, colocar minério exposto e (pós-MVP) blocos de minério brilhante/decoração.

## 6. Minérios

Gerados como *blobs* (elipsoides irregulares) com `n` tentativas por chunk.

| Minério | Faixa Y | Tentativas/chunk | Tam. veia | Precisa de | Drop |
|---|---|---|---|---|---|
| Coal ore | 5 – 127 (pico 45) | 20 | 4–17 | wood+ | coal |
| Copper ore | 0 – 96 (pico 48) | 6 | 3–10 | stone+ | raw copper ×2-5 |
| Iron ore | 0 – 72 (pico 16) | 10 | 3–10 | stone+ | raw iron |
| Gold ore | 0 – 32 (pico 16) | 2 | 2–8 | iron+ | raw gold |
| Redstone ore | 0 – 16 | 8 | 3–10 | iron+ | redstone ×4-5 |
| Lapis ore | 0 – 32 (pico 14) | 2 | 2–8 | stone+ | lapis ×4-9 |
| Diamond ore | 0 – 16 (pico 6) | 1 | 1–8 | iron+ | diamond |
| Emerald ore | 60 – 120 (só Mountains) | 3 | 1–2 | iron+ | emerald |

Distribuição por faixa: usar **triangular** (mais comum no pico, decaindo linearmente) para
ferro/diamante/lápis; **uniforme** para carvão. Isso reproduz a sensação de "diamante é raro
lá embaixo".

Regra extra: nunca gerar minério com face exposta ao ar acima de Y=63 mais que 30% das vezes
(evita minério "flutuando" na superfície de montanha).

## 7. Estruturas (pós-MVP, nesta ordem)

| Estrutura | Frequência | Descrição |
|---|---|---|
| **Dungeon** | 8 tentativas/chunk, Y 5–50 | Sala 5×5 ou 7×7 de mossy/cobblestone, spawner no centro, 1–2 baús |
| **Aldeia** | 1 a cada ~32×32 chunks, em Plains/Desert/Savanna | 6–15 construções de um template pool + caminhos, poço central, 3–8 aldeões |
| **Poço do deserto** | 1/1000 chunks, Desert | Estrutura de sandstone com água |
| **Cabana de bruxa** | Swamp, raro | Sobre estacas |
| **Naufrágio** | Ocean, raro | Barco quebrado com baú de loot |
| **Mina abandonada** | Y 10–40, raro | Corredores com trilhos, teias, suportes de madeira, baús em carrinho |

Cada estrutura é definida como um **template declarativo** (array de `[dx,dy,dz,blockId]` +
lista de baús com tabela de loot), não código imperativo. Permite adicionar estruturas sem tocar
no gerador.

## 8. Ciclo dia/noite e clima

- **1 dia = 20 minutos reais = 24000 ticks.**
  - Amanhecer 23000–0, Dia 0–12000, Pôr do sol 12000–13000, Noite 13000–23000.
- Nível de luz do céu: 15 durante o dia, 4 durante a noite (mas mobs usam o valor "interno" 0
  para spawn noturno a céu aberto).
- Cor do céu interpolada por hora: dia `#78A7FF` → pôr do sol `#FC9A54` → noite `#0A0A18`.
- Sol e lua: quads que orbitam. Lua com **8 fases** (afeta spawn de slime, pós-MVP).
- **Chuva/tempestade** (pós-MVP): partículas verticais, escurece o céu para luz 12, apaga fogo,
  enche caldeirão, aumenta spawn hostil de dia em nível de luz baixo.

## 9. Física de blocos (block updates)

Ao mudar um bloco, agendar update nos 6 vizinhos (+ 6 do vizinho, para fluidos):

| Comportamento | Blocos | Regra |
|---|---|---|
| **Gravidade** | sand, gravel | Se o bloco abaixo é ar/fluido/substituível, vira entidade caindo |
| **Suporte** | torch, flower, sapling, tall grass, ladder, rail, door | Quebra se o suporte sumir |
| **Fluido** | water, lava | Ver abaixo |
| **Crescimento** | sapling, wheat, carrot, sugar cane, cactus | Random tick |
| **Espalhamento** | grass block, mycelium | Random tick, para dirt adjacente com luz ≥ 4 |
| **Fogo** | fire | Random tick, espalha para blocos inflamáveis, extingue sem combustível |

### Fluidos
Modelo simplificado com nível 0–7 (0 = fonte):
- Água espalha 7 blocos na horizontal, lava 3 (4 no Nether).
- Fluxo prefere descer; se descer, não espalha lateralmente naquele bloco.
- **Busca de menor caminho:** ao espalhar lateralmente, olhar até 5 blocos à frente para achar um
  buraco e fluir preferencialmente para lá (é o que faz água "encontrar" a descida).
- Água + Lava: fonte+fluxo = cobblestone; fonte+fonte = obsidian; lava fluindo sobre água = stone.
- Duas fontes de água adjacentes criam nova fonte (fonte infinita).
- Atualização de fluido a cada 5 ticks (água) / 30 ticks (lava no Overworld).
- **Limite de 512 updates de fluido por tick** para não travar o frame.
