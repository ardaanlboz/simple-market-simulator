/**
 * Simulation Loop — orchestrates the market simulation.
 *
 * On each tick (latency disabled):
 * 1. Expired orders are removed
 * 2. Agents generate orders
 * 3. Orders are processed by the matching engine
 * 4. Metrics are updated
 * 5. Display state is pushed to callback
 *
 * On each tick (latency enabled):
 * 1. Expired orders are removed
 * 2. Due events fire from the event queue (cancels first, then submissions)
 * 3. Agents observe the market and generate decisions
 * 4. Decisions are scheduled into the event queue with sampled delays
 * 5. Any delay-0 events fire immediately
 * 6. Metrics are updated
 * 7. Display state is pushed to callback
 */

import { OrderBook, resetOrderIdCounter } from './orderBook.js';
import { MatchingEngine } from './matchingEngine.js';
import { MetricsEngine } from './metricsEngine.js';
import { PatternDetector } from './patternDetector.js';
import { RandomAgentSystem } from '../agents/randomAgentSystem.js';
import { MarketMakerSystem } from '../agents/marketMakerSystem.js';
import { SeededRng } from './seededRng.js';
import { EventQueue, EVENT_TYPES, sampleLatency } from './eventQueue.js';

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
    this.latencyRng = new SeededRng(config.seed + 2017);
    this.orderBook = new OrderBook(config.tickSize);
    this.matchingEngine = new MatchingEngine(this.orderBook, config);
    this.metricsEngine = new MetricsEngine(config);
    this.patternDetector = new PatternDetector(config);
    this.agentSystem = new RandomAgentSystem(this.rng, config);
    this.marketMakerSystem = new MarketMakerSystem(this.marketMakerRng, config);
    this.eventQueue = new EventQueue();

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
    this._pendingUserFills = [];

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
    this.latencyRng = new SeededRng(this.config.seed + 2017);
    this.orderBook = new OrderBook(this.config.tickSize);
    this.matchingEngine = new MatchingEngine(this.orderBook, this.config);
    this.metricsEngine = new MetricsEngine(this.config);
    this.patternDetector = new PatternDetector(this.config);
    this.agentSystem = new RandomAgentSystem(this.rng, this.config);
    this.marketMakerSystem = new MarketMakerSystem(this.marketMakerRng, this.config);
    this.eventQueue.reset();
    this._pendingUserFills = [];
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
    const wasLatencyEnabled = !!this.config.enableLatency;
    this.config = { ...this.config, ...newConfig };
    this.agentSystem.updateConfig(this.config);
    this.marketMakerSystem.updateConfig(newConfig, this.orderBook, this.tick);
    this.matchingEngine.updateConfig(this.config);
    this.metricsEngine.updateConfig(this.config);

    if (this.isRunning && !this.isPaused && newConfig.tickInterval != null) {
      this._scheduleLoop();
    }

    // If latency was just disabled, flush all pending events immediately
    if (wasLatencyEnabled && newConfig.enableLatency === false) {
      this._flushEventQueue();
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
      || newConfig.enableLatency != null
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

  // ---------------------------------------------------------------------------
  //  Core tick processing
  // ---------------------------------------------------------------------------

  /** Process a single tick */
  _processTick() {
    this.tick++;
    this._pendingUserFills = [];

    // 1. Remove expired orders
    this.orderBook.removeExpired(this.tick);

    if (this.config.enableLatency) {
      this._processTickWithLatency();
    } else {
      this._processTickDirect();
    }
  }

  /** Original direct-execution path (latency disabled) */
  _processTickDirect() {
    const midPrice = this.orderBook.midPrice || this.lastPrice;
    const makerOrders = this.marketMakerSystem.tick(
      this.tick,
      this._getExecutionContext(),
      this.orderBook
    );
    const agentResult = this.agentSystem.tick(this.tick, midPrice, this.orderBook);
    const agentOrders = agentResult.orders ?? agentResult;
    const agentCancels = agentResult.cancels ?? [];

    // Execute agent cancels directly
    for (const cancel of agentCancels) {
      this.orderBook.cancelOrder(cancel.orderId);
    }

    // Process each order through matching engine
    const allTrades = [];
    for (const order of [...makerOrders, ...agentOrders]) {
      const { trades } = this.matchingEngine.processOrder(
        order,
        this.tick,
        this._getExecutionContext()
      );
      allTrades.push(...trades);
    }

    this._collectUserFills(allTrades);
    this._finalizeTick(allTrades);
  }

  /** Latency-aware path: events fire from the queue, new decisions are scheduled */
  _processTickWithLatency() {
    const allTrades = [];

    // --- Phase 1: fire due events from the queue ---
    const dueEvents = this.eventQueue.processDueEvents(this.tick);
    for (const event of dueEvents) {
      if (event.type === EVENT_TYPES.CANCEL_ORDER) {
        this._executeCancelEvent(event);
      } else if (event.type === EVENT_TYPES.SUBMIT_ORDER) {
        allTrades.push(...this._executeSubmitEvent(event));
      }
    }

    if (allTrades.length > 0) {
      this.lastPrice = allTrades[allTrades.length - 1].price;
    }

    // --- Phase 2: agents observe the (now-updated) market and decide ---
    const snapshot = this._captureMarketSnapshot();
    const midPrice = this.orderBook.midPrice || this.lastPrice;

    const makerOrders = this.marketMakerSystem.tick(
      this.tick,
      this._getExecutionContext(),
      this.orderBook
    );
    const agentResult = this.agentSystem.tick(this.tick, midPrice, this.orderBook);
    const agentOrders = agentResult.orders ?? agentResult;
    const agentCancels = agentResult.cancels ?? [];

    // --- Phase 3: schedule agent cancellations ---
    for (const cancel of agentCancels) {
      const delay = sampleLatency(
        this.config.cancellationDelayMin,
        this.config.cancellationDelayMax,
        this.latencyRng
      );
      this.eventQueue.schedule({
        type: EVENT_TYPES.CANCEL_ORDER,
        sourceId: cancel.agentId,
        payload: { orderId: cancel.orderId },
        createdAt: this.tick,
        scheduledFor: this.tick + delay,
        snapshot,
      });
    }

    // --- Phase 4: schedule agent order submissions ---
    for (const order of agentOrders) {
      const reactionDelay = sampleLatency(
        this.config.agentReactionDelayMin,
        this.config.agentReactionDelayMax,
        this.latencyRng
      );
      const submissionDelay = sampleLatency(
        this.config.orderSubmissionDelayMin,
        this.config.orderSubmissionDelayMax,
        this.latencyRng
      );
      this.eventQueue.schedule({
        type: EVENT_TYPES.SUBMIT_ORDER,
        sourceId: order.agentId,
        payload: { order },
        createdAt: this.tick,
        scheduledFor: this.tick + reactionDelay + submissionDelay,
        snapshot,
      });
    }

    // --- Phase 5: schedule market maker order submissions (shorter delay) ---
    for (const order of makerOrders) {
      const submissionDelay = sampleLatency(
        this.config.makerSubmissionDelayMin ?? 0,
        this.config.makerSubmissionDelayMax ?? 2,
        this.latencyRng
      );
      this.eventQueue.schedule({
        type: EVENT_TYPES.SUBMIT_ORDER,
        sourceId: order.agentId,
        payload: { order },
        createdAt: this.tick,
        scheduledFor: this.tick + submissionDelay,
        snapshot,
      });
    }

    // --- Phase 6: fire any delay-0 events that were just scheduled ---
    const immediateDue = this.eventQueue.processDueEvents(this.tick);
    for (const event of immediateDue) {
      if (event.type === EVENT_TYPES.CANCEL_ORDER) {
        this._executeCancelEvent(event);
      } else if (event.type === EVENT_TYPES.SUBMIT_ORDER) {
        allTrades.push(...this._executeSubmitEvent(event));
      }
    }

    this._collectUserFills(allTrades);
    this._finalizeTick(allTrades);
  }

  // ---------------------------------------------------------------------------
  //  Event execution
  // ---------------------------------------------------------------------------

  /** Execute a cancel event against the live book */
  _executeCancelEvent(event) {
    const { orderId } = event.payload;
    const order = this.orderBook.getOrder(orderId);
    if (order) {
      order.cancelRequestedAt = event.createdAt;
      order.cancelledAt = this.tick;
      this.orderBook.cancelOrder(orderId);
      event.result = 'cancelled';
    } else {
      // Order may already be filled or expired — or still pending submission
      const removed = this.eventQueue.removePendingSubmitForOrder(orderId);
      event.result = removed ? 'cancelled_pending' : 'already_gone';
    }
  }

  /** Execute an order submission event against the live book */
  _executeSubmitEvent(event) {
    const order = event.payload.order;
    order.submittedAt = event.createdAt;
    order.enteredBookAt = this.tick;

    const result = this.matchingEngine.processOrder(
      order,
      this.tick,
      this._getExecutionContext()
    );
    const { trades, summary } = result;

    // Capture user fills for the UI callback
    if (order.agentId === 'user' && trades.length > 0) {
      this._pendingUserFills.push({
        order,
        trades,
        summary,
        snapshot: event.snapshot,
      });
    }

    event.result = trades.length > 0 ? `filled_${trades.length}` : 'rested';
    return trades;
  }

  // ---------------------------------------------------------------------------
  //  Shared tick finalization
  // ---------------------------------------------------------------------------

  _finalizeTick(allTrades) {
    if (allTrades.length > 0) {
      this.lastPrice = allTrades[allTrades.length - 1].price;
    }

    this.metricsEngine.processTick(this.tick, allTrades, this.orderBook, this.lastPrice);
    this.marketMakerSystem.handleFills(allTrades, this.tick);

    if (this.tick % 50 === 0) {
      this.patternDetector.analyze(
        this.metricsEngine.candles,
        this.metricsEngine.allTrades,
        this.orderBook
      );
    }

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

  /**
   * Scan trade list for fills involving user resting orders.
   * These fills are not captured by _executeSubmitEvent (which only
   * captures fills from the user's OWN incoming order), so we detect
   * them here from the aggressor's trade list.
   */
  _collectUserFills(allTrades) {
    for (const trade of allTrades) {
      const isUserBuy = trade.buyAgentId === 'user';
      const isUserSell = trade.sellAgentId === 'user';
      if (!isUserBuy && !isUserSell) continue;

      // Avoid double-counting fills already captured in _executeSubmitEvent
      const alreadyCaptured = this._pendingUserFills.some((f) =>
        f.trades.some((t) => t.id === trade.id)
      );
      if (alreadyCaptured) continue;

      this._pendingUserFills.push({
        trades: [trade],
        side: isUserBuy ? 'buy' : 'sell',
        isRestingFill: true,
      });
    }
  }

  // ---------------------------------------------------------------------------
  //  Market snapshot
  // ---------------------------------------------------------------------------

  _captureMarketSnapshot() {
    return {
      tick: this.tick,
      lastPrice: this.lastPrice,
      bestBid: this.orderBook.bestBid,
      bestAsk: this.orderBook.bestAsk,
      spread: this.orderBook.spread,
      midPrice: this.orderBook.midPrice || this.lastPrice,
      volatility: this.metricsEngine.volatility,
    };
  }

  // ---------------------------------------------------------------------------
  //  User order scheduling (latency-aware)
  // ---------------------------------------------------------------------------

  /** Schedule a user order through the event queue */
  scheduleUserOrder(order) {
    const delay = sampleLatency(
      this.config.userOrderDelayMin,
      this.config.userOrderDelayMax,
      this.latencyRng
    );
    this.eventQueue.schedule({
      type: EVENT_TYPES.SUBMIT_ORDER,
      sourceId: 'user',
      payload: { order },
      createdAt: this.tick,
      scheduledFor: this.tick + delay,
      snapshot: this._captureMarketSnapshot(),
    });
    this._pushUpdate();
  }

  /** Schedule a user cancel through the event queue */
  scheduleUserCancel(orderId) {
    const delay = sampleLatency(
      this.config.userOrderDelayMin,
      this.config.userOrderDelayMax,
      this.latencyRng
    );
    this.eventQueue.schedule({
      type: EVENT_TYPES.CANCEL_ORDER,
      sourceId: 'user',
      payload: { orderId },
      createdAt: this.tick,
      scheduledFor: this.tick + delay,
      snapshot: this._captureMarketSnapshot(),
    });
    this._pushUpdate();
  }

  // ---------------------------------------------------------------------------
  //  Direct user order processing (latency disabled)
  // ---------------------------------------------------------------------------

  /** Process a user-submitted order immediately (no latency) */
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

  /** Cancel a user order immediately (no latency) */
  cancelUserOrder(orderId) {
    const cancelled = this.orderBook.cancelOrder(orderId);
    this._pushUpdate();
    return cancelled;
  }

  // ---------------------------------------------------------------------------
  //  Flush / cleanup
  // ---------------------------------------------------------------------------

  /** Flush all pending events immediately (used when latency is toggled off) */
  _flushEventQueue() {
    // Process all pending events regardless of scheduledFor
    const all = this.eventQueue.events.filter((e) => e.status === 'pending');
    this.eventQueue.events = [];

    all.sort((a, b) => {
      const pa = { CANCEL_ORDER: 1, SUBMIT_ORDER: 2 }[a.type] ?? 99;
      const pb = { CANCEL_ORDER: 1, SUBMIT_ORDER: 2 }[b.type] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.sequenceNumber - b.sequenceNumber;
    });

    const trades = [];
    for (const event of all) {
      event.status = 'flushed';
      event.executedAt = this.tick;
      if (event.type === EVENT_TYPES.CANCEL_ORDER) {
        this._executeCancelEvent(event);
      } else if (event.type === EVENT_TYPES.SUBMIT_ORDER) {
        trades.push(...this._executeSubmitEvent(event));
      }
    }

    if (trades.length > 0) {
      this.lastPrice = trades[trades.length - 1].price;
      this.metricsEngine.processTrades(this.tick, trades);
      this.marketMakerSystem.handleFills(trades, this.tick);
    }
  }

  /** Clean up */
  destroy() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.isRunning = false;
  }

  // ---------------------------------------------------------------------------
  //  Helpers
  // ---------------------------------------------------------------------------

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

  /** Push display state to UI */
  _pushUpdate() {
    if (!this.onUpdate) return;

    const depth = this.orderBook.getDepth(25);
    const cumulativeDepth = this.orderBook.getCumulativeDepth(50);
    const latencyEnabled = !!this.config.enableLatency;

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

      // Latency / event queue
      latencyEnabled,
      pendingEvents: latencyEnabled ? this.eventQueue.getPendingSummary() : [],
      pendingEventCount: latencyEnabled ? this.eventQueue.getPendingCount() : 0,
      eventLog: latencyEnabled ? this.eventQueue.getRecentLog() : [],
      userFills: this._pendingUserFills,
    });
  }

  _getUserOrdersSnapshot() {
    return this.orderBook
      .getAgentOrderIds('user')
      .map((orderId) => this.orderBook.getOrder(orderId))
      .filter(Boolean)
      .sort((a, b) => (
        (a.createdAt - b.createdAt)
        || ((a.sequenceNumber || 0) - (b.sequenceNumber || 0))
        || String(a.id).localeCompare(String(b.id))
      ))
      .map((order) => {
        const queue = this.orderBook.getQueuePosition(order.id);
        return {
          ...order,
          queuePosition: queue?.position ?? null,
          priceLevelOrderCount: queue?.levelOrderCount ?? null,
          levelPrice: queue?.levelPrice ?? order.price ?? null,
          levelSize: queue?.levelSize ?? null,
        };
      });
  }
}
