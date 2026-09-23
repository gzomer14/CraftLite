/**
 * O que um morador da aldeia lembra (M9): casa, porta, trabalho, a aldeia a que
 * pertence, as trocas já feitas e em quem o golem está de olho.
 *
 * Fica fora do `MobStore` para não inchar o arquivo com campos que só aldeão e
 * golem usam, mas vive **junto** dele: os mesmos índices, zerado no mesmo
 * `spawn` e copiado no mesmo `removeAt` (troca com o último). Um mob que não é
 * da aldeia simplesmente nunca preenche nada disto.
 */

/** Ofertas guardadas por aldeão. A maior profissão da tabela tem 4. */
export const MAX_TRADES = 6;

export class VillageState {
  /** Pé da cama que é a casa dele; vale se `hasHome`. */
  readonly homeX: Int32Array;
  readonly homeY: Int32Array;
  readonly homeZ: Int32Array;
  /** Metade de baixo da porta da casa. */
  readonly doorX: Int32Array;
  readonly doorY: Int32Array;
  readonly doorZ: Int32Array;
  /** Para onde é a rua, em índice de `FACING_STEP` (0 +X, 1 −X, 2 +Z, 3 −Z). */
  readonly doorOut: Uint8Array;
  readonly hasHome: Uint8Array;
  /** Onde trabalha de dia (bloco de trabalho, ou o meio da plantação). */
  readonly workX: Int32Array;
  readonly workY: Int32Array;
  readonly workZ: Int32Array;
  readonly hasWork: Uint8Array;
  /** Poço da aldeia: o meio dela, e a chave da reputação. */
  readonly centerX: Int32Array;
  readonly centerY: Int32Array;
  readonly centerZ: Int32Array;
  /** 1 = pertence a uma aldeia (aldeão e golem nascidos nela). */
  readonly member: Uint8Array;
  /** Ticks restantes do alarme do sino: vai para casa como se fosse noite. */
  readonly alarmTicks: Int16Array;
  /** Vezes que cada oferta já foi usada desde o último reabastecimento. */
  readonly tradeUses: Uint8Array;
  /** Dia (`DayNight.day`) do último reabastecimento. */
  readonly restockDay: Int32Array;
  /**
   * Mob que o golem está enfrentando, ou −1. Revalidado todo tick — o índice
   * pode apontar para outro mob depois de uma remoção, e a checagem de
   * categoria descarta o engano no mesmo tick.
   */
  readonly targetMob: Int16Array;
  /**
   * Menor distância ao destino da rotina já alcançada, e há quantos ticks ela
   * não melhora — é o que diz que o aldeão ficou preso num canto.
   */
  readonly bestDistance: Float32Array;
  readonly stuckTicks: Int16Array;

  constructor(capacity: number) {
    const i32 = (): Int32Array => new Int32Array(capacity);
    const u8 = (): Uint8Array => new Uint8Array(capacity);
    this.homeX = i32(); this.homeY = i32(); this.homeZ = i32();
    this.doorX = i32(); this.doorY = i32(); this.doorZ = i32();
    this.doorOut = u8();
    this.hasHome = u8();
    this.workX = i32(); this.workY = i32(); this.workZ = i32();
    this.hasWork = u8();
    this.centerX = i32(); this.centerY = i32(); this.centerZ = i32();
    this.member = u8();
    this.alarmTicks = new Int16Array(capacity);
    this.tradeUses = new Uint8Array(capacity * MAX_TRADES);
    this.restockDay = i32();
    this.targetMob = new Int16Array(capacity);
    this.bestDistance = new Float32Array(capacity);
    this.stuckTicks = new Int16Array(capacity);
  }

  /** Slot novo: ninguém é da aldeia até alguém dizer que é. */
  reset(i: number): void {
    this.hasHome[i] = 0;
    this.hasWork[i] = 0;
    this.member[i] = 0;
    this.alarmTicks[i] = 0;
    this.restockDay[i] = -1;
    this.targetMob[i] = -1;
    this.bestDistance[i] = Infinity;
    this.stuckTicks[i] = 0;
    this.tradeUses.fill(0, i * MAX_TRADES, (i + 1) * MAX_TRADES);
  }

  /** Copia `from` sobre `to` (remoção do meio do pool). */
  copy(to: number, from: number): void {
    this.homeX[to] = this.homeX[from]; this.homeY[to] = this.homeY[from]; this.homeZ[to] = this.homeZ[from];
    this.doorX[to] = this.doorX[from]; this.doorY[to] = this.doorY[from]; this.doorZ[to] = this.doorZ[from];
    this.doorOut[to] = this.doorOut[from];
    this.hasHome[to] = this.hasHome[from];
    this.workX[to] = this.workX[from]; this.workY[to] = this.workY[from]; this.workZ[to] = this.workZ[from];
    this.hasWork[to] = this.hasWork[from];
    this.centerX[to] = this.centerX[from]; this.centerY[to] = this.centerY[from];
    this.centerZ[to] = this.centerZ[from];
    this.member[to] = this.member[from];
    this.alarmTicks[to] = this.alarmTicks[from];
    this.restockDay[to] = this.restockDay[from];
    this.targetMob[to] = this.targetMob[from];
    this.bestDistance[to] = this.bestDistance[from];
    this.stuckTicks[to] = this.stuckTicks[from];
    this.tradeUses.copyWithin(to * MAX_TRADES, from * MAX_TRADES, (from + 1) * MAX_TRADES);
  }

  setHome(
    i: number, bedX: number, bedY: number, bedZ: number,
    doorX: number, doorY: number, doorZ: number, doorOut: number,
  ): void {
    this.homeX[i] = bedX; this.homeY[i] = bedY; this.homeZ[i] = bedZ;
    this.doorX[i] = doorX; this.doorY[i] = doorY; this.doorZ[i] = doorZ;
    this.doorOut[i] = doorOut;
    this.hasHome[i] = 1;
  }

  setWork(i: number, x: number, y: number, z: number): void {
    this.workX[i] = x; this.workY[i] = y; this.workZ[i] = z;
    this.hasWork[i] = 1;
  }

  setCenter(i: number, x: number, y: number, z: number): void {
    this.centerX[i] = x; this.centerY[i] = y; this.centerZ[i] = z;
    this.member[i] = 1;
  }
}
