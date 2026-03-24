import { createOrder } from '../engine/orderBook.js';

const MIN_REVIEW_INTERVAL = 5;
const REFRESH_JITTER_RATIO = 0.35;
const MISSED_REFRESH_PROBABILITY = 0.14;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getRange(config) {
  const fallback = { min: 8, max: 24 };
  const range = config.quoteSizeRange || fallback;
  const min = Math.max(1, Math.round(range.min ?? fallback.min));
  const max = Math.max(min, Math.round(range.max ?? fallback.max));
  return { min, max };
}

function nextDelay(rng, base) {
  const jitter = 1 + rng.float(-REFRESH_JITTER_RATIO, REFRESH_JITTER_RATIO);
  return Math.max(1, Math.round(Math.max(1, base) * jitter));
}

function updatePosition(maker, side, price, size) {
  if (side === 'buy') {
    const cost = price * size;
    maker.cash -= cost;
    if (maker.inventory >= 0) {
      const totalCost = maker.avgEntry * maker.inventory + cost;
      maker.inventory += size;
      maker.avgEntry = maker.inventory > 0 ? totalCost / maker.inventory : 0;
    } else {
      maker.inventory += size;
      if (maker.inventory > 0) {
        maker.avgEntry = price;
      } else if (maker.inventory === 0) {
        maker.avgEntry = 0;
      }
    }
    return;
  }

  maker.cash += price * size;
  if (maker.inventory <= 0) {
    const totalValue = Math.abs(maker.avgEntry * maker.inventory) + price * size;
    maker.inventory -= size;
    maker.avgEntry = maker.inventory !== 0
      ? totalValue / Math.abs(maker.inventory)
      : 0;
  } else {
    maker.inventory -= size;
    if (maker.inventory < 0) {
      maker.avgEntry = price;
    } else if (maker.inventory === 0) {
      maker.avgEntry = 0;
    }
  }
}

export class MarketMakerSystem {
  constructor(rng, config) {
    this.rng = rng;
    this.config = config;
    this.makers = [];
    this.fillCount = 0;
    this.totalQuotedSpread = 0;
    this.quotedSpreadSamples = 0;
    this.initializeMakers();
  }

  initializeMakers() {
    this.fillCount = 0;
    this.totalQuotedSpread = 0;
    this.quotedSpreadSamples = 0;
    this.makers = [];
    if (!this.config.enableMarketMakers) return;

    const makerCount = Math.max(0, Math.round(this.config.numberOfMarketMakers || 0));
    for (let i = 0; i < makerCount; i++) {
      this.makers.push(this._createMaker(i));
    }
  }

  updateConfig(newConfig, orderBook, currentTick) {
    const previousEnabled = !!this.config.enableMarketMakers;
    this.config = {
      ...this.config,
      ...newConfig,
      quoteSizeRange: newConfig.quoteSizeRange
        ? { ...newConfig.quoteSizeRange }
        : this.config.quoteSizeRange,
    };

    const enabled = !!this.config.enableMarketMakers;
    if (!enabled) {
      if (previousEnabled) {
        this._cancelAllMakerOrders(orderBook);
      }
      this.makers = [];
      this.fillCount = 0;
      this.totalQuotedSpread = 0;
      this.quotedSpreadSamples = 0;
      return;
    }

    const targetCount = Math.max(0, Math.round(this.config.numberOfMarketMakers || 0));

    if (!previousEnabled && enabled) {
      this.initializeMakers();
      for (const maker of this.makers) {
        maker.nextReviewTick = currentTick + nextDelay(this.rng, this.config.makerReactionDelay || 1);
      }
      return;
    }

    while (this.makers.length > targetCount) {
      const maker = this.makers.pop();
      this._cancelMakerOrders(maker, orderBook);
    }

    while (this.makers.length < targetCount) {
      const maker = this._createMaker(this.makers.length);
      maker.nextReviewTick = currentTick + nextDelay(this.rng, this.config.makerReactionDelay || 1);
      this.makers.push(maker);
    }

    for (const maker of this.makers) {
      maker.nextReviewTick = Math.min(
        maker.nextReviewTick,
        currentTick + nextDelay(this.rng, this.config.quoteRefreshInterval || MIN_REVIEW_INTERVAL)
      );
    }
  }

  tick(currentTick, marketState, orderBook) {
    if (!this.config.enableMarketMakers || this.makers.length === 0) {
      return [];
    }

    const orders = [];

    for (const maker of this.makers) {
      this._syncMakerOrders(maker, currentTick, orderBook);
    }

    for (const maker of this.makers) {
      this.cancelStaleQuotes(maker, currentTick, marketState, orderBook);
    }

    for (const maker of this.makers) {
      orders.push(...this.refreshQuotes(maker, currentTick, marketState, orderBook));
    }

    return orders;
  }

  handleFill(trade, currentTick) {
    let touched = false;

    if (trade.buyAgentId && trade.buyAgentId.startsWith('maker-')) {
      const maker = this._getMaker(trade.buyAgentId);
      if (maker) {
        updatePosition(maker, 'buy', trade.price, trade.size);
        touched = true;
        maker.lastFillTick = currentTick;
      }
    }

    if (trade.sellAgentId && trade.sellAgentId.startsWith('maker-')) {
      const maker = this._getMaker(trade.sellAgentId);
      if (maker) {
        updatePosition(maker, 'sell', trade.price, trade.size);
        touched = true;
        maker.lastFillTick = currentTick;
      }
    }

    if (!touched) return;

    this.fillCount++;

    for (const maker of this.makers) {
      if (maker.lastFillTick !== currentTick) continue;
      maker.nextReviewTick = Math.min(
        maker.nextReviewTick,
        currentTick + nextDelay(this.rng, this.config.makerReactionDelay || 1)
      );
    }
  }

  handleFills(trades, currentTick) {
    for (const trade of trades) {
      this.handleFill(trade, currentTick);
    }
  }

  getMetrics(orderBook, lastPrice) {
    const inventories = this.makers.map((maker) => maker.inventory);
    const currentQuoteSpreads = this.makers
      .filter((maker) => maker.lastQuotedBid != null && maker.lastQuotedAsk != null)
      .map((maker) => maker.lastQuotedAsk - maker.lastQuotedBid);
    const totalRestingVolume = this.makers.reduce((sum, maker) => (
      sum + this._sumOpenOrderVolume(orderBook, maker.id)
    ), 0);
    const makerRestingBidVolume = this.makers.reduce((sum, maker) => {
      const order = this._getOpenSideOrder(orderBook, maker.id, 'buy');
      return sum + (order?.remainingSize || 0);
    }, 0);
    const makerRestingAskVolume = this.makers.reduce((sum, maker) => {
      const order = this._getOpenSideOrder(orderBook, maker.id, 'sell');
      return sum + (order?.remainingSize || 0);
    }, 0);

    const bestBidControlled = orderBook.bids[0]?.orders.some((order) => order.agentId.startsWith('maker-')) || false;
    const bestAskControlled = orderBook.asks[0]?.orders.some((order) => order.agentId.startsWith('maker-')) || false;

    return {
      enabled: !!this.config.enableMarketMakers,
      makerCount: this.makers.length,
      totalRestingVolume,
      makerRestingBidVolume,
      makerRestingAskVolume,
      fillCount: this.fillCount,
      averageSpreadQuoted: average(currentQuoteSpreads),
      averageSpreadQuotedLifetime: this.quotedSpreadSamples > 0
        ? this.totalQuotedSpread / this.quotedSpreadSamples
        : 0,
      inventories,
      netInventory: inventories.reduce((sum, inventory) => sum + inventory, 0),
      averageInventory: average(inventories),
      longCount: inventories.filter((inventory) => inventory > 0).length,
      shortCount: inventories.filter((inventory) => inventory < 0).length,
      flatCount: inventories.filter((inventory) => inventory === 0).length,
      minInventory: inventories.length > 0 ? Math.min(...inventories) : 0,
      maxInventory: inventories.length > 0 ? Math.max(...inventories) : 0,
      bestBidControlled,
      bestAskControlled,
      spreadSetByMakers: bestBidControlled && bestAskControlled,
      makerMarkToMarket: this.makers.reduce((sum, maker) => (
        sum + maker.cash + maker.inventory * (lastPrice || 0)
      ), 0),
    };
  }

  _createMaker(index) {
    return {
      id: `maker-${index}`,
      cash: 0,
      inventory: 0,
      avgEntry: 0,
      nextReviewTick: nextDelay(this.rng, this.config.makerReactionDelay || 1),
      activeOrders: { buy: null, sell: null },
      pendingCancelAt: { buy: null, sell: null },
      nextQuoteAt: { buy: 0, sell: 0 },
      lastQuotedBid: null,
      lastQuotedAsk: null,
      lastQuotedAt: null,
      lastFillTick: null,
    };
  }

  _getMaker(agentId) {
    return this.makers.find((maker) => maker.id === agentId);
  }

  _syncMakerOrders(maker, currentTick, orderBook) {
    const orderIds = orderBook.getAgentOrderIds(maker.id);
    const activeOrders = { buy: null, sell: null };

    for (const orderId of orderIds) {
      const order = orderBook.getOrder(orderId);
      if (!order) continue;

      const side = order.side;
      const existing = activeOrders[side];
      if (!existing || order.createdAt > existing.createdAt) {
        activeOrders[side] = order;
      }
    }

    for (const orderId of orderIds) {
      const order = orderBook.getOrder(orderId);
      if (!order) continue;
      if (activeOrders[order.side]?.id !== order.id) {
        orderBook.cancelOrder(order.id);
      }
    }

    for (const side of ['buy', 'sell']) {
      const previousId = maker.activeOrders[side]?.id;
      const nextOrder = activeOrders[side];

      if (previousId && !nextOrder && (maker.nextQuoteAt[side] == null || maker.nextQuoteAt[side] <= currentTick)) {
        maker.nextQuoteAt[side] = currentTick + nextDelay(this.rng, this.config.makerReactionDelay || 1);
      }

      maker.activeOrders[side] = nextOrder;
    }
  }

  cancelStaleQuotes(maker, currentTick, marketState, orderBook) {
    if (currentTick < maker.nextReviewTick) return;

    if (this.rng.bool(MISSED_REFRESH_PROBABILITY)) {
      maker.nextReviewTick = currentTick + nextDelay(
        this.rng,
        Math.max(MIN_REVIEW_INTERVAL, this.config.quoteRefreshInterval || MIN_REVIEW_INTERVAL)
      );
      return;
    }

    const target = this._buildQuotePlan(maker, marketState, orderBook, false);

    for (const side of ['buy', 'sell']) {
      const order = maker.activeOrders[side];
      if (!order) continue;

      const sideKey = side === 'buy' ? 'bid' : 'ask';
      const targetPrice = side === 'buy' ? target.bidPrice : target.askPrice;
      const targetSize = side === 'buy' ? target.bidSize : target.askSize;
      const age = currentTick - order.createdAt;
      const priceMoved = targetPrice != null && Math.abs(order.price - targetPrice) >= orderBook.tickSize * 2;
      const sizeMismatch = targetSize === 0 || Math.abs(order.remainingSize - targetSize) >= Math.max(2, order.size * 0.35);
      const staleByLifetime = age >= Math.max(1, this.config.staleQuoteLifetime || 1);
      const shouldRefresh = staleByLifetime || priceMoved || sizeMismatch || !target.canQuote[sideKey];

      if (!shouldRefresh) {
        maker.pendingCancelAt[side] = null;
        continue;
      }

      if (maker.pendingCancelAt[side] == null) {
        maker.pendingCancelAt[side] = currentTick + nextDelay(
          this.rng,
          this.config.makerCancellationDelay || 1
        );
        continue;
      }

      if (currentTick < maker.pendingCancelAt[side]) continue;

      orderBook.cancelOrder(order.id);
      maker.activeOrders[side] = null;
      maker.pendingCancelAt[side] = null;
      maker.nextQuoteAt[side] = currentTick + nextDelay(
        this.rng,
        this.config.makerReactionDelay || 1
      );
    }

    maker.nextReviewTick = currentTick + nextDelay(
      this.rng,
      Math.max(MIN_REVIEW_INTERVAL, this.config.quoteRefreshInterval || MIN_REVIEW_INTERVAL)
    );
  }

  refreshQuotes(maker, currentTick, marketState, orderBook) {
    const isBidDue = !maker.activeOrders.buy
      && (maker.nextQuoteAt.buy == null || currentTick >= maker.nextQuoteAt.buy);
    const isAskDue = !maker.activeOrders.sell
      && (maker.nextQuoteAt.sell == null || currentTick >= maker.nextQuoteAt.sell);

    if (!isBidDue && !isAskDue) {
      return [];
    }

    const orders = [];
    const plan = this._buildQuotePlan(maker, marketState, orderBook, true);

    for (const [side, sideKey, priceKey, sizeKey] of [
      ['buy', 'bid', 'bidPrice', 'bidSize'],
      ['sell', 'ask', 'askPrice', 'askSize'],
    ]) {
      if (maker.activeOrders[side]) continue;
      if (!plan.canQuote[sideKey]) {
        maker.nextQuoteAt[side] = currentTick + nextDelay(
          this.rng,
          Math.max(MIN_REVIEW_INTERVAL, this.config.quoteRefreshInterval || MIN_REVIEW_INTERVAL)
        );
        continue;
      }
      if (maker.nextQuoteAt[side] != null && currentTick < maker.nextQuoteAt[side]) continue;

      const price = plan[priceKey];
      const size = plan[sizeKey];
      if (price == null || size <= 0) continue;

      const order = createOrder({
        side,
        type: 'limit',
        price,
        size,
        agentId: maker.id,
        tick: currentTick,
        lifetime: this.config.staleQuoteLifetime,
      });

      orders.push(order);
      maker.activeOrders[side] = order;
      maker.pendingCancelAt[side] = null;
      maker.nextQuoteAt[side] = null;
    }

    if (orders.length > 0 && plan.bidPrice != null && plan.askPrice != null) {
      this.totalQuotedSpread += plan.askPrice - plan.bidPrice;
      this.quotedSpreadSamples++;
      maker.lastQuotedBid = plan.bidPrice;
      maker.lastQuotedAsk = plan.askPrice;
      maker.lastQuotedAt = currentTick;
    }

    return orders;
  }

  _buildQuotePlan(maker, marketState, orderBook, sampleSizes) {
    const tickSize = orderBook.tickSize;
    const referencePrice = marketState.midPrice || marketState.lastPrice || this.config.initialPrice;
    const bestBid = orderBook.bestBid ?? (referencePrice - tickSize);
    const bestAsk = orderBook.bestAsk ?? (referencePrice + tickSize);
    const maxInventory = Math.max(1, this.config.maxInventory || 1);
    const inventoryRatio = clamp(maker.inventory / maxInventory, -1.25, 1.25);
    const widenTicks = this.maybeWidenSpread(marketState, orderBook);
    const baseOffsetTicks = Math.max(1, this.config.baseSpreadTicks || 1) + widenTicks;
    const inventoryShiftTicks = inventoryRatio * (this.config.inventorySkewStrength || 0);
    const shiftedReference = referencePrice - inventoryShiftTicks * tickSize;

    let bidPrice = shiftedReference - baseOffsetTicks * tickSize;
    let askPrice = shiftedReference + baseOffsetTicks * tickSize;

    if (sampleSizes && this.rng.bool(this.config.probabilityOfJoiningBestBidAsk || 0)) {
      bidPrice = Math.max(bidPrice, bestBid);
    } else if (sampleSizes && this.rng.bool(this.config.probabilityOfQuotingOneTickAway || 0)) {
      bidPrice = Math.min(bidPrice, bestBid - tickSize);
    }

    if (sampleSizes && this.rng.bool(this.config.probabilityOfJoiningBestBidAsk || 0)) {
      askPrice = Math.min(askPrice, bestAsk);
    } else if (sampleSizes && this.rng.bool(this.config.probabilityOfQuotingOneTickAway || 0)) {
      askPrice = Math.max(askPrice, bestAsk + tickSize);
    }

    bidPrice = Math.min(bidPrice, bestAsk - tickSize);
    askPrice = Math.max(askPrice, bestBid + tickSize);

    if (askPrice - bidPrice < tickSize * 2) {
      askPrice = bidPrice + tickSize * 2;
    }

    bidPrice = orderBook.roundPrice(Math.max(tickSize, bidPrice));
    askPrice = orderBook.roundPrice(Math.max(bidPrice + tickSize, askPrice));

    const canQuoteBid = maker.inventory < maxInventory;
    const canQuoteAsk = maker.inventory > -maxInventory;
    const { min, max } = getRange(this.config);
    const neutralSize = sampleSizes ? this.rng.int(min, max) : Math.round((min + max) / 2);

    const bidPressure = maker.inventory > 0 ? clamp(1 - Math.abs(inventoryRatio), 0.15, 1) : 1 + Math.abs(inventoryRatio) * 0.25;
    const askPressure = maker.inventory < 0 ? clamp(1 - Math.abs(inventoryRatio), 0.15, 1) : 1 + Math.abs(inventoryRatio) * 0.25;

    return {
      bidPrice,
      askPrice,
      bidSize: Math.max(1, Math.round(neutralSize * bidPressure)),
      askSize: Math.max(1, Math.round(neutralSize * askPressure)),
      canQuote: {
        bid: canQuoteBid,
        ask: canQuoteAsk,
      },
    };
  }

  maybeWidenSpread(marketState, orderBook) {
    const tickSize = orderBook.tickSize;
    const bookDepth = orderBook.getDepth(3);
    const nearbyDepth = [...bookDepth.bidLevels, ...bookDepth.askLevels]
      .reduce((sum, level) => sum + level.size, 0);
    const depthReference = Math.max(
      1,
      (this.config.quoteSizeRange?.max || 10) * Math.max(2, this.makers.length) * 4
    );
    const thinness = clamp(1 - nearbyDepth / depthReference, 0, 1);
    const spreadTicks = (marketState.spread || tickSize) / tickSize;
    const volatilityTicks = (marketState.volatility || 0) * Math.max(1, marketState.midPrice || 1) / tickSize;

    return Math.round(
      Math.max(0, spreadTicks - 2) * 0.25
      + thinness * 3
      + clamp(volatilityTicks / 25, 0, 3)
    );
  }

  _sumOpenOrderVolume(orderBook, agentId) {
    return orderBook.getAgentOrderIds(agentId).reduce((sum, orderId) => {
      const order = orderBook.getOrder(orderId);
      return sum + (order?.remainingSize || 0);
    }, 0);
  }

  _getOpenSideOrder(orderBook, agentId, side) {
    return orderBook
      .getAgentOrderIds(agentId)
      .map((orderId) => orderBook.getOrder(orderId))
      .find((order) => order?.side === side);
  }

  _cancelMakerOrders(maker, orderBook) {
    for (const orderId of orderBook.getAgentOrderIds(maker.id)) {
      orderBook.cancelOrder(orderId);
    }
  }

  _cancelAllMakerOrders(orderBook) {
    for (const maker of this.makers) {
      this._cancelMakerOrders(maker, orderBook);
    }
  }
}
