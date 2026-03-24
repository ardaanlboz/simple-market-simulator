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
    const trades = [];
    let summary = null;

    if (order.type === 'market') {
      const context = this._prepareMarketContext(order, marketState);
      this._matchMarket(order, trades, currentTick);
      summary = summarizeExecution(order, trades, context);
    } else {
      this._matchLimit(order, trades, currentTick);
    }

    return {
      trades,
      rested: order.status === 'open' && order.type === 'limit',
      summary,
    };
  }

  /** Match a market order — aggressively takes liquidity */
  _matchMarket(order, trades, currentTick) {
    const oppositeSide = order.side === 'buy'
      ? this.orderBook.asks
      : this.orderBook.bids;

    this._match(order, oppositeSide, trades, currentTick, null);

    if (order.remainingSize > 0) {
      // Market order with no more liquidity — killed
      order.status = order.remainingSize < order.size ? 'partial' : 'cancelled';
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
      order.size,
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
    if (order.remainingSize > 0) {
      this.orderBook.addOrder(order);
    }
  }

  /**
   * Core matching loop.
   * Walks opposite side levels, fills against resting orders at each level.
   * limitPrice: null for market orders, or the limit price for limit orders.
   */
  _match(incomingOrder, oppositeLevels, trades, currentTick, limitPrice) {
    let levelIdx = 0;

    while (incomingOrder.remainingSize > 0 && levelIdx < oppositeLevels.length) {
      const level = oppositeLevels[levelIdx];

      // Price check for limit orders
      if (limitPrice != null) {
        if (incomingOrder.side === 'buy' && level.price > limitPrice) break;
        if (incomingOrder.side === 'sell' && level.price < limitPrice) break;
      }

      let orderIdx = 0;
      while (incomingOrder.remainingSize > 0 && orderIdx < level.orders.length) {
        const restingOrder = level.orders[orderIdx];
        const fillSize = Math.min(incomingOrder.remainingSize, restingOrder.remainingSize);
        const fillPrice = restingOrder.price;

        // Execute fill
        incomingOrder.remainingSize -= fillSize;
        restingOrder.remainingSize -= fillSize;

        // Create trade record
        const trade = {
          id: ++this.tradeId,
          price: fillPrice,
          size: fillSize,
          buyOrderId: incomingOrder.side === 'buy' ? incomingOrder.id : restingOrder.id,
          sellOrderId: incomingOrder.side === 'sell' ? incomingOrder.id : restingOrder.id,
          buyAgentId: incomingOrder.side === 'buy' ? incomingOrder.agentId : restingOrder.agentId,
          sellAgentId: incomingOrder.side === 'sell' ? incomingOrder.agentId : restingOrder.agentId,
          aggressor: incomingOrder.side,
          tick: currentTick,
          timestamp: Date.now(),
        };
        trades.push(trade);

        // Update order statuses
        if (restingOrder.remainingSize <= 0) {
          restingOrder.status = 'filled';
          // Remove from order map and agent orders
          this.orderBook.orderMap.delete(restingOrder.id);
          const agentSet = this.orderBook.agentOrders.get(restingOrder.agentId);
          if (agentSet) {
            agentSet.delete(restingOrder.id);
            if (agentSet.size === 0) this.orderBook.agentOrders.delete(restingOrder.agentId);
          }
          level.orders.splice(orderIdx, 1);
          // Don't increment orderIdx — next order shifted into position
        } else {
          restingOrder.status = 'partial';
          orderIdx++;
        }

        if (incomingOrder.remainingSize <= 0) {
          incomingOrder.status = 'filled';
        } else {
          incomingOrder.status = 'partial';
        }
      }

      // Remove empty level
      if (level.orders.length === 0) {
        oppositeLevels.splice(levelIdx, 1);
        // Don't increment levelIdx
      } else {
        levelIdx++;
      }
    }
  }

  _fadeLevelLiquidity(oppositeLevels, levelIndex, fadeSize) {
    const level = oppositeLevels[levelIndex];
    if (!level || fadeSize <= 0) return 0;

    let remainingFade = fadeSize;

    for (let orderIdx = level.orders.length - 1; orderIdx >= 0 && remainingFade > 0; orderIdx--) {
      const restingOrder = level.orders[orderIdx];
      if (restingOrder.agentId === 'user') continue;

      const reduction = Math.min(restingOrder.remainingSize, remainingFade);

      restingOrder.remainingSize -= reduction;
      remainingFade -= reduction;

      if (restingOrder.remainingSize <= 0) {
        this.orderBook.orderMap.delete(restingOrder.id);
        const agentSet = this.orderBook.agentOrders.get(restingOrder.agentId);
        if (agentSet) {
          agentSet.delete(restingOrder.id);
          if (agentSet.size === 0) this.orderBook.agentOrders.delete(restingOrder.agentId);
        }
        level.orders.splice(orderIdx, 1);
      }
    }

    return fadeSize - remainingFade;
  }
}
