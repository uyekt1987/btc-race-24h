# BTC Race Bot — Mean Reversion on cbBTC

[![make.fun](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![Rank](https://make.fun/badge/btc-race-24h-20261117-0603/uyekt1987/btc-race-24h/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![Reward](https://make.fun/badge/btc-race-24h-20261117-0603/uyekt1987/btc-race-24h/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)

Entry for make.fun `btc-race-24h-20261117-0603`: a bot that trades Coinbase
Wrapped BTC (CBBTC) against USDC on 1-minute bars, starting with $1,000 of
paper money, long only.

## Strategy

Mean reversion, not trend following. The dev window is choppy and nearly flat
(+49 bps over 24 h, mean |1-minute| move ~4.3 bps) while a full-size round
trip costs ~37 bps (4 bps fee + 2 bps slippage + ~13 bps pool impact per
side). Fast EMA crossovers whipsaw and pay the round trip dozens of times;
buying a clear dip below the slow mean and selling on the recovery catches
swings of 80–120 bps gross, which survive the cost.

- **Mean:** SMA(240) of 1-minute closes (~4 h).
- **Entry (flat):** close ≤ SMA × (1 − 80 bps). Buy with all cash.
- **Exit (long), first of:**
  - recovery: close ≥ SMA × (1 + 30 bps);
  - stop-loss: close ≤ entry close × (1 − 150 bps);
  - time-stop: held 480 bars (~8 h) without recovering.
- **Cooldown:** no new entry within 10 bars of an exit.
- **Slippage cap:** 100 bps per order; signals are level-based, so a refused
  order is retried on the next bar while the condition still holds.
- **Size:** 100% of cash on entry, whole position on exit. At most one order
  per reply.

Deterministic: pure arithmetic on the closes seen so far — no clock, no
environment, no randomness.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit SDK shim.
- `LICENSE` — MIT.

## Local backtest (dev window)

The backtest runner lives outside this repo, in
`~/workspace/makefun/btc-race-tools/backtest.mjs`. It replays the dev bars
through the bot over stdin/stdout with the grader's exact fill math
(fee 4 bps, slippage 2 bps, constant-product impact against each bar's open
depth) and reports net PnL, trades and max drawdown.

Dev-window result: **net PnL +$10.28, 4 trades, max drawdown $7.30**
(vs buy-and-hold +$1.07, 1 trade; EMA(8/21) baseline ≈ −$106).
