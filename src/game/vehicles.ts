/**
 * Barco e carrinho do ponto de vista do jogador: montar, pilotar, descer e
 * salvar (doc 14 — M6 e M7).
 *
 * Saiu da `Session` em 2026-09-22 (M13, "dividir os três módulos gigantes").
 * As entidades em si continuam em `entity/boat.ts` e `entity/minecart.ts`;
 * aqui fica só o que liga o jogador a elas.
 */

import { BOAT_SEAT_HEIGHT, Boats } from '../entity/boat';
import { CART_SEAT_HEIGHT, type Minecarts } from '../entity/minecart';
import type { Player } from '../entity/player';
import type { World } from '../world/world';

/** Alcance para montar num barco. */
const BOAT_MOUNT_RANGE = 2.5;
/** Alcance para montar num carrinho — menor: ele é menor que o barco. */
const CART_MOUNT_RANGE = 1.8;

/**
 * Um veículo serializado (M7). `dir` só existe no carrinho: o barco anda para
 * onde o yaw aponta, o carrinho anda ao longo do trilho.
 */
export interface VehicleRecord {
  kind: 'boat' | 'minecart';
  x: number;
  y: number;
  z: number;
  yaw: number;
  dir?: number;
}

export class Vehicles {
  readonly boats = new Boats();
  readonly carts: Minecarts;
  private readonly player: Player;
  /** Conquista ao montar pela primeira vez (`boat`, `minecart`). */
  private readonly onMount: (kind: 'boat' | 'minecart') => void;
  /** Índice do barco que o jogador pilota, ou −1. */
  private riding = -1;
  /** Índice do carrinho que o jogador pilota, ou −1. Nunca os dois ao mesmo tempo. */
  private ridingCart = -1;

  constructor(
    player: Player, carts: Minecarts, onMount: (kind: 'boat' | 'minecart') => void,
  ) {
    this.player = player;
    this.carts = carts;
    this.onMount = onMount;
  }

  get isRiding(): boolean {
    return this.riding >= 0 || this.ridingCart >= 0;
  }

  tick(world: World): void {
    this.boats.tick(world);
    this.carts.tick(world);
  }

  /**
   * Monta no veículo mais próximo, ou desce do que está pilotando.
   *
   * O carrinho vem antes do barco porque um carrinho parado num trilho dentro
   * d'água é o único caso em que os dois disputam, e ali quem manda é o trilho.
   */
  tryRide(): boolean {
    if (this.isRiding) {
      this.riding = -1;
      this.ridingCart = -1;
      return true;
    }
    const p = this.player;
    const cart = this.carts.findNear(p.x, p.y, p.z, CART_MOUNT_RANGE);
    if (cart >= 0) {
      this.ridingCart = cart;
      this.onMount('minecart');
      return true;
    }
    const index = this.boats.findNear(p.x, p.y, p.z, BOAT_MOUNT_RANGE);
    if (index < 0) return false;
    this.riding = index;
    this.onMount('boat');
    return true;
  }

  /**
   * Pilota o veículo com o eixo de movimento do jogador.
   * Chamado por `main.ts` no lugar do tick de física do jogador.
   */
  drive(forward: number): void {
    if (this.ridingCart >= 0) {
      this.carts.drive(this.ridingCart, forward, this.player.yaw);
      return;
    }
    if (this.riding < 0) return;
    this.boats.drive(this.riding, forward, this.player.yaw);
  }

  /** Cola o jogador no veículo que ele pilota, e o solta se o veículo sumiu. */
  syncRider(): void {
    const p = this.player;
    if (this.ridingCart >= 0) {
      if (this.ridingCart >= this.carts.active) { this.ridingCart = -1; return; }
      p.setPosition(
        this.carts.x[this.ridingCart],
        this.carts.y[this.ridingCart] + CART_SEAT_HEIGHT,
        this.carts.z[this.ridingCart],
      );
      p.fallDistance = 0;
      return;
    }
    if (this.riding < 0) return;
    if (this.riding >= this.boats.active) { this.riding = -1; return; }
    p.setPosition(
      this.boats.x[this.riding],
      this.boats.y[this.riding] + BOAT_SEAT_HEIGHT,
      this.boats.z[this.riding],
    );
    p.fallDistance = 0;
  }

  /**
   * Barcos e carrinhos da dimensão atual, para o save (M7).
   *
   * Barco e carrinho **não eram salvos** desde que existem: sair do mundo e
   * voltar sumia com os dois. O trilho ficava; o carrinho em cima dele, não.
   */
  snapshot(): VehicleRecord[] {
    const out: VehicleRecord[] = [];
    for (let i = 0; i < this.boats.active; i++) {
      out.push({
        kind: 'boat',
        x: this.boats.x[i], y: this.boats.y[i], z: this.boats.z[i],
        yaw: this.boats.yaw[i],
      });
    }
    for (let i = 0; i < this.carts.active; i++) {
      out.push({
        kind: 'minecart',
        x: this.carts.x[i], y: this.carts.y[i], z: this.carts.z[i],
        yaw: this.carts.yaw[i], dir: this.carts.dir[i],
      });
    }
    return out;
  }

  /** Recoloca os veículos que vieram do save. Substitui o que houver. */
  restore(records: readonly VehicleRecord[]): void {
    this.clear();
    for (const record of records) {
      if (record.kind === 'minecart') this.carts.spawn(record.x, record.y, record.z, record.dir ?? 0);
      else this.boats.spawn(record.x, record.y, record.z, record.yaw);
    }
  }

  /** Esquece tudo (troca de dimensão, restauração). */
  clear(): void {
    this.boats.clear();
    this.carts.clear();
    this.riding = -1;
    this.ridingCart = -1;
  }
}
