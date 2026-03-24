/**
 * Metrics Engine — computes OHLCV candles, volume, spread, volatility,
 * and order flow metrics from trade data.
 */

export class MetricsEngine {
  constructor(config) {
    this.config = config;
    this.ticksPerCandle = config.ticksPerCandle || 100;

    // Candle data
    this.candles = [];
    this.currentCandle = null;
    this.maxCandles = 2000;

    // Trade tracking
    this.allTrades = [];
    this.recentTrades = [];
    this.maxRecentTrades = 200;
    this.maxAllTrades = 50000;

    // Running metrics
    this.totalVolume = 0;
    this.volatility = 0;
    this.orderFlowImbalance = 0;

    // For volatility calc
    this._recentPrices = [];
    this._maxPricesForVol = 100;

    // Volume tracking per candle
    this._buyVolume = 0;
    this._sellVolume = 0;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.ticksPerCandle = newConfig.ticksPerCandle || this.ticksPerCandle;
  }

  /** Process all trades from a tick */
  processTick(tick, trades, orderBook, lastPrice) {
    if (trades.length > 0) {
      this.processTrades(tick, trades);
    }

    // Update or create candle
    this._updateCandle(tick, lastPrice, trades);

    // Compute order flow imbalance from book
    const bidVol = orderBook.totalBidVolume;
    const askVol = orderBook.totalAskVolume;
    const total = bidVol + askVol;
    this.orderFlowImbalance = total > 0 ? (bidVol - askVol) / total : 0;
  }

  /** Process trades from matching */
  processTrades(tick, trades) {
    for (const trade of trades) {
      this.allTrades.push(trade);
      this.recentTrades.push(trade);
      this.totalVolume += trade.size;

      // Track buy/sell volume
      if (trade.aggressor === 'buy') {
        this._buyVolume += trade.size;
      } else {
        this._sellVolume += trade.size;
      }

      // Track prices for volatility
      this._recentPrices.push(trade.price);
      if (this._recentPrices.length > this._maxPricesForVol) {
        this._recentPrices.shift();
      }
    }

    // Trim
    if (this.recentTrades.length > this.maxRecentTrades) {
      this.recentTrades = this.recentTrades.slice(-this.maxRecentTrades);
    }
    if (this.allTrades.length > this.maxAllTrades) {
      this.allTrades = this.allTrades.slice(-this.maxAllTrades);
    }

    // Compute volatility (standard deviation of recent log returns)
    this._computeVolatility();
  }

  /** Update OHLCV candle */
  _updateCandle(tick, lastPrice, trades) {
    const candleIndex = Math.floor(tick / this.ticksPerCandle);

    if (!this.currentCandle || this.currentCandle.index !== candleIndex) {
      // Close previous candle
      if (this.currentCandle) {
        this.currentCandle.closed = true;
        this.candles.push({ ...this.currentCandle });
        if (this.candles.length > this.maxCandles) {
          this.candles.shift();
        }
      }

      // Open new candle
      this.currentCandle = {
        index: candleIndex,
        time: candleIndex,
        open: lastPrice,
        high: lastPrice,
        low: lastPrice,
        close: lastPrice,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        tradeCount: 0,
        closed: false,
      };
      this._buyVolume = 0;
      this._sellVolume = 0;
    }

    // Update current candle with trades
    for (const trade of trades) {
      const c = this.currentCandle;
      if (trade.price > c.high) c.high = trade.price;
      if (trade.price < c.low) c.low = trade.price;
      c.close = trade.price;
      c.volume += trade.size;
      c.tradeCount++;
      if (trade.aggressor === 'buy') {
        c.buyVolume += trade.size;
      } else {
        c.sellVolume += trade.size;
      }
    }

    if (trades.length === 0 && this.currentCandle) {
      this.currentCandle.close = lastPrice;
    }
  }

  /** Compute volatility from recent log returns */
  _computeVolatility() {
    if (this._recentPrices.length < 10) {
      this.volatility = 0;
      return;
    }

    const returns = [];
    for (let i = 1; i < this._recentPrices.length; i++) {
      const prev = this._recentPrices[i - 1];
      const curr = this._recentPrices[i];
      if (prev > 0 && curr > 0) {
        returns.push(Math.log(curr / prev));
      }
    }

    if (returns.length < 5) {
      this.volatility = 0;
      return;
    }

    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    this.volatility = Math.sqrt(variance);
  }

  /** Get the last N candles including current */
  getCandles(n = 200) {
    const result = this.candles.slice(-n);
    if (this.currentCandle) {
      result.push({ ...this.currentCandle });
    }
    return result;
  }

  /** Reset all metrics */
  reset() {
    this.candles = [];
    this.currentCandle = null;
    this.allTrades = [];
    this.recentTrades = [];
    this.totalVolume = 0;
    this.volatility = 0;
    this.orderFlowImbalance = 0;
    this._recentPrices = [];
    this._buyVolume = 0;
    this._sellVolume = 0;
  }
}
