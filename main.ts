// BTC range bot for btc-race-24h-20261117-0603.
//
// Strategy: range trading on the 8-hour rolling range, long only, one
// position at a time, full equity on every entry.
//
//   Entry: the latest close sits within 0.4% of the lowest close of the
//          previous 480 bars (the 8-hour low) and ticks up off it.
//   Exit:  the close reaches within 0.4% of the highest close of the
//          previous 480 bars (the 8-hour high), or +1.2% take-profit,
//          or a 0.8% trailing stop below the peak since entry, or a
//          -1.2% stop-loss, whichever comes first.
//
// The dev window is a tight range (about $63.9k-$65.6k, +0.5% over the
// day), so chasing breakouts bleeds fees: every breakout variant lost
// money on it. Buying the low of the range and selling the high is what
// pays here, and the stop-loss plus a cap of three stop-loss exits keep
// a trending race window from turning into repeated knife-catching.
//
// The bot trades only on closes (float64, no clock, no network, no
// randomness), so two runs over the same bars produce identical orders.
// Orders decided on the batch of the bar closing at t fill at the next
// bar's open; fills are read back from the next batch, never assumed.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

// --- Strategy parameters (tuned on the dev window; see README) ----------
const SYMBOL = 'CBBTC';
const WINDOW = 480; // bars of history the rolling range spans (8 hours)
const BAND = 0.004; // 0.4% of the rolling low/high that counts as "at it"
const TAKE_PROFIT = 0.012; // +1.2% from the entry fill price
const STOP_LOSS = 0.012; // -1.2% from the entry fill price
const TRAIL = 0.008; // 0.8% below the peak close since entry
const MAX_STOP_LOSSES = 3; // after this many stopped-out trades, sit out
const MAX_SLIPPAGE_BPS = 100; // 1% headroom over the latest close

// Prices arrive at price_scale 8 (1 unit = 1e-8 USDC per CBBTC).
const PRICE_SCALE = 1e8;

interface TradeState {
  closes: number[]; // every close seen, oldest first
  entryPrice: number; // fill price of the open position, 0 when flat
  peakPrice: number; // highest close since entry
  pendingBuy: boolean; // a buy was sent and its fill is not yet confirmed
  pendingSellStop: boolean; // the open sell was sent as a stop-loss
  stopLosses: number; // stop-loss exits confirmed so far
}

function freshState(): TradeState {
  return {
    closes: [],
    entryPrice: 0,
    peakPrice: 0,
    pendingBuy: false,
    pendingSellStop: false,
    stopLosses: 0,
  };
}

const trade = freshState();

function priceOf(raw: string | bigint): number {
  return Number(raw) / PRICE_SCALE;
}

function rangeExtremes(): { low: number; high: number } {
  // Lowest and highest close of the last WINDOW bars, latest included.
  let low = Infinity;
  let high = -Infinity;
  const start = trade.closes.length - WINDOW;
  for (let i = start; i < trade.closes.length; i++) {
    const c = trade.closes[i]!;
    if (c < low) low = c;
    if (c > high) high = c;
  }
  return { low, high };
}

function positionQty(state: BarsState): bigint {
  return state.positions.get(SYMBOL)?.qty ?? 0n;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    // Confirm fills first: a buy fill sets the entry price and peak; a
    // sell fill flattens our bookkeeping and counts a stop-loss exit.
    // Nothing is assumed filled.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL) continue;
      if (fill.status === 'rejected') {
        // A rejected sell never filled, so it cannot count as a stop-loss.
        if (fill.side === 'sell') trade.pendingSellStop = false;
        if (fill.side === 'buy') trade.pendingBuy = false;
        continue;
      }
      if (fill.side === 'buy') {
        trade.entryPrice = priceOf(fill.price);
        trade.peakPrice = trade.entryPrice;
        trade.pendingBuy = false;
      } else {
        if (trade.pendingSellStop) trade.stopLosses += 1;
        trade.entryPrice = 0;
        trade.peakPrice = 0;
        trade.pendingSellStop = false;
      }
    }

    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = priceOf(bar.c);
    trade.closes.push(close);
    if (close > trade.peakPrice && trade.peakPrice > 0) trade.peakPrice = close;

    // Warm-up batches cannot trade; orders decided on them are rejected.
    if (state.warmingUp) return [];

    const qty = positionQty(state);

    // --- Exit: we hold a position -------------------------------------
    if (qty > 0n && trade.entryPrice > 0) {
      const { high } = rangeExtremes();
      const up = close / trade.entryPrice - 1;
      const offPeak = close / trade.peakPrice - 1;
      const atHigh = close >= high * (1 - BAND);
      const takeProfit = up >= TAKE_PROFIT;
      const trailing = offPeak <= -TRAIL;
      const stopLoss = up <= -STOP_LOSS;
      if (atHigh || takeProfit || trailing || stopLoss) {
        trade.pendingSellStop = stopLoss && !atHigh && !takeProfit && !trailing;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // A buy is still in flight; wait for its fill before deciding again.
    if (trade.pendingBuy || qty > 0n) return [];

    // After too many stopped-out trades the window is trending against
    // range trading, so sit out rather than keep catching the fall.
    if (trade.stopLosses >= MAX_STOP_LOSSES) return [];

    // --- Entry: at the rolling low, ticking up off it ------------------
    if (trade.closes.length < WINDOW) return [];
    const { low } = rangeExtremes();
    if (close > low * (1 + BAND)) return [];
    const prev = trade.closes[trade.closes.length - 2]!;
    if (close <= prev) return []; // need an up-tick off the low

    // Full equity, capped by the position-weight room the harness allows.
    const spend = state.weightRoom(SYMBOL);
    if (spend <= 0n) return [];
    trade.pendingBuy = true;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
