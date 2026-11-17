// Mean-reversion bot for the make.fun BTC race (btc-race-24h-20261117-0603).
//
// One asset, CBBTC/USDC, long only, full size, at most one position at a time.
//
// Why mean reversion, not trend following, on this market:
//   - The dev window is choppy and nearly flat (+49 bps over 24 h, mean |1-minute|
//     move ~4.3 bps) while one full-size round trip costs ~37 bps in the dev
//     window (4 bps fee + 2 bps slippage + ~13 bps of pool impact per side, at
//     the dev window's ~$790k pool depth). A 1-minute EMA crossover fires dozens
//     of times and every whipsaw pays the round trip: on the dev window the
//     EMA(8/21) baseline loses ~$100 and EMA(12/48) ~$14-28.
//   - The same window does keep reverting to its slow mean: hourly closes swing
//     roughly -60..+140 bps around the start and come back. Buying a clear dip
//     below the slow mean and selling on the recovery back above it catches
//     swings of 80-120 bps gross, which survive the ~37 bps round trip.
//
// Rules (all on 1-minute closes, all thresholds in basis points):
//   - Mean: SMA(240) of closes (~4 h). No signal until it is seeded.
//   - Entry, when flat: close <= SMA * (1 - 80 bps). Buy with all cash.
//   - Exit, when long, whichever comes first:
//       * recovery: close >= SMA * (1 + 30 bps) — the dip has reverted and then
//         some, so the trade banked the swing;
//       * stop-loss: close <= entry close * (1 - 150 bps) — the dip was the
//         start of a real downtrend, get out before it gets worse;
//       * time-stop: held 480 bars (~8 h) without recovering — do not ride a
//         grinding market to the end of the window.
//   - Cooldown: no new entry within 10 bars of an exit, so a rejected or
//     marginal exit does not re-enter on the same dip.
//   - max_slippage_bps 100 (1%): a fill more than 1% past the close it was
//     decided on is refused rather than chased. The signals are level-based
//     (they stay true while the condition holds), so a refused order is simply
//     sent again on the next bar.
//   - Position: 100% of cash on entry, the whole position on exit. At most one
//     order per reply; the harness flattens anything still held at the end.
//
// Determinism: pure float arithmetic on the closes seen so far; no clock, no
// environment, no Math.random. Two runs on the same bars give the same orders.

import { runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Bars in the slow mean. */
const SMA_BARS = 240;
/** Entry: close this far below the slow mean (bps). */
const DIP_BPS = 80;
/** Exit on recovery: close this far above the slow mean (bps). */
const RECOVER_BPS = 30;
/** Exit on stop-loss: close this far below the entry close (bps). */
const STOP_BPS = 150;
/** Exit on time-stop: bars held without recovering. */
const MAX_HOLD_BARS = 480;
/** Bars to wait after an exit before a new entry. */
const COOLDOWN_BARS = 10;
const MAX_SLIPPAGE_BPS = 100;

/** The last SMA_BARS closes, in order, once seeded. */
const closes: number[] = [];
let smaSum = 0;
/** Close at which the current position was entered (decision bar's close). */
let entryClose = 0;
/** Bar index (count of CBBTC bars seen) at which the current position was entered. */
let entryBar = -1;
/** Bar index at which the last exit was decided. */
let lastExitBar = -1e9;
/** Bar index counter: CBBTC bars seen so far. */
let barNo = -1;

/** SMA(240) of the closes seen, once seeded; null before that. */
function slowMean(): number | null {
  if (closes.length < SMA_BARS) return null;
  return smaSum / SMA_BARS;
}

await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined || state.warmingUp) return [];
    barNo++;
    const close = Number(bar.c);
    closes.push(close);
    smaSum += close;
    if (closes.length > SMA_BARS) smaSum -= closes.shift()!;

    const mean = slowMean();
    if (mean === null) return [];
    const held = state.positions.get(SYMBOL);
    const dip = close <= mean * (1 - DIP_BPS / 10000);
    const recovered = close >= mean * (1 + RECOVER_BPS / 10000);

    if (held !== undefined) {
      const stopped = close <= entryClose * (1 - STOP_BPS / 10000);
      const timedOut = barNo - entryBar >= MAX_HOLD_BARS;
      if (recovered || stopped || timedOut) {
        lastExitBar = barNo;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
      }
      return [];
    }

    if (barNo - lastExitBar < COOLDOWN_BARS) return [];
    if (!dip) return [];
    const room = state.weightRoom(SYMBOL);
    let spend = state.cash < room ? state.cash : room;
    if (spend < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    entryClose = close;
    entryBar = barNo;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
  },
});
