# 12 — Multijogador (opcional, pós-MVP)

Fora do MVP, mas **a arquitetura precisa nascer com os ganchos certos** ou refatorar depois custa
caro. Este documento define o que deve ser respeitado desde o dia 1.

## 1. Regras de arquitetura a seguir desde já

1. **Toda mutação do mundo passa por um único ponto:**
   `world.setBlock(x, y, z, state, source)`. Nunca escrever no array de voxels direto a partir da
   UI ou da física. Isso é o que permite plugar rede depois.
2. **O estado do jogo é separado do render.** Nada de guardar posição só na câmera.
3. **Tudo é determinístico a partir da seed** — dois clientes com a mesma seed geram o mesmo mundo,
   então só é preciso sincronizar *diferenças*.
4. **Comandos, não estados:** ações do jogador são objetos serializáveis
   (`{t:'break', x,y,z}`, `{t:'place', x,y,z,item}`, `{t:'move', x,y,z,yaw,pitch}`).
5. Tick numerado globalmente (`totalTicks`), usado como timestamp lógico.

## 2. Opção A — P2P via WebRTC (recomendada: sem custo de servidor)

- Um jogador é o **host** (autoritativo). Os outros são clientes.
- Sinalização: um servidor minúsculo de WebSocket (ou um serviço pronto) só para trocar
  SDP/ICE. Depois disso, o tráfego é direto entre navegadores.
- `RTCDataChannel` com `ordered: false, maxRetransmits: 0` para posição (não importa perder um
  pacote antigo) e um segundo canal `ordered: true` confiável para blocos, inventário e chat.
- Código de sala de 6 caracteres para entrar.
- Limite prático: **4–6 jogadores** (o host de celular não aguenta mais).

## 3. Opção B — Servidor Node com WebSocket

Se algum dia quiser servidores dedicados: mesmo protocolo, mas o servidor roda a simulação
autoritativa e o cliente só prevê. Mais caro e desnecessário para o escopo deste projeto.

## 4. Protocolo (esboço, binário)

Todo pacote: `u8 type | payload`. Usar `DataView`, nunca JSON no caminho quente.

| Tipo | Direção | Payload |
|---|---|---|
| `0x01 HELLO` | C→S | protocolVersion, nome, uuid |
| `0x02 WELCOME` | S→C | worldMeta, playerId, spawn |
| `0x10 CHUNK` | S→C | cx, cz, dados serializados (só se diferir da geração) |
| `0x11 BLOCK_CHANGE` | ambos | x, y, z, state |
| `0x12 MULTI_BLOCK` | S→C | lista (explosão, fluido) |
| `0x20 PLAYER_MOVE` | ambos | id, x, y, z (fixed-point 1/32), yaw, pitch (u8), flags |
| `0x21 PLAYER_SPAWN/DESPAWN` | S→C | |
| `0x22 PLAYER_ACTION` | C→S | tipo, alvo (quebrar, colocar, atacar, usar) |
| `0x30 ENTITY_UPDATE` | S→C | batch de mobs (id, pos delta, estado) — 10 Hz |
| `0x40 INVENTORY` | S→C | slot, item, count |
| `0x50 CHAT` | ambos | texto |
| `0x60 TIME` | S→C | totalTicks, weather |

**Taxas:** posição do jogador 20 Hz; entidades 10 Hz com delta compression; blocos por evento.

## 5. Predição e reconciliação

- **Client-side prediction** do próprio jogador (aplica o input local imediatamente).
- Guardar os últimos 60 inputs; ao receber a posição autoritativa do host, se divergir > 0.1 bloco,
  fazer *rewind* e reaplicar os inputs seguintes.
- **Interpolação** de outros jogadores/mobs com 100 ms de buffer (renderiza o passado, fica suave).
- Blocos: aplicar localmente na hora (otimista) e reverter se o host negar. A latência de colocar
  bloco é a coisa mais perceptível — nunca esperar o round-trip.

## 6. Segurança mínima

Mesmo em P2P entre amigos: o host valida alcance (≤ 6 blocos), cooldown de ações, e se o jogador
realmente tem o item. Não confiar no cliente.
