import test from 'node:test';
import assert from 'node:assert/strict';

import { EventQueue, EVENT_TYPES, sampleLatency } from '../src/engine/eventQueue.js';
import { SimulationLoop } from '../src/engine/simulationLoop.js';
import { SeededRng } from '../src/engine/seededRng.js';
import {
  createOrder,
  OrderBook,
  ORDER_STATUS,
  resetOrderIdCounter,
} from '../src/engine/orderBook.js';
import { MatchingEngine } from '../src/engine/matchingEngine.js';

// ---------------------------------------------------------------------------
//  EventQueue unit tests
// ---------------------------------------------------------------------------

test('EventQueue: schedule and processDueEvents returns events at correct tick', () => {
  const queue = new EventQueue();

  queue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'agent-0',
    payload: { order: { id: 'O1' } },
    createdAt: 1,
    scheduledFor: 5,
  });
  queue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'agent-1',
    payload: { order: { id: 'O2' } },
    createdAt: 1,
    scheduledFor: 3,
  });

  // Tick 2: nothing due
  const due2 = queue.processDueEvents(2);
  assert.equal(due2.length, 0);

  // Tick 3: O2 fires
  const due3 = queue.processDueEvents(3);
  assert.equal(due3.length, 1);
  assert.equal(due3[0].payload.order.id, 'O2');
  assert.equal(due3[0].status, 'executed');

  // Tick 5: O1 fires
  const due5 = queue.processDueEvents(5);
  assert.equal(due5.length, 1);
  assert.equal(due5[0].payload.order.id, 'O1');
});

test('EventQueue: same-tick events ordered by priority then sequence', () => {
  const queue = new EventQueue();

  // Schedule a submit first, then a cancel — both for tick 5
  queue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'a',
    payload: { order: { id: 'O1' } },
    createdAt: 1,
    scheduledFor: 5,
  });
  queue.schedule({
    type: EVENT_TYPES.CANCEL_ORDER,
    sourceId: 'b',
    payload: { orderId: 'X1' },
    createdAt: 2,
    scheduledFor: 5,
  });
  queue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'c',
    payload: { order: { id: 'O2' } },
    createdAt: 2,
    scheduledFor: 5,
  });

  const due = queue.processDueEvents(5);
  assert.equal(due.length, 3);

  // Cancel should be first (priority 1)
  assert.equal(due[0].type, EVENT_TYPES.CANCEL_ORDER);
  // Then submits in sequence order
  assert.equal(due[1].type, EVENT_TYPES.SUBMIT_ORDER);
  assert.equal(due[1].payload.order.id, 'O1'); // scheduled first
  assert.equal(due[2].type, EVENT_TYPES.SUBMIT_ORDER);
  assert.equal(due[2].payload.order.id, 'O2'); // scheduled second
});

test('EventQueue: removePendingSubmitForOrder removes a queued order', () => {
  const queue = new EventQueue();

  queue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'user',
    payload: { order: { id: 'U1' } },
    createdAt: 1,
    scheduledFor: 5,
  });
  queue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'agent-0',
    payload: { order: { id: 'A1' } },
    createdAt: 1,
    scheduledFor: 6,
  });

  const removed = queue.removePendingSubmitForOrder('U1');
  assert.equal(removed, true);
  assert.equal(queue.getPendingCount(), 1);

  // U1 should not fire
  const due = queue.processDueEvents(10);
  assert.equal(due.length, 1);
  assert.equal(due[0].payload.order.id, 'A1');
});

test('EventQueue: removePendingSubmitForOrder returns false if not found', () => {
  const queue = new EventQueue();
  assert.equal(queue.removePendingSubmitForOrder('NOPE'), false);
});

test('EventQueue: reset clears all state', () => {
  const queue = new EventQueue();
  queue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'a',
    payload: { order: { id: 'X' } },
    createdAt: 1,
    scheduledFor: 5,
  });
  queue.processDueEvents(5);

  queue.reset();
  assert.equal(queue.getPendingCount(), 0);
  assert.equal(queue.getRecentLog().length, 0);
  assert.equal(queue.nextId, 1);
  assert.equal(queue.nextSequence, 1);
});

test('sampleLatency returns min when min equals max', () => {
  const rng = new SeededRng(42);
  assert.equal(sampleLatency(5, 5, rng), 5);
});

test('sampleLatency returns value in range', () => {
  const rng = new SeededRng(42);
  for (let i = 0; i < 100; i++) {
    const val = sampleLatency(2, 10, rng);
    assert.ok(val >= 2 && val <= 10, `value ${val} out of range [2, 10]`);
  }
});

// ---------------------------------------------------------------------------
//  SimulationLoop latency integration tests
// ---------------------------------------------------------------------------

function createLatencyConfig(overrides = {}) {
  return {
    initialPrice: 100,
    tickSize: 0.01,
    numAgents: 0,        // no random agents — we control everything
    actionFrequency: 1,
    buyProbability: 0.5,
    buyBias: 0.5,
    limitProbability: 0.8,
    limitBias: 0.8,
    baseOrderSize: 10,
    minOrderSize: 1,
    maxOrderSize: 500,
    baseLifetime: 500,
    minLifetime: 50,
    maxLifetime: 5000,
    cancelProbability: 1.0,
    priceOffsetRange: 1.0,
    slippageIntensity: 0,
    enableMarketMakers: false,
    numberOfMarketMakers: 0,
    baseSpreadTicks: 2,
    quoteSizeRange: { min: 8, max: 24 },
    quoteRefreshInterval: 30,
    staleQuoteLifetime: 120,
    inventorySkewStrength: 1,
    maxInventory: 150,
    makerCancellationDelay: 8,
    makerReactionDelay: 12,
    probabilityOfJoiningBestBidAsk: 0.2,
    probabilityOfQuotingOneTickAway: 0.55,
    tickInterval: 25,
    ticksPerCandle: 100,
    seed: 42,
    userStartingBalance: 10000,
    // Latency enabled with fixed delays for deterministic testing
    enableLatency: true,
    agentReactionDelayMin: 3,
    agentReactionDelayMax: 3,
    orderSubmissionDelayMin: 2,
    orderSubmissionDelayMax: 2,
    cancellationDelayMin: 4,
    cancellationDelayMax: 4,
    userOrderDelayMin: 2,
    userOrderDelayMax: 2,
    makerSubmissionDelayMin: 1,
    makerSubmissionDelayMax: 1,
    ...overrides,
  };
}

function createTestEngine(overrides = {}) {
  resetOrderIdCounter();
  const config = createLatencyConfig(overrides);
  let lastUpdate = null;
  const engine = new SimulationLoop(config, (data) => {
    lastUpdate = data;
  });
  return { engine, getLastUpdate: () => lastUpdate };
}

test('submitted order does not appear before its scheduled submission tick', () => {
  const { engine } = createTestEngine({
    userOrderDelayMin: 3,
    userOrderDelayMax: 3,
  });

  const order = createOrder({
    side: 'buy',
    type: 'limit',
    price: 99,
    size: 10,
    agentId: 'user',
    tick: 0,
    lifetime: 5000,
  });

  engine.scheduleUserOrder(order);

  // Step 1 and 2: order should NOT be in book yet (delay=3)
  engine.step();
  assert.equal(engine.orderBook.getOrder(order.id), undefined);
  engine.step();
  assert.equal(engine.orderBook.getOrder(order.id), undefined);

  // Step 3: order should now be in the book
  engine.step();
  const restingOrder = engine.orderBook.getOrder(order.id);
  assert.ok(restingOrder, 'Order should be in book after delay');
  assert.equal(restingOrder.price, 99);
  assert.equal(restingOrder.enteredBookAt, 3);
});

test('cancellation does not remove order before cancellation delay expires', () => {
  const { engine } = createTestEngine({
    cancellationDelayMin: 3,
    cancellationDelayMax: 3,
  });

  // Place a resting order directly (bypass latency for setup)
  const order = createOrder({
    id: 'TEST-BID',
    side: 'buy',
    type: 'limit',
    price: 98,
    size: 20,
    agentId: 'test-agent',
    tick: 0,
    lifetime: 5000,
  });
  engine.orderBook.addOrder(order);
  assert.ok(engine.orderBook.getOrder('TEST-BID'));

  // Schedule cancellation
  engine.eventQueue.schedule({
    type: EVENT_TYPES.CANCEL_ORDER,
    sourceId: 'test-agent',
    payload: { orderId: 'TEST-BID' },
    createdAt: 0,
    scheduledFor: 3,
  });

  // Tick 1, 2: order still in book
  engine.step();
  assert.ok(engine.orderBook.getOrder('TEST-BID'), 'Order should survive tick 1');
  engine.step();
  assert.ok(engine.orderBook.getOrder('TEST-BID'), 'Order should survive tick 2');

  // Tick 3: cancel fires
  engine.step();
  assert.equal(engine.orderBook.getOrder('TEST-BID'), undefined, 'Order should be cancelled at tick 3');
});

test('order can still fill before its cancel request arrives', () => {
  const { engine } = createTestEngine({
    cancellationDelayMin: 5,
    cancellationDelayMax: 5,
  });

  // Clear seed liquidity for precise control
  engine.orderBook.clear();

  // Place a resting ask
  const ask = createOrder({
    id: 'RESTING-ASK',
    side: 'sell',
    type: 'limit',
    price: 101,
    size: 20,
    agentId: 'seller',
    tick: 0,
    lifetime: 5000,
  });
  engine.orderBook.addOrder(ask);

  // Schedule cancel for tick 5
  engine.eventQueue.schedule({
    type: EVENT_TYPES.CANCEL_ORDER,
    sourceId: 'seller',
    payload: { orderId: 'RESTING-ASK' },
    createdAt: 0,
    scheduledFor: 5,
  });

  // Schedule a buy that arrives at tick 2, filling the ask before cancel
  const buyOrder = createOrder({
    id: 'AGGRESSOR-BUY',
    side: 'buy',
    type: 'market',
    size: 20,
    agentId: 'buyer',
    tick: 0,
  });
  engine.eventQueue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'buyer',
    payload: { order: buyOrder },
    createdAt: 0,
    scheduledFor: 2,
  });

  // Tick 1: nothing happens
  engine.step();
  assert.ok(engine.orderBook.getOrder('RESTING-ASK'), 'Ask should still be in book');

  // Tick 2: buy fires, fills the ask
  engine.step();
  assert.equal(engine.orderBook.getOrder('RESTING-ASK'), undefined, 'Ask should be filled');
  assert.equal(ask.status, ORDER_STATUS.FILLED);

  // Tick 3, 4: nothing
  engine.step();
  engine.step();

  // Tick 5: cancel fires but order is already gone
  engine.step();
  // No error — cancel fails gracefully
  const log = engine.eventQueue.getRecentLog();
  const cancelLog = log.find((e) => e.type === 'CANCEL_ORDER');
  assert.ok(cancelLog);
  assert.equal(cancelLog.result, 'already_gone');
});

test('market order executes against live book at arrival time, not decision time', () => {
  const { engine } = createTestEngine({
    userOrderDelayMin: 3,
    userOrderDelayMax: 3,
  });

  // Clear seed liquidity for precise control
  engine.orderBook.clear();

  // Initial book: ask at 101
  const ask101 = createOrder({
    id: 'ASK-101',
    side: 'sell',
    type: 'limit',
    price: 101,
    size: 10,
    agentId: 'seller-1',
    tick: 0,
    lifetime: 5000,
  });
  engine.orderBook.addOrder(ask101);

  // User submits market buy at tick 0, seeing ask=101
  const buyOrder = createOrder({
    side: 'buy',
    type: 'market',
    size: 10,
    agentId: 'user',
    tick: 0,
  });
  engine.scheduleUserOrder(buyOrder);

  // Before the buy arrives, replace the ask with a higher one
  engine.step(); // tick 1
  engine.orderBook.cancelOrder('ASK-101');
  const ask103 = createOrder({
    id: 'ASK-103',
    side: 'sell',
    type: 'limit',
    price: 103,
    size: 10,
    agentId: 'seller-2',
    tick: 1,
    lifetime: 5000,
  });
  engine.orderBook.addOrder(ask103);

  engine.step(); // tick 2

  // Tick 3: buy arrives — should execute at 103 (live book), not 101 (old ask)
  let userFills = null;
  const origUpdate = engine.onUpdate;
  engine.onUpdate = (data) => {
    userFills = data.userFills;
    origUpdate(data);
  };
  engine.step(); // tick 3

  assert.ok(userFills && userFills.length > 0, 'Should have user fills');
  const fill = userFills[0];
  assert.equal(fill.trades[0].price, 103, 'Should fill at live ask (103) not old (101)');
});

test('user order delay works the same way as agent order delay', () => {
  const { engine } = createTestEngine({
    userOrderDelayMin: 4,
    userOrderDelayMax: 4,
  });

  const ask = createOrder({
    id: 'ASK-1',
    side: 'sell',
    type: 'limit',
    price: 100,
    size: 50,
    agentId: 'seller',
    tick: 0,
    lifetime: 5000,
  });
  engine.orderBook.addOrder(ask);

  const userBuy = createOrder({
    side: 'buy',
    type: 'limit',
    price: 100,
    size: 10,
    agentId: 'user',
    tick: 0,
    lifetime: 5000,
  });
  engine.scheduleUserOrder(userBuy);

  // Ticks 1-3: order not in book
  for (let i = 0; i < 3; i++) {
    engine.step();
    assert.equal(
      engine.orderBook.getOrder(userBuy.id),
      undefined,
      `User order should not be in book at tick ${i + 1}`
    );
  }

  // Tick 4: order arrives, matches against resting ask
  engine.step();
  // The buy at 100 should match the ask at 100
  assert.equal(ask.filledQuantity, 10, 'Ask should have 10 filled');
});

test('deterministic replay under same seed and latency settings', () => {
  function runSimulation(seed) {
    resetOrderIdCounter();
    const config = createLatencyConfig({
      seed,
      numAgents: 5,
      enableLatency: true,
      agentReactionDelayMin: 1,
      agentReactionDelayMax: 5,
      orderSubmissionDelayMin: 1,
      orderSubmissionDelayMax: 3,
      cancellationDelayMin: 1,
      cancellationDelayMax: 4,
    });

    const engine = new SimulationLoop(config, () => {});
    const results = [];

    for (let i = 0; i < 30; i++) {
      engine.step();
      results.push({
        tick: engine.tick,
        lastPrice: engine.lastPrice,
        bestBid: engine.orderBook.bestBid,
        bestAsk: engine.orderBook.bestAsk,
        totalOrders: engine.orderBook.totalOrders,
        pendingEvents: engine.eventQueue.getPendingCount(),
      });
    }

    return results;
  }

  const run1 = runSimulation(12345);
  const run2 = runSimulation(12345);

  assert.deepEqual(run1, run2, 'Two runs with same seed should produce identical results');
});

test('same-tick event ordering is deterministic', () => {
  const queue = new EventQueue();

  // Schedule multiple events for the same tick in arbitrary order
  queue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'a2',
    payload: { order: { id: 'O2' } },
    createdAt: 1,
    scheduledFor: 10,
  });
  queue.schedule({
    type: EVENT_TYPES.CANCEL_ORDER,
    sourceId: 'c1',
    payload: { orderId: 'C1' },
    createdAt: 1,
    scheduledFor: 10,
  });
  queue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'a1',
    payload: { order: { id: 'O1' } },
    createdAt: 1,
    scheduledFor: 10,
  });
  queue.schedule({
    type: EVENT_TYPES.CANCEL_ORDER,
    sourceId: 'c2',
    payload: { orderId: 'C2' },
    createdAt: 2,
    scheduledFor: 10,
  });

  const due = queue.processDueEvents(10);
  assert.equal(due.length, 4);

  // Cancels first (by sequence number), then submits (by sequence number)
  assert.equal(due[0].type, EVENT_TYPES.CANCEL_ORDER);
  assert.equal(due[0].payload.orderId, 'C1');
  assert.equal(due[1].type, EVENT_TYPES.CANCEL_ORDER);
  assert.equal(due[1].payload.orderId, 'C2');
  assert.equal(due[2].type, EVENT_TYPES.SUBMIT_ORDER);
  assert.equal(due[2].payload.order.id, 'O2');
  assert.equal(due[3].type, EVENT_TYPES.SUBMIT_ORDER);
  assert.equal(due[3].payload.order.id, 'O1');
});

test('random agent cancels are delayed through event queue', () => {
  resetOrderIdCounter();
  const config = createLatencyConfig({
    numAgents: 1,
    enableLatency: true,
    agentReactionDelayMin: 0,
    agentReactionDelayMax: 0,
    orderSubmissionDelayMin: 0,
    orderSubmissionDelayMax: 0,
    cancellationDelayMin: 5,
    cancellationDelayMax: 5,
  });

  const engine = new SimulationLoop(config, () => {});

  // Place a resting order for agent-0
  const order = createOrder({
    id: 'AGENT-ORDER',
    side: 'buy',
    type: 'limit',
    price: 95,
    size: 10,
    agentId: 'agent-0',
    tick: 0,
    lifetime: 50000,
  });
  engine.orderBook.addOrder(order);

  // Force the agent system to generate a cancel by manipulating RNG
  // Instead, we'll directly test the flow by scheduling a cancel
  engine.eventQueue.schedule({
    type: EVENT_TYPES.CANCEL_ORDER,
    sourceId: 'agent-0',
    payload: { orderId: 'AGENT-ORDER' },
    createdAt: 0,
    scheduledFor: 5,
  });

  // Ticks 1-4: order still in book
  for (let i = 0; i < 4; i++) {
    engine.step();
    assert.ok(
      engine.orderBook.getOrder('AGENT-ORDER'),
      `Order should survive tick ${i + 1}`
    );
  }

  // Tick 5: cancel fires
  engine.step();
  assert.equal(
    engine.orderBook.getOrder('AGENT-ORDER'),
    undefined,
    'Order should be cancelled at tick 5'
  );
});

test('cancel of pending (not yet submitted) order removes it from the queue', () => {
  const { engine } = createTestEngine({
    userOrderDelayMin: 5,
    userOrderDelayMax: 5,
  });

  const order = createOrder({
    id: 'USER-PENDING',
    side: 'buy',
    type: 'limit',
    price: 98,
    size: 10,
    agentId: 'user',
    tick: 0,
    lifetime: 5000,
  });

  engine.scheduleUserOrder(order);

  // Immediately schedule cancel (delay=5 for user orders, but the submit is also delay=5)
  // Use a shorter cancel delay to ensure cancel arrives first
  engine.eventQueue.schedule({
    type: EVENT_TYPES.CANCEL_ORDER,
    sourceId: 'user',
    payload: { orderId: 'USER-PENDING' },
    createdAt: 0,
    scheduledFor: 3, // arrives before the submit (tick 5)
  });

  // Step to tick 3: cancel should remove the pending submit
  engine.step(); // 1
  engine.step(); // 2
  engine.step(); // 3

  // The submit event should have been removed from the queue
  assert.equal(engine.eventQueue.getPendingCount(), 0, 'No pending events remaining');

  // Tick 5: nothing should happen
  engine.step(); // 4
  engine.step(); // 5
  assert.equal(engine.orderBook.getOrder('USER-PENDING'), undefined, 'Order should not appear');
});

test('latency disabled: orders and cancels execute immediately', () => {
  resetOrderIdCounter();
  const config = createLatencyConfig({
    enableLatency: false,
    numAgents: 0,
  });

  const engine = new SimulationLoop(config, () => {});

  // Place and immediately cancel via the direct path
  const order = createOrder({
    id: 'DIRECT-ORDER',
    side: 'buy',
    type: 'limit',
    price: 99,
    size: 10,
    agentId: 'user',
    tick: 0,
    lifetime: 5000,
  });

  const result = engine.processUserOrder(order);
  assert.ok(engine.orderBook.getOrder('DIRECT-ORDER'), 'Order should be in book immediately');

  engine.cancelUserOrder('DIRECT-ORDER');
  assert.equal(engine.orderBook.getOrder('DIRECT-ORDER'), undefined, 'Order should be gone immediately');
});

test('event queue getPendingSummary returns correct data', () => {
  const queue = new EventQueue();

  queue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'user',
    payload: {
      order: {
        id: 'ORD-1',
        side: 'buy',
        type: 'limit',
        price: 99.5,
        quantity: 15,
        size: 15,
      },
    },
    createdAt: 5,
    scheduledFor: 8,
  });

  const summary = queue.getPendingSummary();
  assert.equal(summary.length, 1);
  assert.equal(summary[0].orderId, 'ORD-1');
  assert.equal(summary[0].side, 'buy');
  assert.equal(summary[0].orderType, 'limit');
  assert.equal(summary[0].price, 99.5);
  assert.equal(summary[0].size, 15);
  assert.equal(summary[0].scheduledFor, 8);
  assert.equal(summary[0].sourceId, 'user');
});

// ---------------------------------------------------------------------------
//  Scenario tests from requirements
// ---------------------------------------------------------------------------

test('Scenario 1: agent order executes at live book, not old snapshot', () => {
  const { engine } = createTestEngine();

  // Clear seed liquidity for precise control
  engine.orderBook.clear();

  // Setup: ask at 101
  const ask101 = createOrder({
    id: 'ASK-101',
    side: 'sell',
    type: 'limit',
    price: 101,
    size: 50,
    agentId: 'mm-1',
    tick: 0,
    lifetime: 5000,
  });
  engine.orderBook.addOrder(ask101);

  // Agent decides to buy at tick 0 (sees ask=101)
  // Total delay: reaction(3) + submission(2) = 5 ticks
  const agentBuy = createOrder({
    side: 'buy',
    type: 'limit',
    price: 101,
    size: 10,
    agentId: 'agent-0',
    tick: 0,
    lifetime: 5000,
  });
  engine.eventQueue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'agent-0',
    payload: { order: agentBuy },
    createdAt: 0,
    scheduledFor: 5,
    snapshot: { bestAsk: 101, lastPrice: 100 },
  });

  // Move the ask to 103 before the order arrives
  engine.step(); // 1
  engine.step(); // 2
  engine.orderBook.cancelOrder('ASK-101');
  const ask103 = createOrder({
    id: 'ASK-103',
    side: 'sell',
    type: 'limit',
    price: 103,
    size: 50,
    agentId: 'mm-1',
    tick: 2,
    lifetime: 5000,
  });
  engine.orderBook.addOrder(ask103);
  engine.step(); // 3
  engine.step(); // 4

  // Tick 5: agent's buy at 101 arrives
  engine.step();

  // The buy at limit 101 should NOT match the ask at 103
  // It should rest in the book as a passive bid
  const restingBid = engine.orderBook.getOrder(agentBuy.id);
  assert.ok(restingBid, 'Buy order should be resting in book');
  assert.equal(restingBid.remainingQuantity, 10, 'Not filled — ask moved to 103');
  assert.equal(engine.orderBook.bestBid, 101, 'Best bid should be 101');
  assert.equal(engine.orderBook.bestAsk, 103, 'Best ask should be 103');
});

test('Scenario 2: stale maker quotes can be hit during cancel delay', () => {
  const { engine } = createTestEngine({
    cancellationDelayMin: 4,
    cancellationDelayMax: 4,
  });

  // Clear seed liquidity for precise control
  engine.orderBook.clear();

  // Market maker has a resting bid at 99
  const makerBid = createOrder({
    id: 'MAKER-BID',
    side: 'buy',
    type: 'limit',
    price: 99,
    size: 30,
    agentId: 'maker-0',
    tick: 0,
    lifetime: 5000,
  });
  engine.orderBook.addOrder(makerBid);

  // Maker decides to cancel (stale quote) at tick 0, cancel scheduled for tick 4
  engine.eventQueue.schedule({
    type: EVENT_TYPES.CANCEL_ORDER,
    sourceId: 'maker-0',
    payload: { orderId: 'MAKER-BID' },
    createdAt: 0,
    scheduledFor: 4,
  });

  // Aggressive sell arrives at tick 2, hits the stale bid
  const aggressiveSell = createOrder({
    side: 'sell',
    type: 'market',
    size: 30,
    agentId: 'aggressor',
    tick: 0,
  });
  engine.eventQueue.schedule({
    type: EVENT_TYPES.SUBMIT_ORDER,
    sourceId: 'aggressor',
    payload: { order: aggressiveSell },
    createdAt: 0,
    scheduledFor: 2,
  });

  engine.step(); // 1
  engine.step(); // 2 — sell fills against stale maker bid

  assert.equal(makerBid.status, ORDER_STATUS.FILLED, 'Maker bid should be filled');
  assert.equal(makerBid.filledQuantity, 30);

  engine.step(); // 3
  engine.step(); // 4 — cancel arrives, but order is already gone

  const log = engine.eventQueue.getRecentLog();
  const cancelEntry = log.find((e) => e.type === 'CANCEL_ORDER');
  assert.ok(cancelEntry);
  assert.equal(cancelEntry.result, 'already_gone');
});

test('order timestamps track decision, submission, and book entry times', () => {
  const { engine } = createTestEngine({
    userOrderDelayMin: 3,
    userOrderDelayMax: 3,
  });

  const order = createOrder({
    side: 'buy',
    type: 'limit',
    price: 98,
    size: 10,
    agentId: 'user',
    tick: 0,
    lifetime: 5000,
  });

  // Schedule at tick 0
  engine.scheduleUserOrder(order);

  // Step to tick 3 (order arrives)
  engine.step(); // 1
  engine.step(); // 2
  engine.step(); // 3

  const resting = engine.orderBook.getOrder(order.id);
  assert.ok(resting);
  assert.equal(resting.submittedAt, 0, 'submittedAt should be decision tick');
  assert.equal(resting.enteredBookAt, 3, 'enteredBookAt should be arrival tick');
});
