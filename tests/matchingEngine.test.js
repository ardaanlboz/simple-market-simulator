import test from 'node:test';
import assert from 'node:assert/strict';

import { MatchingEngine } from '../src/engine/matchingEngine.js';
import { MetricsEngine } from '../src/engine/metricsEngine.js';
import {
  createOrder,
  OrderBook,
  ORDER_STATUS,
  resetOrderIdCounter,
} from '../src/engine/orderBook.js';

function createEngine() {
  resetOrderIdCounter();
  const orderBook = new OrderBook(0.01);
  const matchingEngine = new MatchingEngine(orderBook, {
    tickSize: 0.01,
    baseOrderSize: 10,
    slippageIntensity: 0,
  });

  return { orderBook, matchingEngine };
}

function addRestingOrder(orderBook, { id, side, price, quantity, tick = 0, agentId = `${side}-agent` }) {
  const order = createOrder({
    id,
    side,
    type: 'limit',
    price,
    size: quantity,
    agentId,
    tick,
  });
  orderBook.addOrder(order);
  return order;
}

function getLevelOrderIds(orderBook, side, price) {
  const levels = side === 'buy' ? orderBook.bids : orderBook.asks;
  const level = levels.find((entry) => Math.abs(entry.price - price) < orderBook.tickSize / 2);
  return level ? level.orders.map((order) => order.id) : [];
}

test('partial fill against one resting order updates both orders correctly', () => {
  const { orderBook, matchingEngine } = createEngine();
  const restingAsk = addRestingOrder(orderBook, {
    id: 'ASK-1',
    side: 'sell',
    price: 101,
    quantity: 40,
  });
  const incomingBuy = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'market',
    size: 25,
    agentId: 'buyer',
    tick: 1,
  });

  const { trades } = matchingEngine.processOrder(incomingBuy, 1, {
    midPrice: 100.5,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  assert.equal(trades.length, 1);
  assert.equal(trades[0].quantity, 25);
  assert.equal(trades[0].price, 101);
  assert.equal(incomingBuy.status, ORDER_STATUS.FILLED);
  assert.equal(incomingBuy.filledQuantity, 25);
  assert.equal(incomingBuy.remainingQuantity, 0);
  assert.equal(restingAsk.status, ORDER_STATUS.PARTIALLY_FILLED);
  assert.equal(restingAsk.filledQuantity, 25);
  assert.equal(restingAsk.remainingQuantity, 15);
  assert.equal(orderBook.asks[0].orders[0].id, 'ASK-1');
});

test('partial fill against multiple resting orders at the same level obeys queue priority', () => {
  const { orderBook, matchingEngine } = createEngine();
  const firstAsk = addRestingOrder(orderBook, {
    id: 'ASK-1',
    side: 'sell',
    price: 101,
    quantity: 20,
    tick: 1,
  });
  const secondAsk = addRestingOrder(orderBook, {
    id: 'ASK-2',
    side: 'sell',
    price: 101,
    quantity: 30,
    tick: 2,
  });
  const incomingBuy = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'market',
    size: 35,
    agentId: 'buyer',
    tick: 3,
  });

  const { trades } = matchingEngine.processOrder(incomingBuy, 3, {
    midPrice: 100.5,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  assert.deepEqual(
    trades.map((trade) => ({ sellOrderId: trade.sellOrderId, quantity: trade.quantity })),
    [
      { sellOrderId: 'ASK-1', quantity: 20 },
      { sellOrderId: 'ASK-2', quantity: 15 },
    ]
  );
  assert.equal(firstAsk.status, ORDER_STATUS.FILLED);
  assert.equal(secondAsk.status, ORDER_STATUS.PARTIALLY_FILLED);
  assert.equal(secondAsk.remainingQuantity, 15);
  assert.equal(orderBook.asks[0].orders[0].id, 'ASK-2');
  assert.equal(trades[0].restingOrderQueuePosition, 1);
  assert.equal(trades[1].restingOrderQueuePosition, 1);
});

test('two buy orders at the same price fill oldest first on an incoming sell', () => {
  const { orderBook, matchingEngine } = createEngine();
  const firstBid = addRestingOrder(orderBook, {
    id: 'BID-1',
    side: 'buy',
    price: 100,
    quantity: 50,
    tick: 1,
  });
  const secondBid = addRestingOrder(orderBook, {
    id: 'BID-2',
    side: 'buy',
    price: 100,
    quantity: 50,
    tick: 2,
  });

  const incomingSell = createOrder({
    id: 'SELL-1',
    side: 'sell',
    type: 'market',
    size: 60,
    agentId: 'seller',
    tick: 3,
  });

  const { trades } = matchingEngine.processOrder(incomingSell, 3, {
    midPrice: 100,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  assert.deepEqual(
    trades.map((trade) => ({ buyOrderId: trade.buyOrderId, quantity: trade.quantity })),
    [
      { buyOrderId: 'BID-1', quantity: 50 },
      { buyOrderId: 'BID-2', quantity: 10 },
    ]
  );
  assert.equal(firstBid.status, ORDER_STATUS.FILLED);
  assert.equal(secondBid.status, ORDER_STATUS.PARTIALLY_FILLED);
  assert.equal(secondBid.remainingQuantity, 40);
  assert.deepEqual(getLevelOrderIds(orderBook, 'buy', 100), ['BID-2']);
});

test('partial fill of the oldest resting order keeps it at the front and blocks younger orders', () => {
  const { orderBook, matchingEngine } = createEngine();
  const firstAsk = addRestingOrder(orderBook, {
    id: 'ASK-1',
    side: 'sell',
    price: 100,
    quantity: 50,
    tick: 1,
  });
  const secondAsk = addRestingOrder(orderBook, {
    id: 'ASK-2',
    side: 'sell',
    price: 100,
    quantity: 50,
    tick: 2,
  });

  const incomingBuy = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'market',
    size: 20,
    agentId: 'buyer',
    tick: 3,
  });

  const { trades } = matchingEngine.processOrder(incomingBuy, 3, {
    midPrice: 100,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  assert.deepEqual(
    trades.map((trade) => ({ sellOrderId: trade.sellOrderId, quantity: trade.quantity })),
    [{ sellOrderId: 'ASK-1', quantity: 20 }]
  );
  assert.equal(firstAsk.remainingQuantity, 30);
  assert.equal(secondAsk.remainingQuantity, 50);
  assert.deepEqual(getLevelOrderIds(orderBook, 'sell', 100), ['ASK-1', 'ASK-2']);
  assert.deepEqual(orderBook.getQueuePosition('ASK-1'), {
    position: 1,
    levelOrderCount: 2,
    levelPrice: 100,
    levelSize: 80,
    side: 'sell',
    timestamp: 1,
    sequenceNumber: firstAsk.sequenceNumber,
  });
  assert.equal(orderBook.getQueuePosition('ASK-2').position, 2);
});

test('market order sweeps multiple price levels and records multiple trade prints', () => {
  const { orderBook, matchingEngine } = createEngine();
  addRestingOrder(orderBook, { id: 'ASK-1', side: 'sell', price: 101, quantity: 30 });
  addRestingOrder(orderBook, { id: 'ASK-2', side: 'sell', price: 101.01, quantity: 20 });
  addRestingOrder(orderBook, { id: 'ASK-3', side: 'sell', price: 101.02, quantity: 80 });

  const incomingBuy = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'market',
    size: 100,
    agentId: 'buyer',
    tick: 1,
  });

  const { trades, summary } = matchingEngine.processOrder(incomingBuy, 1, {
    midPrice: 100.99,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  assert.deepEqual(
    trades.map((trade) => ({ price: trade.price, quantity: trade.quantity })),
    [
      { price: 101, quantity: 30 },
      { price: 101.01, quantity: 20 },
      { price: 101.02, quantity: 50 },
    ]
  );
  assert.equal(summary.levelsSwept, 3);
  assert.ok(Math.abs(summary.averageFillPrice - 101.012) < 1e-9);
});

test('aggressive limit order sweeps multiple resting orders in FIFO sequence', () => {
  const { orderBook, matchingEngine } = createEngine();
  addRestingOrder(orderBook, { id: 'ASK-1', side: 'sell', price: 101, quantity: 10, tick: 1 });
  addRestingOrder(orderBook, { id: 'ASK-2', side: 'sell', price: 101, quantity: 12, tick: 2 });
  addRestingOrder(orderBook, { id: 'ASK-3', side: 'sell', price: 101.01, quantity: 20, tick: 3 });

  const incomingBuy = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'limit',
    price: 101.01,
    size: 30,
    agentId: 'buyer',
    tick: 4,
  });

  const { trades } = matchingEngine.processOrder(incomingBuy, 4, {
    midPrice: 101,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  assert.deepEqual(
    trades.map((trade) => ({ sellOrderId: trade.sellOrderId, price: trade.price, quantity: trade.quantity })),
    [
      { sellOrderId: 'ASK-1', price: 101, quantity: 10 },
      { sellOrderId: 'ASK-2', price: 101, quantity: 12 },
      { sellOrderId: 'ASK-3', price: 101.01, quantity: 8 },
    ]
  );
  assert.deepEqual(getLevelOrderIds(orderBook, 'sell', 101.01), ['ASK-3']);
});

test('partially filled limit order leaves its remainder resting in the book', () => {
  const { orderBook, matchingEngine } = createEngine();
  addRestingOrder(orderBook, { id: 'ASK-1', side: 'sell', price: 100, quantity: 20, tick: 1 });
  addRestingOrder(orderBook, { id: 'ASK-2', side: 'sell', price: 100.01, quantity: 10, tick: 2 });

  const incomingBuy = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'limit',
    price: 100,
    size: 50,
    agentId: 'buyer',
    tick: 5,
  });

  matchingEngine.processOrder(incomingBuy, 5, {
    midPrice: 100,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  const restingBid = orderBook.getOrder('BUY-1');
  assert.ok(restingBid);
  assert.equal(restingBid.timestamp, 5);
  assert.equal(restingBid.status, ORDER_STATUS.PARTIALLY_FILLED);
  assert.equal(restingBid.filledQuantity, 20);
  assert.equal(restingBid.remainingQuantity, 30);
  assert.equal(orderBook.bids[0].orders[0].id, 'BUY-1');
});

test('partially filled resting order keeps queue priority for later matches', () => {
  const { orderBook, matchingEngine } = createEngine();
  const firstAsk = addRestingOrder(orderBook, {
    id: 'ASK-1',
    side: 'sell',
    price: 100,
    quantity: 40,
    tick: 1,
  });
  addRestingOrder(orderBook, {
    id: 'ASK-2',
    side: 'sell',
    price: 100,
    quantity: 40,
    tick: 2,
  });

  const firstSweep = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'market',
    size: 30,
    agentId: 'buyer-1',
    tick: 3,
  });
  matchingEngine.processOrder(firstSweep, 3, {
    midPrice: 100,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  const secondSweep = createOrder({
    id: 'BUY-2',
    side: 'buy',
    type: 'market',
    size: 15,
    agentId: 'buyer-2',
    tick: 4,
  });
  const { trades } = matchingEngine.processOrder(secondSweep, 4, {
    midPrice: 100,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  assert.deepEqual(
    trades.map((trade) => ({ sellOrderId: trade.sellOrderId, quantity: trade.quantity })),
    [
      { sellOrderId: 'ASK-1', quantity: 10 },
      { sellOrderId: 'ASK-2', quantity: 5 },
    ]
  );
  assert.equal(firstAsk.status, ORDER_STATUS.FILLED);
  assert.equal(orderBook.asks[0].orders[0].id, 'ASK-2');
});

test('cancellation preserves the queue order of the remaining resting orders', () => {
  const { orderBook, matchingEngine } = createEngine();
  addRestingOrder(orderBook, { id: 'ASK-1', side: 'sell', price: 100, quantity: 10, tick: 1 });
  addRestingOrder(orderBook, { id: 'ASK-2', side: 'sell', price: 100, quantity: 10, tick: 2 });
  addRestingOrder(orderBook, { id: 'ASK-3', side: 'sell', price: 100, quantity: 10, tick: 3 });

  orderBook.cancelOrder('ASK-2');

  assert.deepEqual(getLevelOrderIds(orderBook, 'sell', 100), ['ASK-1', 'ASK-3']);
  assert.equal(orderBook.getQueuePosition('ASK-3').position, 2);

  const incomingBuy = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'market',
    size: 15,
    agentId: 'buyer',
    tick: 4,
  });

  const { trades } = matchingEngine.processOrder(incomingBuy, 4, {
    midPrice: 100,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  assert.deepEqual(
    trades.map((trade) => ({ sellOrderId: trade.sellOrderId, quantity: trade.quantity })),
    [
      { sellOrderId: 'ASK-1', quantity: 10 },
      { sellOrderId: 'ASK-3', quantity: 5 },
    ]
  );
});

test('market order with insufficient liquidity fills as much as possible and does not rest', () => {
  const { orderBook, matchingEngine } = createEngine();
  addRestingOrder(orderBook, { id: 'ASK-1', side: 'sell', price: 100, quantity: 20 });
  addRestingOrder(orderBook, { id: 'ASK-2', side: 'sell', price: 100.01, quantity: 10 });

  const incomingBuy = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'market',
    size: 50,
    agentId: 'buyer',
    tick: 1,
  });

  matchingEngine.processOrder(incomingBuy, 1, {
    midPrice: 100,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  assert.equal(incomingBuy.status, ORDER_STATUS.PARTIALLY_FILLED);
  assert.equal(incomingBuy.filledQuantity, 30);
  assert.equal(incomingBuy.remainingQuantity, 20);
  assert.equal(orderBook.getOrder('BUY-1'), undefined);
  assert.equal(orderBook.asks.length, 0);
});

test('exactly matched order fully fills and leaves no remainder', () => {
  const { orderBook, matchingEngine } = createEngine();
  const restingAsk = addRestingOrder(orderBook, {
    id: 'ASK-1',
    side: 'sell',
    price: 100,
    quantity: 20,
  });
  const incomingBuy = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'limit',
    price: 100,
    size: 20,
    agentId: 'buyer',
    tick: 1,
  });

  const { trades } = matchingEngine.processOrder(incomingBuy, 1, {
    midPrice: 100,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  assert.equal(trades.length, 1);
  assert.equal(incomingBuy.status, ORDER_STATUS.FILLED);
  assert.equal(restingAsk.status, ORDER_STATUS.FILLED);
  assert.equal(orderBook.asks.length, 0);
  assert.equal(orderBook.bids.length, 0);
});

test('identical timestamps use sequence number as a deterministic tie-breaker', () => {
  const { orderBook, matchingEngine } = createEngine();
  const firstAsk = createOrder({
    id: 'ASK-1',
    side: 'sell',
    type: 'limit',
    price: 100,
    size: 10,
    agentId: 'seller-1',
    tick: 1,
    timestamp: 1,
  });
  const secondAsk = createOrder({
    id: 'ASK-2',
    side: 'sell',
    type: 'limit',
    price: 100,
    size: 10,
    agentId: 'seller-2',
    tick: 1,
    timestamp: 1,
  });

  orderBook.addOrder(firstAsk);
  orderBook.addOrder(secondAsk);

  const incomingBuy = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'market',
    size: 15,
    agentId: 'buyer',
    tick: 2,
  });

  const { trades } = matchingEngine.processOrder(incomingBuy, 2, {
    midPrice: 100,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });

  assert.deepEqual(
    trades.map((trade) => ({ sellOrderId: trade.sellOrderId, quantity: trade.quantity })),
    [
      { sellOrderId: 'ASK-1', quantity: 10 },
      { sellOrderId: 'ASK-2', quantity: 5 },
    ]
  );
  assert.ok(firstAsk.sequenceNumber < secondAsk.sequenceNumber);
  assert.equal(orderBook.getQueuePosition('ASK-2').position, 1);
});

test('metrics trade tape keeps separate prints for a multi-fill sweep', () => {
  const { orderBook, matchingEngine } = createEngine();
  const metrics = new MetricsEngine({ ticksPerCandle: 100 });
  addRestingOrder(orderBook, { id: 'ASK-1', side: 'sell', price: 101, quantity: 10 });
  addRestingOrder(orderBook, { id: 'ASK-2', side: 'sell', price: 101.01, quantity: 15 });
  addRestingOrder(orderBook, { id: 'ASK-3', side: 'sell', price: 101.02, quantity: 25 });

  const incomingBuy = createOrder({
    id: 'BUY-1',
    side: 'buy',
    type: 'market',
    size: 40,
    agentId: 'buyer',
    tick: 10,
  });

  const { trades } = matchingEngine.processOrder(incomingBuy, 10, {
    midPrice: 101,
    spread: 0.01,
    volatility: 0,
    priceVelocity: 0,
  });
  metrics.processTrades(10, trades);

  assert.equal(metrics.recentTrades.length, 3);
  assert.deepEqual(
    metrics.recentTrades.map((trade) => trade.quantity),
    [10, 15, 15]
  );
});
