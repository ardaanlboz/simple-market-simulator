/**
 * Matching Engine — processes incoming orders against the order book.
 *
 * Supports: market buy/sell, limit buy/sell, partial fills.
 * Returns trades and optionally rests unfilled limit orders in the book.
 */

import {
  computeLiquidityFade,
  getBookPressure,
  summarizeExecution,
} from './slippageModel.js';
import {
  normalizeOrderFields,
  ORDER_STATUS,
  setOrderStatus,
  updateOrderAfterFill,
} from './orderBook.js';

export class MatchingEngine {
  constructor(orderBook, config = {}) {
    this.orderBook = orderBook;
    this.config = config;
    this.tradeId = 0;
  }

  reset() {
    this.tradeId = 0;
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Process an incoming order.
   * Returns { trades: Trade[], rested: boolean, summary: object | null }
   */
  processOrder(order, currentTick, marketState = {}) {
    normalizeOrderFields(order);
    const trades = [];
    let summary = null;

    if (order.type === 'market') {
      const context = this._prepareMarketContext(order, marketState);
      this.sweepBookForMarketOrder(order, trades, currentTick);
      summary = summarizeExecution(order, trades, context);
    } else {
      this.matchIncomingOrder(order, trades, currentTick);
    }

    return {
      trades,
      rested: order.type === 'limit' && order.remainingQuantity > 0,
      summary,
    };
  }

  matchIncomingOrder(order, trades, currentTick) {
    this._matchLimit(order, trades, currentTick);
  }

  /** Match a market order — aggressively takes liquidity */
  sweepBookForMarketOrder(order, trades, currentTick) {
    const oppositeSide = order.side === 'buy'
      ? this.orderBook.asks
      : this.orderBook.bids;

    this._match(order, oppositeSide, trades, currentTick, null);

    if (order.remainingQuantity > 0) {
      setOrderStatus(
        order,
        order.filledQuantity > 0 ? ORDER_STATUS.PARTIALLY_FILLED : ORDER_STATUS.CANCELLED
      );
    }
  }

  _prepareMarketContext(order, marketState) {
    const oppositeLevels = order.side === 'buy'
      ? this.orderBook.asks
      : this.orderBook.bids;
    const referencePrice = marketState.midPrice
      ?? this.orderBook.midPrice
      ?? marketState.lastPrice
      ?? null;
    const arrivalPrice = order.side === 'buy'
      ? this.orderBook.bestAsk ?? referencePrice
      : this.orderBook.bestBid ?? referencePrice;

    const bookPressure = getBookPressure(
      oppositeLevels,
      order.quantity,
      this.config,
      {
        ...marketState,
        midPrice: marketState.midPrice ?? this.orderBook.midPrice ?? marketState.lastPrice,
      }
    );
    const adjustments = computeLiquidityFade(bookPressure);
    let quoteFadeVolume = 0;

    for (const adjustment of adjustments) {
      quoteFadeVolume += this._fadeLevelLiquidity(
        oppositeLevels,
        adjustment.index,
        adjustment.fadeSize
      );
    }

    for (let i = oppositeLevels.length - 1; i >= 0; i--) {
      if (oppositeLevels[i].orders.length === 0) {
        oppositeLevels.splice(i, 1);
      }
    }

    return {
      arrivalPrice,
      referencePrice,
      topLevelSize: bookPressure.topLevelSize,
      nearbyDepth: bookPressure.nearbyDepth,
      impactScore: bookPressure.impactScore,
      thinness: bookPressure.thinness,
      speedPressure: bookPressure.speedPressure,
      spread: bookPressure.spread,
      quoteFadeVolume,
    };
  }

  /** Match a limit order — takes liquidity at acceptable prices, rests remainder */
  _matchLimit(order, trades, currentTick) {
    const oppositeSide = order.side === 'buy'
      ? this.orderBook.asks
      : this.orderBook.bids;

    const limitPrice = order.price;
    this._match(order, oppositeSide, trades, currentTick, limitPrice);

    // Rest unfilled portion
    if (order.remainingQuantity > 0) this.restRemainingLimitOrder(order);
  }

  restRemainingLimitOrder(order) {
    this.orderBook.addOrder(order);
  }

  /**
   * Core matching loop.
   * Walks opposite side levels, fills against resting orders at each level.
   * limitPrice: null for market orders, or the limit price for limit orders.
   */
  _match(incomingOrder, oppositeLevels, trades, currentTick, limitPrice) {
    let levelIdx = 0;

    while (incomingOrder.remainingQuantity > 0 && levelIdx < oppositeLevels.length) {
      const level = oppositeLevels[levelIdx];

      // Price check for limit orders
      if (limitPrice != null) {
        if (incomingOrder.side === 'buy' && level.price > limitPrice) break;
        if (incomingOrder.side === 'sell' && level.price < limitPrice) break;
      }

      this.executeAgainstPriceLevel(incomingOrder, level, trades, currentTick);

      // Remove empty level
      if (level.orders.length === 0) {
        oppositeLevels.splice(levelIdx, 1);
        // Don't increment levelIdx
      } else {
        levelIdx++;
      }
    }
  }

  executeAgainstPriceLevel(incomingOrder, level, trades, currentTick) {
    while (incomingOrder.remainingQuantity > 0 && level.orders.length > 0) {
      const restingOrder = level.orders[0];
      normalizeOrderFields(restingOrder);

      const fillQuantity = Math.min(
        incomingOrder.remainingQuantity,
        restingOrder.remainingQuantity
      );
      const fillPrice = restingOrder.price;
      const queueSnapshot = {
        restingOrderQueuePosition: 1,
        restingOrderSequenceNumber: restingOrder.sequenceNumber,
        restingOrderTimestamp: restingOrder.timestamp,
      };

      const trade = this.executeMatch(
        incomingOrder,
        restingOrder,
        fillPrice,
        fillQuantity,
        currentTick,
        queueSnapshot
      );
      if (!trade) break;

      trades.push(trade);

      if (restingOrder.remainingQuantity <= 0) {
        this.removeFilledOrder(level, 0, restingOrder);
      }
    }
  }

  executeMatch(takerOrder, makerOrder, price, quantity, currentTick, queueSnapshot = {}) {
    const executedQuantity = Math.min(
      quantity,
      takerOrder.remainingQuantity,
      makerOrder.remainingQuantity
    );
    if (executedQuantity <= 0) return null;

    updateOrderAfterFill(takerOrder, executedQuantity);
    updateOrderAfterFill(makerOrder, executedQuantity);

    return {
      id: ++this.tradeId,
      price,
      executionPrice: price,
      quantity: executedQuantity,
      size: executedQuantity,
      buyOrderId: takerOrder.side === 'buy' ? takerOrder.id : makerOrder.id,
      sellOrderId: takerOrder.side === 'sell' ? takerOrder.id : makerOrder.id,
      buyAgentId: takerOrder.side === 'buy' ? takerOrder.agentId : makerOrder.agentId,
      sellAgentId: takerOrder.side === 'sell' ? takerOrder.agentId : makerOrder.agentId,
      aggressor: takerOrder.side,
      tick: currentTick,
      timestamp: Date.now(),
      ...queueSnapshot,
    };
  }

  updateOrderAfterFill(order, executedQuantity) {
    return updateOrderAfterFill(order, executedQuantity);
  }

  removeFilledOrder(level, orderIdx, order) {
    setOrderStatus(order, ORDER_STATUS.FILLED);
    this.orderBook.orderMap.delete(order.id);
    const agentSet = this.orderBook.agentOrders.get(order.agentId);
    if (agentSet) {
      agentSet.delete(order.id);
      if (agentSet.size === 0) this.orderBook.agentOrders.delete(order.agentId);
    }
    level.orders.splice(orderIdx, 1);
  }

  _fadeLevelLiquidity(oppositeLevels, levelIndex, fadeSize) {
    const level = oppositeLevels[levelIndex];
    if (!level || fadeSize <= 0) return 0;

    let remainingFade = fadeSize;

    for (let orderIdx = level.orders.length - 1; orderIdx >= 0 && remainingFade > 0; orderIdx--) {
      const restingOrder = level.orders[orderIdx];
      if (restingOrder.agentId === 'user') continue;
      normalizeOrderFields(restingOrder);

      const reduction = Math.min(restingOrder.remainingQuantity, remainingFade);

      updateOrderAfterFill(restingOrder, reduction);
      remainingFade -= reduction;

      if (restingOrder.remainingQuantity <= 0) {
        this.removeFilledOrder(level, orderIdx, restingOrder);
      }
    }

    return fadeSize - remainingFade;
  }
}
