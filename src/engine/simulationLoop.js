/**
 * Simulation Loop — orchestrates the market simulation.
 *
 * On each tick:
 * 1. Agents generate orders
 * 2. Orders are processed by matching engine
 * 3. Expired orders are removed
 * 4. Metrics are updated
 * 5. Display state is pushed to callback
 */

import { OrderBook, resetOrderIdCounter } from './orderBook.js';
import { MatchingEngine } from './matchingEngine.js';
import { MetricsEngine } from './metricsEngine.js';
import { PatternDetector } from './patternDetector.js';
import { RandomAgentSystem } from '../agents/randomAgentSystem.js';
import { MarketMakerSystem } from '../agents/marketMakerSystem.js';
import { SeededRng } from './seededRng.js';

function sampleOffset(rng, tickSize, meanTicks) {
  const lambda = 1 / Math.max(1, meanTicks);
  const offsetTicks = Math.max(1, Math.round(rng.exponential(lambda)));
  return offsetTicks * tickSize;
}

function sampleLifetime(rng, config) {
  const lifetime = Math.round(
    config.baseLifetime * Math.min(2.5, Math.max(0.45, rng.logNormal(0, 0.35)))
  );

  return Math.max(
    config.minLifetime,
    Math.min(config.maxLifetime, lifetime)
  );
}

export class SimulationLoop {
  constructor(config, onUpdate) {
    this.config = config;
    this.onUpdate = onUpdate;

    this.rng = new SeededRng(config.seed);
    this.marketMakerRng = new SeededRng(config.seed + 1009);
    this.orderBook = new OrderBook(config.tickSize);
    this.matchingEngine = new MatchingEngine(this.orderBook, config);
    this.metricsEngine = new MetricsEngine(config);
    this.patternDetector = new PatternDetector(config);
    this.agentSystem = new RandomAgentSystem(this.rng, config);
    this.marketMakerSystem = new MarketMakerSystem(this.marketMakerRng, config);

    this.tick = 0;
    this.lastPrice = config.initialPrice;
    this.isRunning = false;
    this.isPaused = false;
    this.intervalId = null;
    this.speed = 1;
    this.frameIntervalMs = 16;
    this.maxTicksPerFrame = 250;
    this._tickAccumulator = 0;
    this._lastFrameAt = 0;

    // History for replay
    this.history = [];
    this.maxHistoryLength = 50000;

    // Seed the order book with initial liquidity
    this._seedInitialLiquidity();
  }

  /** Place initial limit orders to bootstrap the book */
  _seedInitialLiquidity() {
    const mid = this.config.initialPrice;
    const tickSize = this.config.tickSize;
    const rng = this.rng;
    const meanOffsetTicks = 3 + this.config.priceOffsetRange * 8;

    // Place dense liquidity close to the mid so price discovery is smooth.
    for (let i = 0; i < 300; i++) {
      const isBuy = rng.bool(0.5);
      const offset = sampleOffset(rng, tickSize, meanOffsetTicks);
      const price = this.orderBook.roundPrice(
        isBuy ? mid - offset : mid + offset
      );
      if (price <= 0) continue;

      const size = Math.max(
        this.config.minOrderSize,
        Math.round(
          this.config.baseOrderSize * Math.min(3.5, Math.max(0.6, rng.logNormal(0.1, 0.45)))
        )
      );
      const lifetime = sampleLifetime(rng, this.config);

      const order = {
        id: `SEED-${i}`,
        side: isBuy ? 'buy' : 'sell',
        type: 'limit',
        price,
        size,
        remainingSize: size,
        agentId: `seed-agent`,
        createdAt: 0,
        expiresAt: lifetime,
        status: 'open',
      };

      this.orderBook.addOrder(order);
    }
  }

  /** Start the simulation loop */
  start() {
    if (this.isRunning && !this.isPaused) return;

    this.isRunning = true;
    this.isPaused = false;
    this._scheduleLoop();
  }

  /** Pause */
  pause() {
    this.isPaused = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Resume from pause */
  resume() {
    if (!this.isRunning) return;
    this.isPaused = false;
    this._scheduleLoop();
  }

  /** Single step */
  step() {
    if (this.isRunning && !this.isPaused) this.pause();
    this.isRunning = true;
    this.isPaused = true;
    this._processTick();
    this._pushUpdate();
  }

  /** Reset everything */
  reset() {
    this.pause();
    this.isRunning = false;
    this.tick = 0;
    this.lastPrice = this.config.initialPrice;
    resetOrderIdCounter();
    this.rng = new SeededRng(this.config.seed);
    this.marketMakerRng = new SeededRng(this.config.seed + 1009);
    this.orderBook = new OrderBook(this.config.tickSize);
    this.matchingEngine = new MatchingEngine(this.orderBook, this.config);
    this.metricsEngine = new MetricsEngine(this.config);
    this.patternDetector = new PatternDetector(this.config);
    this.agentSystem = new RandomAgentSystem(this.rng, this.config);
    this.marketMakerSystem = new MarketMakerSystem(this.marketMakerRng, this.config);
    this.history = [];
    this._seedInitialLiquidity();
    this._pushUpdate();
  }

  /** Set simulation speed (1x, 2x, 5x, 10x) */
  setSpeed(speed) {
    this.speed = speed;
    if (this.isRunning && !this.isPaused) {
      clearInterval(this.intervalId);
      this._scheduleLoop();
    }
  }

  /** Update config */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.agentSystem.updateConfig(this.config);
    this.marketMakerSystem.updateConfig(newConfig, this.orderBook, this.tick);
    this.matchingEngine.updateConfig(this.config);
    this.metricsEngine.updateConfig(this.config);

    if (this.isRunning && !this.isPaused && newConfig.tickInterval != null) {
      this._scheduleLoop();
    }

    if (
      newConfig.enableMarketMakers != null
      || newConfig.numberOfMarketMakers != null
      || newConfig.baseSpreadTicks != null
      || newConfig.quoteRefreshInterval != null
      || newConfig.staleQuoteLifetime != null
      || newConfig.makerCancellationDelay != null
      || newConfig.makerReactionDelay != null
      || newConfig.maxInventory != null
      || newConfig.inventorySkewStrength != null
      || newConfig.probabilityOfJoiningBestBidAsk != null
      || newConfig.probabilityOfQuotingOneTickAway != null
      || newConfig.quoteSizeRange != null
    ) {
      this._pushUpdate();
    }
  }

  /** Schedule the interval loop */
  _scheduleLoop() {
    if (this.intervalId) clearInterval(this.intervalId);

    const baseInterval = Math.max(5, this.config.tickInterval || 25);
    const targetTicksPerSecond = Math.max(1, (1000 / baseInterval) * this.speed);
    this._tickAccumulator = 0;
    this._lastFrameAt = this._now();

    this.intervalId = setInterval(() => {
      const now = this._now();
      const elapsedMs = Math.max(0, now - this._lastFrameAt);
      this._lastFrameAt = now;
      this._tickAccumulator += (elapsedMs / 1000) * targetTicksPerSecond;

      const ticksToProcess = Math.min(
        this.maxTicksPerFrame,
        Math.floor(this._tickAccumulator)
      );

      if (ticksToProcess <= 0) return;

      this._tickAccumulator -= ticksToProcess;
      for (let i = 0; i < ticksToProcess; i++) {
        this._processTick();
      }
      this._pushUpdate();
    }, this.frameIntervalMs);
  }

  _now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }

    return Date.now();
  }

  /** Process a single tick */
  _processTick() {
    this.tick++;

    // 1. Remove expired orders
    this.orderBook.removeExpired(this.tick);

    // 2. Agents generate orders
    const midPrice = this.orderBook.midPrice || this.lastPrice;
    const makerOrders = this.marketMakerSystem.tick(
      this.tick,
      this._getExecutionContext(),
      this.orderBook
    );
    const agentOrders = this.agentSystem.tick(this.tick, midPrice, this.orderBook);

    // 3. Process each order through matching engine
    const allTrades = [];
    for (const order of [...makerOrders, ...agentOrders]) {
      const { trades } = this.matchingEngine.processOrder(
        order,
        this.tick,
        this._getExecutionContext()
      );
      allTrades.push(...trades);
    }

    // 4. Update last price from trades
    if (allTrades.length > 0) {
      this.lastPrice = allTrades[allTrades.length - 1].price;
    }

    // 5. Update metrics
    this.metricsEngine.processTick(this.tick, allTrades, this.orderBook, this.lastPrice);
    this.marketMakerSystem.handleFills(allTrades, this.tick);

    // 6. Detect patterns periodically
    if (this.tick % 50 === 0) {
      this.patternDetector.analyze(
        this.metricsEngine.candles,
        this.metricsEngine.allTrades,
        this.orderBook
      );
    }

    // 7. Record history snapshot (periodic)
    if (this.tick % 10 === 0 && this.history.length < this.maxHistoryLength) {
      this.history.push({
        tick: this.tick,
        lastPrice: this.lastPrice,
        bestBid: this.orderBook.bestBid,
        bestAsk: this.orderBook.bestAsk,
        spread: this.orderBook.spread,
        totalOrders: this.orderBook.totalOrders,
        tradeCount: allTrades.length,
      });
    }
  }

  /** Push display state to UI */
  _pushUpdate() {
    if (!this.onUpdate) return;

    const depth = this.orderBook.getDepth(25);
    const cumulativeDepth = this.orderBook.getCumulativeDepth(50);

    this.onUpdate({
      tick: this.tick,
      lastPrice: this.lastPrice,
      bestBid: this.orderBook.bestBid,
      bestAsk: this.orderBook.bestAsk,
      spread: this.orderBook.spread,
      midPrice: this.orderBook.midPrice || this.lastPrice,
      bidLevels: depth.bidLevels,
      askLevels: depth.askLevels,
      cumulativeDepth,
      candles: this.metricsEngine.candles,
      currentCandle: this.metricsEngine.currentCandle,
      recentTrades: this.metricsEngine.recentTrades,
      volume: this.metricsEngine.totalVolume,
      volatility: this.metricsEngine.volatility,
      orderFlowImbalance: this.metricsEngine.orderFlowImbalance,
      totalOrders: this.orderBook.totalOrders,
      totalBidVolume: this.orderBook.totalBidVolume,
      totalAskVolume: this.orderBook.totalAskVolume,
      makerStats: this.marketMakerSystem.getMetrics(this.orderBook, this.lastPrice),
      patterns: this.patternDetector.getPatterns(),
      history: this.history,
      userOrders: this._getUserOrdersSnapshot(),
      isRunning: this.isRunning,
      isPaused: this.isPaused,
    });
  }

  /** Process a user-submitted order */
  processUserOrder(order) {
    const result = this.matchingEngine.processOrder(
      order,
      this.tick,
      this._getExecutionContext()
    );
    const { trades } = result;
    if (trades.length > 0) {
      this.lastPrice = trades[trades.length - 1].price;
      this.metricsEngine.processTrades(this.tick, trades);
      this.marketMakerSystem.handleFills(trades, this.tick);
    }
    this._pushUpdate();
    return result;
  }

  /** Cancel a user order */
  cancelUserOrder(orderId) {
    const cancelled = this.orderBook.cancelOrder(orderId);
    this._pushUpdate();
    return cancelled;
  }

  /** Clean up */
  destroy() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.isRunning = false;
  }

  _getExecutionContext() {
    const recentTrades = this.metricsEngine.recentTrades;
    const lookbackWindow = recentTrades.slice(-8);
    const firstPrice = lookbackWindow[0]?.price ?? this.lastPrice;
    const lastPrice = lookbackWindow[lookbackWindow.length - 1]?.price ?? this.lastPrice;

    return {
      lastPrice: this.lastPrice,
      midPrice: this.orderBook.midPrice || this.lastPrice,
      spread: this.orderBook.spread,
      volatility: this.metricsEngine.volatility,
      priceVelocity: Math.abs(lastPrice - firstPrice),
    };
  }

  _getUserOrdersSnapshot() {
    return this.orderBook
      .getAgentOrderIds('user')
      .map((orderId) => this.orderBook.getOrder(orderId))
      .filter(Boolean)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((order) => ({ ...order }));
  }
}
