# 05 — Itens, Ferramentas, Crafting e Fundição

## 1. Modelo de item

```ts
interface ItemDef {
  id: number;
  name: string;              // 'diamond_pickaxe'
  display: string;           // 'Picareta de Diamante'
  tex: string;               // sprite 16×16 no atlas de itens
  maxStack: number;          // 64 padrão; 16 (ovo, bola de neve, ender pearl); 1 (ferramenta/armadura)
  durability?: number;       // se presente, maxStack = 1
  placesBlock?: number;      // blockId, se for um item de bloco
  tool?: { kind: 'pickaxe'|'axe'|'shovel'|'hoe'|'sword'|'shears'; tier: 1|2|3|4|5; speed: number };
  attack?: { damage: number; speed: number };  // dano e cooldown de ataque
  armor?: { slot: 'head'|'chest'|'legs'|'feet'; defense: number; toughness: number };
  food?: { hunger: number; saturation: number; eatTicks: number; effects?: Effect[] };
  fuel?: number;             // ticks de queima na fornalha
  rarity?: 'common'|'uncommon'|'rare'|'epic';  // cor do nome no tooltip
}
```

**Stack no inventário:** `{ item: uint16, count: uint8, damage: uint16, nbt?: object }`.
Slot vazio = `null` (não um objeto). Isso importa: 36 slots × N contêineres.

## 2. Materiais de ferramenta

| Tier | Material | Speed | Durabilidade | Dano espada | Encantabilidade |
|---|---|---|---|---|---|
| 1 | Madeira | 2.0 | 59 | 4 | 15 |
| 1 | Ouro | 12.0 | 32 | 4 | 22 |
| 2 | Pedra | 4.0 | 131 | 5 | 5 |
| 3 | Ferro | 6.0 | 250 | 6 | 14 |
| 4 | Diamante | 8.0 | 1561 | 7 | 10 |
| 5 | Netherita (pós-MVP) | 9.0 | 2031 | 8 | 15 |

**Dano por tipo de ferramenta** (base do material + modificador):
espada `+4`, machado `+7/6/5` (mais lento), picareta `+2`, pá `+2.5`, enxada `+0`.
Velocidade de ataque: espada 1.6/s, machado 0.8–1.0/s, picareta 1.2/s, pá 1.0/s, mão 4.0/s.

## 3. Armadura

| Peça | Couro | Ouro | Ferro | Diamante |
|---|---|---|---|---|
| Capacete | 1 | 2 | 2 | 3 |
| Peitoral | 3 | 5 | 6 | 8 |
| Calça | 2 | 3 | 5 | 6 |
| Bota | 1 | 1 | 2 | 3 |
| **Total (pontos)** | **7** | **11** | **15** | **20** |
| Durabilidade (peitoral) | 80 | 112 | 240 | 528 |

Redução de dano: `damage × (1 − min(20, armor) / 25)` (aproximação boa da fórmula real,
sem toughness). Com toughness (diamante = 2/peça):
`reduction = min(20, armor − damage / (2 + toughness/4)) / 25`.

## 4. Comida

| Item | Fome | Saturação | Ticks | Nota |
|---|---|---|---|---|
| apple | 4 | 2.4 | 32 | |
| bread | 5 | 6.0 | 32 | |
| carrot | 3 | 3.6 | 32 | |
| potato (crua) | 1 | 0.6 | 32 | |
| baked_potato | 5 | 6.0 | 32 | |
| cooked_beef | 8 | 12.8 | 32 | |
| beef (crua) | 3 | 1.8 | 32 | |
| cooked_porkchop | 8 | 12.8 | 32 | |
| cooked_chicken | 6 | 7.2 | 32 | |
| chicken (crua) | 2 | 1.2 | 32 | 30% chance de Fome por 30s |
| cooked_mutton | 6 | 9.6 | 32 | |
| cooked_cod | 5 | 6.0 | 32 | |
| melon_slice | 2 | 1.2 | 32 | |
| golden_apple | 4 | 9.6 | 32 | Regeneração II 5s, Absorção 2min |
| rotten_flesh | 4 | 0.8 | 32 | 80% chance de Fome por 30s |
| mushroom_stew | 6 | 7.2 | 32 | devolve tigela, stack 1 |
| cookie | 2 | 0.4 | 32 | |
| cake (bloco) | 2/fatia | 0.4 | — | 7 fatias |

## 5. Combustíveis (fornalha)

| Item | Ticks de queima | Itens fundidos |
|---|---|---|
| lava_bucket | 20000 | 100 |
| coal_block | 16000 | 80 |
| blaze_rod | 2400 | 12 |
| coal / charcoal | 1600 | 8 |
| planks (qualquer) | 300 | 1.5 |
| log | 300 | 1.5 |
| stick | 100 | 0.5 |
| sapling | 100 | 0.5 |
| wooden tool | 200 | 1 |

Fundir 1 item leva **200 ticks (10 s)** e dá XP ao coletar.

## 6. Sistema de crafting

### 6.1 Estrutura de dados

```ts
type Ingredient = string | string[];   // 'oak_planks' ou tag ['oak_planks','birch_planks',...]

interface ShapedRecipe {
  type: 'shaped';
  pattern: string[];                   // ex. ['XXX', ' # ', ' # ']  (' ' = vazio)
  key: Record<string, Ingredient>;     // { X: '#planks', '#': 'stick' }
  result: { item: string; count: number };
  width: number; height: number;       // derivados do pattern
}

interface ShapelessRecipe {
  type: 'shapeless';
  ingredients: Ingredient[];           // até 9
  result: { item: string; count: number };
}
```

**Tags** (grupos): `#planks`, `#logs`, `#wool`, `#stone_tool_materials`, `#coals`. Uma tag é
um array de ids resolvido no boot. Isso evita escrever 4 receitas de bancada (uma por madeira).

### 6.2 Algoritmo de matching (obrigatório acertar isto)

**Shaped:**
1. Achar o bounding box mínimo dos slots não-vazios na grade.
2. Se `bbWidth ≠ recipe.width` ou `bbHeight ≠ recipe.height` → não bate.
3. Comparar célula a célula com o pattern.
4. Se falhar, comparar de novo com o **pattern espelhado horizontalmente**.
   (Receitas podem ser deslocadas na grade e espelhadas na horizontal — não na vertical.)

**Shapeless:** multiset de itens na grade == multiset de ingredientes (ignorando posição).

**Indexação para performance:** montar no boot um índice `Map<hash de ingredientes ordenados,
Recipe[]>`. Com <300 receitas, varredura linear também serve (< 0.1 ms), mas indexar mantém o
custo estável quando a lista crescer.

**Crafting em lote:** shift+clique no resultado craft o máximo possível de uma vez.

### 6.3 Receitas do MVP

Notação: grade 3×3 em três linhas; `.` = vazio.

**Básicas**
```
planks       (shapeless) 1 log             → 4 planks
stick        P. / P. ................ 2 planks verticais → 4 sticks
crafting_table  PP / PP ............. 4 planks → 1
chest        PPP / P.P / PPP ........ 8 planks → 1
furnace      CCC / C.C / CCC ........ 8 cobblestone → 1
torch        C. / S. ................ coal/charcoal sobre stick → 4
ladder       S.S / SSS / S.S ........ 7 sticks → 3
bowl         P.P / .P. .............. 3 planks → 4
bucket       I.I / .I. .............. 3 iron_ingot → 1
```

**Ferramentas** (M = material: planks / cobblestone / iron_ingot / gold_ingot / diamond)
```
pickaxe   MMM / .S. / .S.
axe       MM. / MS. / .S.        (também MM / SM / S. espelhado)
shovel    .M. / .S. / .S.
hoe       MM. / .S. / .S.
sword     .M. / .M. / .S.
shears    .I. / I..              (2 iron_ingot)
flint_and_steel  I. / .F.        (iron + flint)
```

**Armadura** (M = leather / iron_ingot / gold_ingot / diamond)
```
helmet     MMM / M.M
chestplate M.M / MMM / MMM
leggings   MMM / M.M / M.M
boots      M.M / M.M
```

**Blocos e utilidades**
```
stone_bricks    SS / SS  (4 stone)                → 4
slab            XXX (3 do bloco)                  → 6
stairs          X.. / XX. / XXX (6 do bloco)      → 4
fence           PSP / PSP                          → 3
door            PP / PP / PP                       → 3
trapdoor        PPP / PPP                          → 2
glass           ← fundição de sand
bookshelf       PPP / BBB / PPP (3 books)          → 1
book            (shapeless) 3 paper + 1 leather    → 1
paper           SSS (3 sugar_cane)                 → 3
bed             WWW / PPP (3 wool + 3 planks)      → 1
iron_block      3×3 de iron_ingot                  → 1  (e o inverso: 1 block → 9 ingots)
bread           WWW (3 wheat)                      → 1
cookie          WCW (wheat, cocoa, wheat)          → 8
cake            MMM / SES / WWW                    → 1
mushroom_stew   (shapeless) 2 mushrooms + bowl     → 1
tnt             GSG / SGS / GSG (gunpowder+sand)   → 1
```

**Redstone (pós-MVP)**
```
redstone_torch  R. / S.
lever           S. / C.
button          (shapeless) 1 stone ou 1 planks
pressure_plate  XX
piston          PPP / CIC / CRC
dispenser       CCC / CBC / CRC
rail            I.I / ISI / I.I → 16
```

## 7. Fundição (fornalha)

| Entrada | Saída | XP |
|---|---|---|
| raw_iron | iron_ingot | 0.7 |
| raw_gold | gold_ingot | 1.0 |
| raw_copper | copper_ingot | 0.7 |
| sand / red_sand | glass | 0.1 |
| cobblestone | stone | 0.1 |
| stone | smooth_stone | 0.1 |
| clay_ball | brick | 0.3 |
| clay (bloco) | terracotta | 0.35 |
| log (qualquer) | charcoal | 0.15 |
| beef / porkchop / chicken / mutton / cod | versão cozida | 0.35 |
| potato | baked_potato | 0.35 |
| cactus | green_dye | 0.2 |
| netherrack | nether_brick | 0.1 |

**UI da fornalha:** slot de entrada (topo esquerdo), slot de combustível (baixo esquerdo),
slot de saída (direita), seta de progresso animada (0–100%) e chama de combustível (100–0%).
Estado persiste ao fechar; a fornalha continua queimando enquanto o chunk estiver carregado.

## 8. Tabelas de drop

```ts
interface Drop {
  item: string;
  min: number; max: number;         // quantidade
  chance?: number;                  // 0..1, padrão 1
  fortuneBonus?: 'ore' | 'binomial' | 'none';
  requiresSilkTouch?: boolean;
  silkTouchReplacement?: string;    // ex. stone → stone (em vez de cobblestone)
  fireConverts?: string;            // mob morto por fogo dropa a versão cozida
}
```

Fortune em minério: multiplicador `1..(level+1)` uniforme, com peso.
Looting em mob: `+0..level` no máximo do drop raro.

## 9. Itens dropados no mundo (`ItemEntity`)

- Ao quebrar um bloco: spawnar no centro do bloco, velocidade aleatória `±0.1` em X/Z, `+0.2` em Y.
- Física: gravidade `−0.04/tick`, arrasto `0.98`, atrito no chão `0.6`.
- Merge: itens iguais a menos de 0.5 bloco se fundem (limite de stack).
- Coleta automática num raio de **1.0 bloco** (com atração suave de 1 bloco), delay de 10 ticks
  após o spawn (para não pegar de volta o que você jogou).
- **Despawn em 5 minutos (6000 ticks).**
- Renderizar como **quad billboard com o sprite do item** (barato), não como modelo 3D.
  Blocos dropados renderizam como cubo pequeno girando (0.25 de escala).
- **Limite: 200 item entities carregados.** Ao estourar, remover os mais antigos.
