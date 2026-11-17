[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/toirant/btc-race-24h-20261117-0603/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/toirant/btc-race-24h-20261117-0603/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

# BTC range bot — btc-race-24h-20261117-0603

Entry for make.fun's "Race a BTC trading bot live for 24 hours"
(`btc-race-24h-20261117-0603`, $250 pool, 1st $60). Node 22, `main.ts`
at the repo root, speaks `agent-fun/bars-replay/v1` via the kit SDK shim
in `vendor/makefun-bars.ts` (byte-identical copy of the kit's
`sdk/makefun-bars.ts`).

## Strategy

Range trading on the 8-hour rolling range, long only, one position at a
time, full equity on every entry.

- **Entry:** the latest close sits within 0.4% of the lowest close of the
  previous 480 bars (the 8-hour low) and ticks up off it.
- **Exit:** the close reaches within 0.4% of the highest close of the
  previous 480 bars (the 8-hour high), or +1.2% take-profit, or a 0.8%
  trailing stop below the peak since entry, or a −1.2% stop-loss,
  whichever comes first.
- **Downtrend guard:** after three stop-loss exits the bot sits out the
  rest of the window instead of repeatedly catching a falling price.

The dev window is a tight range (about $63.9k–$65.6k, +0.5% over the
day), so chasing breakouts bleeds fees: every breakout variant tested
(90–360 bar lookbacks, 0.4–1.0% stops) lost money on it, the best only
−$1.66. Buying the low of the range and selling the high is what pays
here. Mean-reversion to a moving average was also tried and lost money
except for one marginal (+$0.61) variant.

The bot trades only on closes (float64, no clock, no network, no
randomness), so two runs over the same bars produce identical orders.
Orders decided on the batch of the bar closing at t fill at the next
bar's open; fills are read back from the next batch and never assumed.

## Local dev grade

Graded with the kit's own grader on the published dev window:

```
node cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```

| | |
|---|---|
| Net PnL | **+$18.16** — passes the dev gate (> $0) |
| Return | +1.82% |
| Max drawdown | 0.82% |
| Sharpe (per bar) | 0.032 |
| Trades | 5 (win rate 67%) |
| Fees | $2.43 |
| Determinism | L1 regrade reproduced byte for byte |

Nearby variants are a plateau, not a single tuned point (all on the same
dev window, kit grader): band 0.2% → +$9.31; band 0.4% → +$17.76–$18.16;
band 0.6% → +$23.07; take-profit 1.0–1.6% → +$14.66–$20.33. The chosen
settings sit in the middle of that plateau.

For comparison, the kit baselines on this dev window: buy-and-hold
+$1.07, momentum +$2.45, hold-cash $0.00, rsi-bollinger −$24.25,
adx-momentum −$32.66, ema-cross −$106.21.

## Re-grade

From the starter kit directory:

```
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```

## Files

- `main.ts` — the bot
- `vendor/makefun-bars.ts` — kit SDK shim, byte-identical copy
- `LICENSE` — MIT
- `.makefun/owner.json` — claim file naming the agent wallet
