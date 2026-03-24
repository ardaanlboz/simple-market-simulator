/**
 * Pattern Detector — finds support/resistance levels, breakouts,
 * volume spikes, and liquidity concentrations from order book + trade data.
 *
 * All detection is purely from simulated data — no external inputs.
 */

export class PatternDetector {
  constructor(config) {
    this.config = config;
    this.supportLevels = [];
    this.resistanceLevels = [];
    this.volumeSpikes = [];
    this.breakouts = [];
    this.localHighs = [];
    this.localLows = [];
    this.liquidityZones = [];
    this.bounceMarkers = [];
  }

  /**
   * Analyze candles, trades, and order book for patterns.
   * Called periodically (e.g., every 50 ticks).
   */
  analyze(candles, trades, orderBook) {
    if (candles.length < 5) return;

    this._detectLocalExtremes(candles);
    this._detectSupportResistance(candles);
    this._detectVolumeSpikes(candles);
    this._detectBreakouts(candles);
    this._detectLiquidityZones(orderBook);
    this._detectBounces(candles);
  }

  /** Find local highs and lows (swing points) */
  _detectLocalExtremes(candles) {
    this.localHighs = [];
    this.localLows = [];

    const lookback = 5;
    for (let i = lookback; i < candles.length - lookback; i++) {
      const c = candles[i];

      // Check if local high
      let isHigh = true;
      let isLow = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j].high >= c.high) isHigh = false;
        if (candles[j].low <= c.low) isLow = false;
      }

      if (isHigh) {
        this.localHighs.push({ time: c.time, price: c.high });
      }
      if (isLow) {
        this.localLows.push({ time: c.time, price: c.low });
      }
    }

    // Keep recent only
    this.localHighs = this.localHighs.slice(-30);
    this.localLows = this.localLows.slice(-30);
  }

  /** Detect support and resistance from price clusters */
  _detectSupportResistance(candles) {
    if (candles.length < 20) return;

    const tickSize = this.config.tickSize;
    const bucketSize = tickSize * 50; // Group prices into bands
    const recent = candles.slice(-200);

    // Build price histogram from lows (support) and highs (resistance)
    const lowBuckets = new Map();
    const highBuckets = new Map();

    for (const c of recent) {
      const lowKey = Math.round(c.low / bucketSize) * bucketSize;
      const highKey = Math.round(c.high / bucketSize) * bucketSize;
      lowBuckets.set(lowKey, (lowBuckets.get(lowKey) || 0) + 1);
      highBuckets.set(highKey, (highBuckets.get(highKey) || 0) + 1);
    }

    // Support: price levels where many candle lows cluster
    this.supportLevels = [...lowBuckets.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([price, strength]) => ({ price, strength }));

    // Resistance: price levels where many candle highs cluster
    this.resistanceLevels = [...highBuckets.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([price, strength]) => ({ price, strength }));
  }

  /** Detect volume spikes */
  _detectVolumeSpikes(candles) {
    this.volumeSpikes = [];
    if (candles.length < 20) return;

    const recent = candles.slice(-100);
    const avgVolume = recent.reduce((s, c) => s + c.volume, 0) / recent.length;

    for (let i = Math.max(0, recent.length - 50); i < recent.length; i++) {
      if (recent[i].volume > avgVolume * 2.5) {
        this.volumeSpikes.push({
          time: recent[i].time,
          volume: recent[i].volume,
          ratio: recent[i].volume / avgVolume,
        });
      }
    }
  }

  /** Detect breakouts — price moving through support/resistance with volume */
  _detectBreakouts(candles) {
    this.breakouts = [];
    if (candles.length < 10 || this.supportLevels.length === 0 && this.resistanceLevels.length === 0) return;

    const recent = candles.slice(-20);
    const latest = recent[recent.length - 1];
    if (!latest) return;

    // Check resistance breakout
    for (const r of this.resistanceLevels) {
      if (latest.close > r.price && latest.open < r.price && latest.volume > 0) {
        this.breakouts.push({
          time: latest.time,
          price: r.price,
          direction: 'up',
          strength: r.strength,
        });
      }
    }

    // Check support breakdown
    for (const s of this.supportLevels) {
      if (latest.close < s.price && latest.open > s.price && latest.volume > 0) {
        this.breakouts.push({
          time: latest.time,
          price: s.price,
          direction: 'down',
          strength: s.strength,
        });
      }
    }
  }

  /** Detect liquidity concentration zones from order book */
  _detectLiquidityZones(orderBook) {
    this.liquidityZones = [];
    const depth = orderBook.getDepth(50);

    // Find bid levels with high concentration
    const allLevels = [
      ...depth.bidLevels.map(l => ({ ...l, side: 'bid' })),
      ...depth.askLevels.map(l => ({ ...l, side: 'ask' })),
    ];

    if (allLevels.length === 0) return;

    const avgSize = allLevels.reduce((s, l) => s + l.size, 0) / allLevels.length;

    for (const level of allLevels) {
      if (level.size > avgSize * 2) {
        this.liquidityZones.push({
          price: level.price,
          size: level.size,
          side: level.side,
          strength: level.size / avgSize,
        });
      }
    }
  }

  /** Detect bounce markers — price repeatedly touching a level and reversing */
  _detectBounces(candles) {
    this.bounceMarkers = [];
    if (candles.length < 30) return;

    const tickSize = this.config.tickSize;
    const tolerance = tickSize * 30;

    // Check recent candles against support/resistance
    const recent = candles.slice(-30);

    for (const support of this.supportLevels) {
      let bounces = 0;
      for (const c of recent) {
        if (Math.abs(c.low - support.price) < tolerance && c.close > c.open) {
          bounces++;
        }
      }
      if (bounces >= 2) {
        this.bounceMarkers.push({
          price: support.price,
          count: bounces,
          type: 'support_bounce',
        });
      }
    }

    for (const resistance of this.resistanceLevels) {
      let bounces = 0;
      for (const c of recent) {
        if (Math.abs(c.high - resistance.price) < tolerance && c.close < c.open) {
          bounces++;
        }
      }
      if (bounces >= 2) {
        this.bounceMarkers.push({
          price: resistance.price,
          count: bounces,
          type: 'resistance_bounce',
        });
      }
    }
  }

  /** Get all patterns for display */
  getPatterns() {
    return {
      supportLevels: this.supportLevels,
      resistanceLevels: this.resistanceLevels,
      volumeSpikes: this.volumeSpikes,
      breakouts: this.breakouts,
      localHighs: this.localHighs,
      localLows: this.localLows,
      liquidityZones: this.liquidityZones,
      bounceMarkers: this.bounceMarkers,
    };
  }

  reset() {
    this.supportLevels = [];
    this.resistanceLevels = [];
    this.volumeSpikes = [];
    this.breakouts = [];
    this.localHighs = [];
    this.localLows = [];
    this.liquidityZones = [];
    this.bounceMarkers = [];
  }
}
