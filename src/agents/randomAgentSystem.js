/**
 * Random Agent System
 *
 * Each agent has randomly-assigned personality parameters.
 * On each tick, agents independently and probabilistically decide actions.
 * No strategy, no memory, no pattern following — pure weighted randomness.
 *
 * Agent personality parameters (assigned at creation):
 *   - activityRate: probability of acting on any given tick (0.005–0.15)
 *   - buyBias: probability of choosing buy vs sell (0.3–0.7)
 *   - limitBias: probability of limit vs market order (0.6–0.95)
 *   - sizeScale: multiplier for order sizes (0.3–3.0, right-skewed)
 *   - priceSpread: how far from mid they place limits (0.2–4.0)
 *   - lifetimeScale: multiplier for order lifetime (0.5–5.0)
 *   - cancelRate: probability of cancelling a resting order per tick (0.002–0.03)
 */

import { createOrder } from '../engine/orderBook.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function sampleOffset(rng, tickSize, meanTicks) {
  const lambda = 1 / Math.max(1, meanTicks);
  const offsetTicks = Math.max(1, Math.round(rng.exponential(lambda)));
  return offsetTicks * tickSize;
}

export class RandomAgentSystem {
  constructor(rng, config) {
    this.rng = rng;
    this.config = config;
    this.agents = [];
    this.marketState = this._createMarketState();
    this.initAgents();
  }

  initAgents() {
    this.agents = [];
    const n = this.config.numAgents || 100;

    for (let i = 0; i < n; i++) {
      this.agents.push({
        id: `agent-${i}`,
        // Core personality — set once at creation
        activityRate: this.rng.float(0.005, 0.15),
        buyBias: clamp(this.rng.float(
          this.config.buyBias - 0.2,
          this.config.buyBias + 0.2
        ), 0.1, 0.9),
        limitBias: this.rng.float(
          Math.max(0.5, this.config.limitBias - 0.15),
          Math.min(0.98, this.config.limitBias + 0.1)
        ),
        sizeScale: this.rng.logNormal(0, 0.5),
        priceSpread: this.rng.float(0.5, 3.0),
        lifetimeScale: this.rng.logNormal(0, 0.35),
        cancelRate: this.rng.float(0.002, 0.03),
      });
    }
  }

  _createMarketState() {
    return {
      regimeBias: 0,
      flowBias: 0,
      volatility: 1,
      liquidityTightness: 1,
      anchorPrice: this.config.initialPrice,
      lastMidPrice: this.config.initialPrice,
    };
  }

  _updateMarketState(midPrice) {
    const state = this.marketState;
    const referencePrice = midPrice > 0 ? midPrice : state.anchorPrice;
    const lastMidPrice = state.lastMidPrice || referencePrice;
    const move = lastMidPrice > 0
      ? (referencePrice - lastMidPrice) / lastMidPrice
      : 0;

    state.anchorPrice = state.anchorPrice * 0.995 + referencePrice * 0.005;

    if (this.rng.bool(0.02)) {
      state.regimeBias = clamp(
        state.regimeBias * 0.5 + this.rng.gaussian(0, 0.35),
        -0.9,
        0.9
      );
    } else {
      state.regimeBias = clamp(
        state.regimeBias * 0.985 + this.rng.gaussian(0, 0.02),
        -0.9,
        0.9
      );
    }

    const deviation = state.anchorPrice > 0
      ? (referencePrice - state.anchorPrice) / state.anchorPrice
      : 0;
    const meanReversion = clamp(-deviation * 12, -0.35, 0.35);

    state.flowBias = clamp(
      state.flowBias * 0.92
        + state.regimeBias * 0.08
        + meanReversion * 0.15
        + this.rng.gaussian(0, 0.02),
      -0.85,
      0.85
    );

    state.volatility = clamp(
      state.volatility * 0.9
        + 0.1
        + Math.abs(state.flowBias) * 0.2
        + Math.abs(move) * 80
        + this.rng.float(-0.03, 0.03),
      0.7,
      1.8
    );

    state.liquidityTightness = clamp(
      1.15 - Math.abs(state.flowBias) * 0.3 + this.rng.float(-0.05, 0.05),
      0.65,
      1.2
    );

    state.lastMidPrice = referencePrice;
  }

  _sampleLifetime(agent) {
    const lifetime = Math.round(
      this.config.baseLifetime
        * Math.sqrt(agent.lifetimeScale)
        * Math.min(2.2, Math.max(0.5, this.rng.logNormal(-0.1, 0.35)))
    );

    return Math.max(
      this.config.minLifetime,
      Math.min(this.config.maxLifetime, lifetime)
    );
  }

  _sampleLimitPrice(agent, isBuy, midPrice, orderBook, urgency) {
    const state = this.marketState;
    const tickSize = orderBook.tickSize;
    const bestBid = orderBook.bestBid ?? Math.max(tickSize, midPrice - tickSize);
    const bestAsk = orderBook.bestAsk ?? midPrice + tickSize;
    const meanOffsetTicks = (2 + agent.priceSpread * (4 + this.config.priceOffsetRange * 5))
      * state.liquidityTightness
      * (0.85 + state.volatility * 0.25);

    let targetPrice;

    if (urgency > 0.55 && this.rng.bool(0.3)) {
      const aggressiveTicks = this.rng.int(0, Math.max(1, Math.round(state.volatility * 2)));
      targetPrice = isBuy
        ? bestAsk + aggressiveTicks * tickSize
        : bestBid - aggressiveTicks * tickSize;
    } else {
      const referencePrice = isBuy ? bestBid : bestAsk;
      const offset = sampleOffset(this.rng, tickSize, meanOffsetTicks);
      targetPrice = isBuy ? referencePrice - offset : referencePrice + offset;

      if (this.rng.bool(0.15 + urgency * 0.1)) {
        const insideTicks = this.rng.int(0, Math.max(1, Math.round(state.volatility * 3)));
        targetPrice = isBuy
          ? Math.min(bestAsk, midPrice + insideTicks * tickSize)
          : Math.max(bestBid, midPrice - insideTicks * tickSize);
      }
    }

    if (this.rng.bool(0.06)) {
      const roundUnit = Math.max(tickSize * 25, 0.25);
      targetPrice = Math.round(targetPrice / roundUnit) * roundUnit;
    }

    return orderBook.roundPrice(Math.max(tickSize, targetPrice));
  }

  /**
   * Process one tick for all agents.
   * Returns array of orders to submit to the matching engine.
   */
  tick(currentTick, midPrice, orderBook) {
    const orders = [];

    if (midPrice == null || midPrice <= 0) return orders;
    this._updateMarketState(midPrice);

    const state = this.marketState;

    for (const agent of this.agents) {
      // --- Cancellation pass ---
      // Each agent may cancel one of their resting orders
      const agentOrderIds = orderBook.getAgentOrderIds(agent.id);
      if (agentOrderIds.length > 0 && this.rng.bool(agent.cancelRate * this.config.cancelProbability)) {
        const cancelId = this.rng.pick(agentOrderIds);
        if (cancelId) {
          orderBook.cancelOrder(cancelId);
        }
      }

      // --- Action pass ---
      // Most ticks, agent does nothing
      const effectiveRate = clamp(
        agent.activityRate
          * this.config.actionFrequency
          * (0.9 + Math.abs(state.flowBias) * 0.5 + (state.volatility - 1) * 0.35),
        0.001,
        0.95
      );
      if (!this.rng.bool(effectiveRate)) continue;

      // Decide buy or sell
      const effectiveBuyBias = clamp(
        (agent.buyBias + state.flowBias * 0.18 + this.rng.gaussian(0, 0.015))
          * this.config.buyProbability / 0.5,
        0.02,
        0.98
      );
      const isBuy = this.rng.bool(effectiveBuyBias);
      const side = isBuy ? 'buy' : 'sell';
      const urgency = Math.max(0, isBuy ? state.flowBias : -state.flowBias);

      // Decide limit or market
      const isLimit = this.rng.bool(clamp(
        agent.limitBias * this.config.limitProbability / 0.8
          - urgency * 0.2
          + (state.volatility - 1) * 0.05,
        0.2,
        0.99
      ));
      const type = isLimit ? 'limit' : 'market';

      // Decide size — exponential distribution, most orders small
      const baseSize = this.rng.exponential(1.8)
        * agent.sizeScale
        * (1 + urgency * 0.8 + Math.max(0, state.volatility - 1) * 0.35);
      const size = Math.max(
        this.config.minOrderSize,
        Math.min(
          this.config.maxOrderSize,
          Math.round(baseSize * this.config.baseOrderSize)
        )
      );

      if (size <= 0) continue;

      let price = null;
      let lifetime = null;

      if (type === 'limit') {
        price = this._sampleLimitPrice(agent, isBuy, midPrice, orderBook, urgency);
        lifetime = this._sampleLifetime(agent);
      }

      const order = createOrder({
        side,
        type,
        price,
        size,
        agentId: agent.id,
        tick: currentTick,
        lifetime,
      });

      orders.push(order);
    }

    return orders;
  }

  /** Reconfigure agents (e.g., when user changes params) */
  updateConfig(newConfig) {
    const previousAgentCount = this.config.numAgents;
    this.config = { ...this.config, ...newConfig };

    if (newConfig.numAgents != null && newConfig.numAgents !== previousAgentCount) {
      this.initAgents();
    }
  }

  /** Reset agents with current config */
  reset() {
    this.marketState = this._createMarketState();
    this.initAgents();
  }
}
