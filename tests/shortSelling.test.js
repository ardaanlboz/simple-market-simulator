import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultConfig } from '../src/data/defaultConfig.js';
import { MatchingEngine } from '../src/engine/matchingEngine.js';
import {
  createOrder,
  normalizeOrderFields,
  OrderBook,
  resetOrderIdCounter,
} from '../src/engine/orderBook.js';
import {
  PortfolioManager,
  updatePositionAfterBuyFill,
  updatePositionAfterSellFill,
} from '../src/engine/portfolioManager.js';
import { SimulationLoop } from '../src/engine/simulationLoop.js';

function createShortConfig(overrides = {}) {
  return {
    ...defaultConfig,
    numAgents: 0,
    enableMarketMakers: false,
    enableLatency: false,
    slippageIntensity: 0,
    shortSellingEnabled: true,
    borrowAvailable: true,
    borrowPoolSize: 100,
    maxShortPositionPerAgent: 100,
    marginRequirement: 0,
    maxLeverage: 100,
    enableForcedCover: false,
    maintenanceMarginThreshold: 0.25,
    shortLiquidationBuffer: 0.05,
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  resetOrderIdCounter();
  const config = createShortConfig(overrides);
  const orderBook = new OrderBook(config.tickSize);
  const matchingEngine = new MatchingEngine(orderBook, config);
  const portfolioManager = new PortfolioManager(config);

  return {
    config,
    orderBook,
    matchingEngine,
    portfolioManager,
  };
}

function registerRiskAgent(portfolioManager, config, id, canShort) {
  return portfolioManager.registerAgent({
    id,
    canShort,
    startingCash: config.userStartingBalance,
  });
}

function addRestingOrder(orderBook, params) {
  const order = createOrder({
    type: 'limit',
    tick: 0,
    lifetime: 5000,
    ...params,
  });
  orderBook.addOrder(order);
  return order;
}

function processValidatedOrder(harness, order, tick = 1, marketState = {}) {
  normalizeOrderFields(order);
  const validation = harness.portfolioManager.validateOrder(order, harness.orderBook, {
    midPrice: marketState.midPrice ?? harness.config.initialPrice,
    lastPrice: marketState.lastPrice ?? marketState.midPrice ?? harness.config.initialPrice,
  });

  if (validation.acceptedQuantity <= 0) {
    return {
      trades: [],
      summary: null,
      validation,
      rejected: true,
    };
  }

  order.quantity = validation.acceptedQuantity;
  order.size = validation.acceptedQuantity;
  order.filledQuantity = 0;
  order.remainingQuantity = validation.acceptedQuantity;
  order.remainingSize = validation.acceptedQuantity;
  normalizeOrderFields(order);

  const result = harness.matchingEngine.processOrder(order, tick, {
    midPrice: marketState.midPrice ?? harness.config.initialPrice,
    lastPrice: marketState.lastPrice ?? marketState.midPrice ?? harness.config.initialPrice,
    spread: marketState.spread ?? harness.config.tickSize,
    volatility: 0,
    priceVelocity: 0,
  });

  const markPrice = result.trades.at(-1)?.price
    ?? marketState.midPrice
    ?? marketState.lastPrice
    ?? harness.config.initialPrice;
  harness.portfolioManager.applyTrades(result.trades, harness.orderBook, markPrice);
  harness.portfolioManager.rebalanceBorrowReservations(order.agentId, harness.orderBook);

  return {
    ...result,
    validation,
    rejected: false,
  };
}

test('long-only agent cannot sell below zero', () => {
  const harness = createHarness();
  const account = registerRiskAgent(harness.portfolioManager, harness.config, 'long-only', false);

  updatePositionAfterBuyFill(account, 10, 100);
  const validation = harness.portfolioManager.validateSellOrder(
    account,
    15,
    harness.orderBook,
    100
  );

  assert.equal(validation.acceptedQuantity, 10);
  assert.equal(validation.rejectedQuantity, 5);
  assert.equal(validation.reason, 'agent_cannot_short');
});

test('short-enabled agent can open a short position when borrow is available', () => {
  const harness = createHarness();
  registerRiskAgent(harness.portfolioManager, harness.config, 'shorty', true);
  addRestingOrder(harness.orderBook, {
    id: 'BID-1',
    side: 'buy',
    price: 100,
    size: 40,
    agentId: 'buyer',
  });

  const sellOrder = createOrder({
    side: 'sell',
    type: 'market',
    size: 40,
    agentId: 'shorty',
    tick: 1,
  });

  const result = processValidatedOrder(harness, sellOrder, 1, { midPrice: 100 });
  const snapshot = harness.portfolioManager.getAccountSnapshot('shorty', 100);

  assert.equal(result.validation.acceptedQuantity, 40);
  assert.equal(snapshot.position, -40);
  assert.equal(snapshot.borrowInUse, 40);
});

test('short-enabled agent cannot short when borrow is disabled', () => {
  const harness = createHarness({ borrowAvailable: false });
  registerRiskAgent(harness.portfolioManager, harness.config, 'shorty', true);
  addRestingOrder(harness.orderBook, {
    id: 'BID-1',
    side: 'buy',
    price: 100,
    size: 20,
    agentId: 'buyer',
  });

  const sellOrder = createOrder({
    side: 'sell',
    type: 'market',
    size: 20,
    agentId: 'shorty',
    tick: 1,
  });

  const result = processValidatedOrder(harness, sellOrder, 1, { midPrice: 100 });

  assert.equal(result.rejected, true);
  assert.equal(result.validation.acceptedQuantity, 0);
  assert.equal(result.trades.length, 0);
});

test('short position respects maxShortPositionPerAgent', () => {
  const harness = createHarness({ maxShortPositionPerAgent: 25 });
  registerRiskAgent(harness.portfolioManager, harness.config, 'shorty', true);
  addRestingOrder(harness.orderBook, {
    id: 'BID-1',
    side: 'buy',
    price: 100,
    size: 40,
    agentId: 'buyer',
  });

  const sellOrder = createOrder({
    side: 'sell',
    type: 'market',
    size: 40,
    agentId: 'shorty',
    tick: 1,
  });

  const result = processValidatedOrder(harness, sellOrder, 1, { midPrice: 100 });
  const snapshot = harness.portfolioManager.getAccountSnapshot('shorty', 100);

  assert.equal(result.validation.acceptedQuantity, 25);
  assert.equal(snapshot.position, -25);
});

test('borrow pool is consumed when opening shorts with resting sell orders', () => {
  const harness = createHarness({ borrowPoolSize: 50 });
  registerRiskAgent(harness.portfolioManager, harness.config, 'shorty', true);

  const sellOrder = createOrder({
    id: 'SHORT-LMT',
    side: 'sell',
    type: 'limit',
    price: 101,
    size: 30,
    agentId: 'shorty',
    tick: 1,
    lifetime: 5000,
  });

  const result = processValidatedOrder(harness, sellOrder, 1, { midPrice: 100 });

  assert.equal(result.rejected, false);
  assert.ok(harness.orderBook.getOrder('SHORT-LMT'));
  assert.equal(harness.portfolioManager.getBorrowPoolRemaining(), 20);
});

test('borrow pool is released when covering shorts', () => {
  const harness = createHarness({ borrowPoolSize: 50 });
  registerRiskAgent(harness.portfolioManager, harness.config, 'shorty', true);
  addRestingOrder(harness.orderBook, {
    id: 'BID-1',
    side: 'buy',
    price: 100,
    size: 30,
    agentId: 'buyer',
  });

  processValidatedOrder(harness, createOrder({
    side: 'sell',
    type: 'market',
    size: 30,
    agentId: 'shorty',
    tick: 1,
  }), 1, { midPrice: 100 });

  assert.equal(harness.portfolioManager.getBorrowPoolRemaining(), 20);

  addRestingOrder(harness.orderBook, {
    id: 'ASK-1',
    side: 'sell',
    price: 99,
    size: 10,
    agentId: 'seller',
  });

  processValidatedOrder(harness, createOrder({
    side: 'buy',
    type: 'market',
    size: 10,
    agentId: 'shorty',
    tick: 2,
  }), 2, { midPrice: 99 });

  assert.equal(harness.portfolioManager.getBorrowPoolRemaining(), 30);
});

test('buy orders reduce short positions correctly', () => {
  const harness = createHarness();
  const account = registerRiskAgent(harness.portfolioManager, harness.config, 'shorty', true);

  updatePositionAfterSellFill(account, 40, 100);
  updatePositionAfterBuyFill(account, 25, 95);

  const snapshot = harness.portfolioManager.getAccountSnapshot('shorty', 95);
  assert.equal(snapshot.position, -15);
  assert.equal(snapshot.realizedShortPnL, 125);
});

test('unrealized PnL for shorts updates correctly when price changes', () => {
  const harness = createHarness();
  const account = registerRiskAgent(harness.portfolioManager, harness.config, 'shorty', true);

  updatePositionAfterSellFill(account, 40, 100);

  const profitSnapshot = harness.portfolioManager.getAccountSnapshot('shorty', 90);
  const lossSnapshot = harness.portfolioManager.getAccountSnapshot('shorty', 110);

  assert.equal(profitSnapshot.unrealizedShortPnL, 400);
  assert.equal(lossSnapshot.unrealizedShortPnL, -400);
});

test('forced cover triggers when maintenance margin is breached', () => {
  const config = createShortConfig({
    userStartingBalance: 1500,
    borrowPoolSize: 200,
    enableForcedCover: true,
    maintenanceMarginThreshold: 0.25,
    shortLiquidationBuffer: 0.05,
  });
  const engine = new SimulationLoop(config, () => {});
  engine.orderBook.clear();

  addRestingOrder(engine.orderBook, {
    id: 'BID-1',
    side: 'buy',
    price: 100,
    size: 50,
    agentId: 'buyer',
  });

  engine.processUserOrder(createOrder({
    side: 'sell',
    type: 'market',
    size: 50,
    agentId: 'user',
    tick: 0,
  }));

  addRestingOrder(engine.orderBook, {
    id: 'ASK-1',
    side: 'sell',
    price: 121,
    size: 50,
    agentId: 'seller',
  });

  engine.step();

  const userSnapshot = engine.portfolioManager.getAccountSnapshot('user', 121);
  assert.ok(userSnapshot.position > -50, 'forced cover should reduce the short');
  assert.equal(engine.portfolioManager.forcedCoverCount, 1);
});

test('short selling disabled still leaves meaningful resting ask liquidity', () => {
  const config = createShortConfig({
    shortSellingEnabled: false,
    numAgents: 150,
    seed: 42,
  });
  const engine = new SimulationLoop(config, () => {});

  for (let i = 0; i < 250; i++) {
    engine.step();
  }

  const bidVolume = engine.orderBook.totalBidVolume;
  const askVolume = engine.orderBook.totalAskVolume;
  const askToBidRatio = askVolume / Math.max(1, bidVolume);
  const randomAgentPositions = engine.portfolioManager
    .getAccounts()
    .filter((account) => account.id.startsWith('agent-'))
    .map((account) => account.position);

  assert.ok(randomAgentPositions.some((position) => position > 0), 'agents should start with long inventory');
  assert.ok(bidVolume > 0, 'bid volume should exist');
  assert.ok(askVolume > 0, 'ask volume should exist');
  assert.ok(askToBidRatio > 0.5 && askToBidRatio < 2.0, `ask/bid ratio out of range: ${askToBidRatio}`);
});

test('short sell orders still obey normal order book matching rules', () => {
  const harness = createHarness();
  registerRiskAgent(harness.portfolioManager, harness.config, 'shorty', true);
  addRestingOrder(harness.orderBook, {
    id: 'BID-1',
    side: 'buy',
    price: 100,
    size: 20,
    agentId: 'buyer-1',
    tick: 1,
  });
  addRestingOrder(harness.orderBook, {
    id: 'BID-2',
    side: 'buy',
    price: 100,
    size: 30,
    agentId: 'buyer-2',
    tick: 2,
  });

  const sellOrder = createOrder({
    id: 'SHORT-MKT',
    side: 'sell',
    type: 'market',
    size: 40,
    agentId: 'shorty',
    tick: 3,
  });

  const result = processValidatedOrder(harness, sellOrder, 3, { midPrice: 100 });
  const snapshot = harness.portfolioManager.getAccountSnapshot('shorty', 100);

  assert.deepEqual(
    result.trades.map((trade) => ({ buyOrderId: trade.buyOrderId, quantity: trade.quantity })),
    [
      { buyOrderId: 'BID-1', quantity: 20 },
      { buyOrderId: 'BID-2', quantity: 20 },
    ]
  );
  assert.equal(snapshot.position, -40);
});
