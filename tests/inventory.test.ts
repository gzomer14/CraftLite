/**
 * Todas as interações de slot do doc 08 §3.5.
 *
 * O doc é explícito sobre por que isso importa: "é o que separa um inventário
 * utilizável de um frustrante". Cada linha da tabela do doc vira um teste aqui.
 */
import { describe, expect, it } from 'vitest';
import {
  Inventory, CRAFT_RESULT, HOTBAR_START, MAIN_END, MAIN_START,
} from '../src/game/inventory';
import { itemId, makeStack } from '../src/data/items';

const STONE = itemId('cobblestone');
const DIRT = itemId('dirt');
const PICK = itemId('iron_pickaxe');

function inv(): Inventory {
  return new Inventory();
}

describe('clique esquerdo', () => {
  it('pega o stack inteiro no cursor', () => {
    const i = inv();
    i.set(0, makeStack(STONE, 30));
    i.click(0, 'left');
    expect(i.cursor?.count).toBe(30);
    expect(i.get(0)).toBeNull();
  });

  it('solta tudo em slot vazio', () => {
    const i = inv();
    i.cursor = makeStack(STONE, 30);
    i.click(5, 'left');
    expect(i.get(5)?.count).toBe(30);
    expect(i.cursor).toBeNull();
  });

  it('junta até o limite de stack', () => {
    const i = inv();
    i.set(0, makeStack(STONE, 60));
    i.cursor = makeStack(STONE, 10);
    i.click(0, 'left');
    expect(i.get(0)?.count).toBe(64);
    expect(i.cursor?.count).toBe(6); // sobrou o que não coube
  });

  it('troca quando os itens são diferentes', () => {
    const i = inv();
    i.set(0, makeStack(STONE, 5));
    i.cursor = makeStack(DIRT, 3);
    i.click(0, 'left');
    expect(i.get(0)?.item).toBe(DIRT);
    expect(i.cursor?.item).toBe(STONE);
  });

  it('slot cheio com o mesmo item: nada acontece', () => {
    // Trocar aqui seria surpreendente: o clique foi para juntar, não permutar.
    const i = inv();
    i.set(0, makeStack(STONE, 64));
    i.cursor = makeStack(STONE, 10);
    expect(i.click(0, 'left')).toBe(false);
    expect(i.get(0)?.count).toBe(64);
    expect(i.cursor?.count).toBe(10);
  });

  it('clicar em slot vazio com cursor vazio não faz nada', () => {
    const i = inv();
    expect(i.click(0, 'left')).toBe(false);
  });
});

describe('clique direito', () => {
  it('pega metade, arredondando para cima', () => {
    const i = inv();
    i.set(0, makeStack(STONE, 7));
    i.click(0, 'right');
    expect(i.cursor?.count).toBe(4);
    expect(i.get(0)?.count).toBe(3);
  });

  it('pegar de um item só esvazia o slot', () => {
    const i = inv();
    i.set(0, makeStack(STONE, 1));
    i.click(0, 'right');
    expect(i.cursor?.count).toBe(1);
    expect(i.get(0)).toBeNull();
  });

  it('solta 1 item em slot vazio', () => {
    const i = inv();
    i.cursor = makeStack(STONE, 10);
    i.click(3, 'right');
    expect(i.get(3)?.count).toBe(1);
    expect(i.cursor?.count).toBe(9);
  });

  it('solta 1 item em slot com o mesmo item', () => {
    const i = inv();
    i.set(3, makeStack(STONE, 5));
    i.cursor = makeStack(STONE, 10);
    i.click(3, 'right');
    expect(i.get(3)?.count).toBe(6);
    expect(i.cursor?.count).toBe(9);
  });

  it('não passa do limite de stack', () => {
    const i = inv();
    i.set(3, makeStack(STONE, 64));
    i.cursor = makeStack(STONE, 10);
    expect(i.click(3, 'right')).toBe(false);
    expect(i.get(3)?.count).toBe(64);
  });

  it('solta o último item e limpa o cursor', () => {
    const i = inv();
    i.cursor = makeStack(STONE, 1);
    i.click(3, 'right');
    expect(i.cursor).toBeNull();
  });
});

describe('shift + clique', () => {
  it('move da hotbar para o inventário principal', () => {
    const i = inv();
    i.set(0, makeStack(STONE, 20));
    i.click(0, 'left', { shift: true });
    expect(i.get(0)).toBeNull();
    expect(i.get(MAIN_START)?.count).toBe(20);
  });

  it('move do inventário principal para a hotbar', () => {
    const i = inv();
    i.set(MAIN_START, makeStack(STONE, 20));
    i.click(MAIN_START, 'left', { shift: true });
    expect(i.get(MAIN_START)).toBeNull();
    expect(i.get(HOTBAR_START)?.count).toBe(20);
  });

  it('empilha no que já existe antes de ocupar slot vazio', () => {
    const i = inv();
    i.set(MAIN_START, makeStack(STONE, 60));
    i.set(0, makeStack(STONE, 10));
    i.click(0, 'left', { shift: true });
    // Completa o stack parcial e o resto vai para o próximo slot livre.
    expect(i.get(MAIN_START)?.count).toBe(64);
    expect(i.get(MAIN_START + 1)?.count).toBe(6);
    expect(i.get(0)).toBeNull();
  });

  it('não faz nada com o destino cheio', () => {
    const i = inv();
    for (let s = MAIN_START; s < MAIN_END; s++) i.set(s, makeStack(DIRT, 64));
    i.set(0, makeStack(STONE, 10));
    expect(i.click(0, 'left', { shift: true })).toBe(false);
    expect(i.get(0)?.count).toBe(10);
  });
});

describe('teclas 1–9 sobre um slot', () => {
  it('troca com o slot da hotbar', () => {
    const i = inv();
    i.set(MAIN_START, makeStack(STONE, 5));
    i.set(3, makeStack(DIRT, 2));
    i.click(MAIN_START, 'left', { hotbarKey: 3 });
    expect(i.get(3)?.item).toBe(STONE);
    expect(i.get(MAIN_START)?.item).toBe(DIRT);
  });

  it('move para hotbar vazia', () => {
    const i = inv();
    i.set(MAIN_START, makeStack(STONE, 5));
    i.click(MAIN_START, 'left', { hotbarKey: 7 });
    expect(i.get(7)?.item).toBe(STONE);
    expect(i.get(MAIN_START)).toBeNull();
  });
});

describe('duplo clique', () => {
  it('junta todos os stacks iguais no cursor', () => {
    const i = inv();
    i.set(0, makeStack(STONE, 10));
    i.set(1, makeStack(STONE, 20));
    i.set(MAIN_START, makeStack(STONE, 5));
    i.set(2, makeStack(DIRT, 30));
    i.cursor = makeStack(STONE, 5);

    i.doubleClick();
    expect(i.cursor?.count).toBe(40);
    expect(i.get(2)?.item).toBe(DIRT); // item diferente fica
  });

  it('para no limite de stack', () => {
    const i = inv();
    for (let s = 0; s < 5; s++) i.set(s, makeStack(STONE, 30));
    i.cursor = makeStack(STONE, 10);
    i.doubleClick();
    expect(i.cursor?.count).toBe(64);
  });

  it('prioriza stacks parciais', () => {
    const i = inv();
    i.set(0, makeStack(STONE, 64)); // cheio
    i.set(1, makeStack(STONE, 5));  // parcial
    i.cursor = makeStack(STONE, 1);
    i.doubleClick();
    // Pegou o parcial inteiro antes de tocar no cheio.
    expect(i.get(1)).toBeNull();
  });

  it('não faz nada com o cursor vazio', () => {
    expect(inv().doubleClick()).toBe(false);
  });
});

describe('arrastar para distribuir', () => {
  it('botão esquerdo divide igualmente', () => {
    const i = inv();
    i.cursor = makeStack(STONE, 9);
    i.distribute([0, 1, 2], 'left');
    expect(i.get(0)?.count).toBe(3);
    expect(i.get(1)?.count).toBe(3);
    expect(i.get(2)?.count).toBe(3);
    expect(i.cursor).toBeNull();
  });

  it('a sobra da divisão fica no cursor', () => {
    const i = inv();
    i.cursor = makeStack(STONE, 10);
    i.distribute([0, 1, 2], 'left');
    expect(i.get(0)?.count).toBe(3);
    expect(i.cursor?.count).toBe(1);
  });

  it('botão direito solta 1 por slot', () => {
    const i = inv();
    i.cursor = makeStack(STONE, 10);
    i.distribute([0, 1, 2], 'right');
    expect(i.get(0)?.count).toBe(1);
    expect(i.get(1)?.count).toBe(1);
    expect(i.get(2)?.count).toBe(1);
    expect(i.cursor?.count).toBe(7);
  });

  it('soma no que já existe', () => {
    const i = inv();
    i.set(0, makeStack(STONE, 5));
    i.cursor = makeStack(STONE, 4);
    i.distribute([0, 1], 'left');
    expect(i.get(0)?.count).toBe(7);
    expect(i.get(1)?.count).toBe(2);
  });

  it('ignora slots com item diferente', () => {
    const i = inv();
    i.set(1, makeStack(DIRT, 5));
    i.cursor = makeStack(STONE, 4);
    i.distribute([0, 1], 'left');
    expect(i.get(0)?.count).toBe(4);
    expect(i.get(1)?.item).toBe(DIRT);
  });

  it('nunca distribui no slot de resultado', () => {
    const i = inv();
    i.cursor = makeStack(STONE, 4);
    i.distribute([CRAFT_RESULT], 'left');
    expect(i.get(CRAFT_RESULT)).toBeNull();
  });
});

describe('soltar item', () => {
  it('Q joga 1 item', () => {
    const i = inv();
    const dropped: number[] = [];
    i.onDrop = (s) => dropped.push(s.count);
    i.set(0, makeStack(STONE, 10));
    i.dropSelected(false);
    expect(dropped).toEqual([1]);
    expect(i.get(0)?.count).toBe(9);
  });

  it('Ctrl+Q joga o stack inteiro', () => {
    const i = inv();
    const dropped: number[] = [];
    i.onDrop = (s) => dropped.push(s.count);
    i.set(0, makeStack(STONE, 10));
    i.dropSelected(true);
    expect(dropped).toEqual([10]);
    expect(i.get(0)).toBeNull();
  });

  it('clicar fora com o cursor cheio joga tudo', () => {
    const i = inv();
    let dropped = 0;
    i.onDrop = (s) => { dropped = s.count; };
    i.cursor = makeStack(STONE, 12);
    i.dropCursor();
    expect(dropped).toBe(12);
    expect(i.cursor).toBeNull();
  });

  it('regressão: fechar a tela guarda o cursor; só o que não cabe vai ao chão', () => {
    const i = inv();
    let dropped = 0;
    i.onDrop = (s) => { dropped += s.count; };
    i.cursor = makeStack(STONE, 12);
    i.stowCursor();
    expect(i.cursor).toBeNull();
    expect(i.get(0)?.count).toBe(12);
    expect(dropped).toBe(0);
    // Mochila cheia de terra: a pedra não cabe e vai para o chão.
    for (let s = 0; s < 36; s++) i.set(s, makeStack(DIRT, 64));
    i.cursor = makeStack(STONE, 5);
    i.stowCursor();
    expect(dropped).toBe(5);
    expect(i.cursor).toBeNull();
  });
});

describe('give', () => {
  it('enche a hotbar antes do inventário principal', () => {
    const i = inv();
    expect(i.give(STONE, 100)).toBe(0);
    expect(i.get(0)?.count).toBe(64);
    expect(i.get(1)?.count).toBe(36);
  });

  it('devolve o que não coube', () => {
    const i = inv();
    for (let s = HOTBAR_START; s < MAIN_END; s++) i.set(s, makeStack(DIRT, 64));
    expect(i.give(STONE, 10)).toBe(10);
  });

  it('respeita o limite de stack de itens não-empilháveis', () => {
    const i = inv();
    i.give(PICK, 3);
    // Picareta tem maxStack 1: três slots ocupados.
    expect(i.get(0)?.count).toBe(1);
    expect(i.get(1)?.count).toBe(1);
    expect(i.get(2)?.count).toBe(1);
  });
});

describe('durabilidade', () => {
  it('gasta e não quebra antes da hora', () => {
    const i = inv();
    i.set(0, makeStack(PICK, 1));
    expect(i.damageHeld(1, 250)).toBe(false);
    expect(i.get(0)?.damage).toBe(1);
  });

  it('quebra ao chegar no limite', () => {
    const i = inv();
    i.set(0, makeStack(PICK, 1));
    expect(i.damageHeld(250, 250)).toBe(true);
    expect(i.get(0)).toBeNull();
  });
});

describe('morte', () => {
  it('dropa tudo, inclusive o cursor', () => {
    const i = inv();
    i.set(0, makeStack(STONE, 5));
    i.set(MAIN_START, makeStack(DIRT, 3));
    i.cursor = makeStack(PICK, 1);
    const dropped = i.dropAll();
    expect(dropped.length).toBe(3);
    expect(i.get(0)).toBeNull();
    expect(i.cursor).toBeNull();
  });
});

describe('notificação de mudança', () => {
  it('avisa a UI quando algo muda', () => {
    const i = inv();
    let calls = 0;
    i.onChange = () => calls++;
    i.set(0, makeStack(STONE, 1));
    i.click(0, 'left');
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
