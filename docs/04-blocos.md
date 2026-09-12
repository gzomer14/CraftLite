# 04 — Blocos

## 1. Definição declarativa

```ts
type Face = 'top' | 'bottom' | 'north' | 'south' | 'east' | 'west';

interface BlockDef {
  id: number;                 // 0..1023, estável (nunca reordenar; é gravado no save)
  name: string;               // 'stone', 'oak_log'
  display: string;            // 'Pedra'
  /** textura por face; string única = todas as faces iguais */
  tex: string | { top?: string; bottom?: string; side?: string;
                  north?: string; south?: string; east?: string; west?: string };
  /** forma de colisão/render */
  shape: 'cube' | 'cross' | 'slab' | 'stairs' | 'fence' | 'door' | 'torch'
       | 'carpet' | 'liquid' | 'pane' | 'none';
  solid: boolean;             // colide com entidades
  opaque: boolean;            // bloqueia luz totalmente e esconde faces vizinhas
  lightAttenuation: number;   // 0 = transparente, 15 = opaco (água = 1, folha = 1)
  emission: number;           // 0..15 luz emitida
  hardness: number;           // segundos-base para quebrar à mão (-1 = inquebrável)
  tool: 'none'|'pickaxe'|'axe'|'shovel'|'hoe'|'shears'|'sword';
  minTier: 0|1|2|3|4;         // 0=qualquer,1=wood/gold,2=stone,3=iron,4=diamond
  requiresTool: boolean;      // se true e não tiver a tool/tier, não dropa nada
  drops: Drop[];              // ver 05-itens-e-receitas.md
  flammable: number;          // 0 = não pega fogo; senão "encouragement"
  tint?: 'grass' | 'foliage' | 'water' | null;  // multiplica cor do bioma
  gravity?: boolean;
  replaceable?: boolean;      // grama alta, água — pode colocar bloco por cima
  slipperiness?: number;      // 0.6 padrão, gelo 0.98
  sound: 'stone'|'wood'|'gravel'|'grass'|'sand'|'glass'|'metal'|'cloth'|'snow';
  stateBits?: number;         // quantos bits de estado o bloco usa (rotação, nível...)
}
```

## 2. Tabela de blocos — MVP (63 blocos)

Tempo de quebra em segundos = `hardness × 1.5` (com ferramenta correta) ou `hardness × 5`
(sem ferramenta correta). Ver fórmula exata em [06-jogador-e-fisica.md](06-jogador-e-fisica.md).

### 2.1 Naturais / terreno

| id | name | hardness | tool | minTier | drops | notas |
|---|---|---|---|---|---|---|
| 0 | air | — | — | — | — | `shape:none`, não renderiza |
| 1 | stone | 1.5 | pickaxe | 2 | cobblestone (silk: stone) | |
| 2 | granite | 1.5 | pickaxe | 2 | self | |
| 3 | diorite | 1.5 | pickaxe | 2 | self | |
| 4 | andesite | 1.5 | pickaxe | 2 | self | |
| 5 | cobblestone | 2.0 | pickaxe | 2 | self | |
| 6 | dirt | 0.5 | shovel | 0 | self | |
| 7 | coarse_dirt | 0.5 | shovel | 0 | self | |
| 8 | grass_block | 0.6 | shovel | 0 | dirt | `tint:grass` no topo e nas laterais |
| 9 | podzol | 0.5 | shovel | 0 | dirt (silk: self) | |
| 10 | sand | 0.5 | shovel | 0 | self | `gravity` |
| 11 | red_sand | 0.5 | shovel | 0 | self | `gravity` |
| 12 | gravel | 0.6 | shovel | 0 | gravel (10% flint) | `gravity` |
| 13 | sandstone | 0.8 | pickaxe | 2 | self | faces top/side/bottom diferentes |
| 14 | clay | 0.6 | shovel | 0 | clay_ball ×4 | |
| 15 | snow_block | 0.2 | shovel | 0 | snowball ×4 | |
| 16 | snow_layer | 0.1 | shovel | 0 | snowball | `shape:carpet`, 8 alturas |
| 17 | ice | 0.5 | pickaxe | 0 | nada (silk: self) | `slipperiness:0.98`, vira água |
| 18 | bedrock | −1 | — | — | — | inquebrável |
| 19 | obsidian | 50 | pickaxe | 4 | self | |
| 20 | water | 100 | — | — | — | `shape:liquid`, `tint:water`, atenuação 1 |
| 21 | lava | 100 | — | — | — | `shape:liquid`, `emission:15` |

### 2.2 Minérios

| id | name | hardness | minTier | drops | XP |
|---|---|---|---|---|---|
| 22 | coal_ore | 3.0 | 1 | coal | 0–2 |
| 23 | iron_ore | 3.0 | 2 | raw_iron | 0 |
| 24 | copper_ore | 3.0 | 2 | raw_copper ×2–5 | 0 |
| 25 | gold_ore | 3.0 | 3 | raw_gold | 0 |
| 26 | redstone_ore | 3.0 | 3 | redstone ×4–5 | 1–5 |
| 27 | lapis_ore | 3.0 | 2 | lapis_lazuli ×4–9 | 2–5 |
| 28 | diamond_ore | 3.0 | 3 | diamond | 3–7 |
| 29 | emerald_ore | 3.0 | 3 | emerald | 3–7 |

Todos: `tool: pickaxe`, `requiresTool: true`, `deepslate variant` opcional pós-MVP.

### 2.3 Madeira e vegetação

| id | name | hardness | tool | drops | notas |
|---|---|---|---|---|---|
| 30 | oak_log | 2.0 | axe | self | eixo X/Y/Z (2 bits de estado) |
| 31 | birch_log | 2.0 | axe | self | |
| 32 | spruce_log | 2.0 | axe | self | |
| 33 | acacia_log | 2.0 | axe | self | |
| 34 | oak_planks | 2.0 | axe | self | `flammable:5` |
| 35 | birch_planks | 2.0 | axe | self | |
| 36 | spruce_planks | 2.0 | axe | self | |
| 37 | acacia_planks | 2.0 | axe | self | |
| 38 | oak_leaves | 0.2 | shears/hoe | 5% sapling, 2% apple (shears: self) | `tint:foliage`, decai sem log em 4 blocos |
| 39 | birch_leaves | 0.2 | shears | 5% sapling | |
| 40 | spruce_leaves | 0.2 | shears | 5% sapling | |
| 41 | oak_sapling | 0 | — | self | `shape:cross`, cresce em random tick |
| 42 | tall_grass | 0 | shears | 12.5% wheat_seeds | `shape:cross`, `replaceable`, `tint:grass` |
| 43 | fern | 0 | shears | 12.5% seeds | |
| 44 | dandelion | 0 | — | self | `shape:cross` |
| 45 | poppy | 0 | — | self | |
| 46 | cactus | 0.4 | — | self | dá dano de contato 1♥, cresce até 3 |
| 47 | sugar_cane | 0 | — | self | precisa de água adjacente |
| 48 | dead_bush | 0 | shears | stick 0–2 | |
| 49 | vine | 0.2 | shears/axe | shears: self | escalável |
| 50 | pumpkin | 1.0 | axe | self | |
| 51 | melon | 1.0 | axe | melon_slice ×3–7 | |

### 2.4 Construídos / funcionais

| id | name | hardness | tool | notas |
|---|---|---|---|---|
| 52 | crafting_table | 2.5 | axe | Abre grade 3×3 |
| 53 | furnace | 3.5 | pickaxe | 3 slots; face voltada ao jogador; `emission:13` quando aceso |
| 54 | chest | 2.5 | axe | 27 slots; junta com chest adjacente = 54 |
| 55 | torch | 0 | — | `emission:14`, `shape:torch`, pode ir em parede |
| 56 | glass | 0.3 | — | dropa nada (silk: self), `opaque:false`, não faz face com outro glass |
| 57 | glowstone | 0.3 | pickaxe | `emission:15`, dropa glowstone_dust ×2–4 |
| 58 | bookshelf | 1.5 | axe | dropa book ×3 |
| 59 | ladder | 0.4 | axe | permite subir, `solid:false` |
| 60 | oak_door | 3.0 | axe | 2 blocos de altura, estado aberto/fechado + hinge |
| 61 | oak_fence | 2.0 | axe | colisão 1.5 de altura, conecta com vizinhos |
| 62 | bed | 0.2 | — | 2 blocos, define spawn, pula a noite |
| 63 | tnt | 0 | — | explode com fogo/redstone (pós-MVP) |
| 64 | stone_bricks | 1.5 | pickaxe | |
| 65 | cobblestone_stairs / slab | 2.0 | pickaxe | `shape:stairs`/`slab`, 4 rotações + top/bottom |
| 66 | wool (16 cores) | 0.8 | shears | `flammable:30` |
| 67 | iron_block / gold_block / diamond_block | 5.0 | pickaxe | armazenamento compacto |
| 68 | mob_spawner | 5.0 | pickaxe | não dropa; usado em dungeon |

### 2.5 Bloco de estados

O `uint16` de blockState:
```
bits 0-9   → blockId          (0..1023)
bits 10-15 → state            (0..63), significado depende do bloco:
  log            : axis (0=Y, 1=X, 2=Z)
  stairs         : facing(2) + half(1) + shape(3 → straight/inner/outer L/R)
  slab           : type (bottom/top/double)
  door           : facing(2) + open(1) + hinge(1) + half(1)
  fence/pane/vine: conexões N/S/E/W (4 bits) — calculado no meshing, não guardado
  water/lava     : level 0..7 + falling(1)
  crops          : age 0..7
  furnace        : facing(2) + lit(1)
  torch          : attach (0=chão, 1..4=paredes)
  bed            : facing(2) + part(1) + occupied(1)
```
**Regra:** estados puramente derivados dos vizinhos (fence, pane, redstone dust, vine) são
calculados durante o meshing e **não** ocupam bits no save.

## 3. Regras de renderização por `shape`

| shape | Geometria | Colisão |
|---|---|---|
| `cube` | 6 faces (só as visíveis), participa do greedy meshing | AABB cheia |
| `cross` | 2 quads em X, sem cull, `alphaTest`, não participa do greedy | nenhuma |
| `slab` | meia caixa | AABB 0.5 |
| `stairs` | 2 caixas (base + degrau), com variantes de canto | 2 AABBs |
| `torch` | quad central 2px + topo | nenhuma |
| `liquid` | topo com altura variável por nível, faces laterais só contra ar/não-fluido | nenhuma (aplica arrasto) |
| `pane`/`fence` | post central + braços conforme conexão | AABB fino / 1.5 alto |
| `door` | quad fino, 3px de espessura, no lado conforme facing/open | AABB fino |

**Importante:** blocos não-`cube` saem do greedy meshing e vão para um buffer separado
("mesh de blocos complexos") no mesmo chunk, para não quebrar as máscaras de bits.

## 4. Ordem de descoberta de textura

Nome de textura → índice de camada do texture array, resolvido no boot.
Convenção: `block/stone`, `block/oak_log_top`, `block/grass_block_side`.
Blocos com `tint` usam textura em escala de cinza multiplicada pela cor do bioma no shader.
O `grass_block_side` usa uma **overlay** separada (textura de terra + overlay de grama tintada),
igual ao original — sem isso a grama fica com cor errada nos biomas.
