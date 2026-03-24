/**
 * Order Book — maintains bid and ask sides with price-time priority.
 *
 * Bids sorted descending (best bid = highest price first).
 * Asks sorted ascending (best ask = lowest price first).
 * Each price level holds a FIFO queue of orders.
 */

let nextOrderId = 1;
let nextSequenceNumber = 1;

export const ORDER_STATUS = {
  OPEN: 'open',
  PARTIALLY_FILLED: 'partially_filled',
  FILLED: 'filled',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

function clampQuantity(value) {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

function clampSequenceNumber(value) {
  return Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0);
}

function toCanonicalStatus(status) {
  if (status === 'partial') return ORDER_STATUS.PARTIALLY_FILLED;
  return status;
}

function deriveOrderStatus(order) {
  if (order.remainingQuantity <= 0) return ORDER_STATUS.FILLED;
  if (order.filledQuantity > 0) return ORDER_STATUS.PARTIALLY_FILLED;
  return ORDER_STATUS.OPEN;
}

export function normalizeOrderFields(order) {
  const quantity = clampQuantity(order.quantity ?? order.size);
  let filledQuantity = order.filledQuantity;
  let remainingQuantity = order.remainingQuantity ?? order.remainingSize;

  if (!Number.isFinite(filledQuantity) && !Number.isFinite(remainingQuantity)) {
    filledQuantity = 0;
    remainingQuantity = quantity;
  } else if (!Number.isFinite(filledQuantity)) {
    remainingQuantity = clampQuantity(remainingQuantity);
    filledQuantity = clampQuantity(quantity - remainingQuantity);
  } else if (!Number.isFinite(remainingQuantity)) {
    filledQuantity = clampQuantity(filledQuantity);
    remainingQuantity = clampQuantity(quantity - filledQuantity);
  } else {
    filledQuantity = clampQuantity(filledQuantity);
    remainingQuantity = clampQuantity(remainingQuantity);
  }

  if (filledQuantity + remainingQuantity !== quantity) {
    remainingQuantity = clampQuantity(quantity - filledQuantity);
  }

  const timestamp = order.timestamp ?? order.createdAt ?? 0;
  const sequenceNumber = clampSequenceNumber(order.sequenceNumber ?? order.insertionIndex)
    || nextSequenceNumber++;
  const status = toCanonicalStatus(order.status);

  order.quantity = quantity;
  order.size = quantity;
  order.filledQuantity = filledQuantity;
  order.remainingQuantity = remainingQuantity;
  order.remainingSize = remainingQuantity;
  order.timestamp = timestamp;
  order.createdAt = timestamp;
  order.sequenceNumber = sequenceNumber;
  order.insertionIndex = sequenceNumber;

  if (status === ORDER_STATUS.CANCELLED || status === ORDER_STATUS.EXPIRED) {
    order.status = status;
  } else {
    order.status = deriveOrderStatus(order);
  }

  return order;
}

export function updateOrderAfterFill(order, executedQuantity) {
  normalizeOrderFields(order);

  const actualFill = Math.min(order.remainingQuantity, clampQuantity(executedQuantity));
  if (actualFill <= 0) return 0;

  order.filledQuantity += actualFill;
  order.remainingQuantity = clampQuantity(order.quantity - order.filledQuantity);
  order.remainingSize = order.remainingQuantity;
  order.status = deriveOrderStatus(order);

  return actualFill;
}

export function setOrderStatus(order, status) {
  normalizeOrderFields(order);
  order.status = toCanonicalStatus(status);
  return order;
}

export function createOrderId() {
  return `ORD-${nextOrderId++}`;
}

export function createOrderSequenceNumber() {
  return nextSequenceNumber++;
}

export function resetOrderIdCounter() {
  nextOrderId = 1;
  nextSequenceNumber = 1;
}

/**
 * Create a new order object.
 */
export function createOrder({
  id = null,
  side,
  type,
  price,
  size,
  quantity,
  agentId,
  tick,
  timestamp,
  lifetime = null,
}) {
  return normalizeOrderFields({
    id: id ?? createOrderId(),
    side,        // 'buy' | 'sell'
    type,        // 'limit' | 'market'
    price: type === 'market' ? null : price,
    quantity: quantity ?? size,
    filledQuantity: 0,
    remainingQuantity: quantity ?? size,
    agentId,
    timestamp: timestamp ?? tick,
    sequenceNumber: createOrderSequenceNumber(),
    expiresAt: lifetime != null ? tick + lifetime : null,
    status: ORDER_STATUS.OPEN,
  });
}

/**
 * Binary search for insertion index.
 * For bids (descending): finds where to insert to keep descending order.
 * For asks (ascending): finds where to insert to keep ascending order.
 */
function findPriceIndex(levels, price, descending) {
  let low = 0;
  let high = levels.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (descending ? levels[mid].price > price : levels[mid].price < price) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function compareOrderPriority(a, b) {
  normalizeOrderFields(a);
  normalizeOrderFields(b);

  if (a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp;
  }

  if (a.sequenceNumber !== b.sequenceNumber) {
    return a.sequenceNumber - b.sequenceNumber;
  }

  return String(a.id).localeCompare(String(b.id));
}

function findQueueInsertionIndex(queue, order) {
  let low = 0;
  let high = queue.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if (compareOrderPriority(queue[mid], order) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function sumLevelSize(level) {
  return level.orders.reduce((sum, order) => sum + normalizeOrderFields(order).remainingQuantity, 0);
}

function summarizeLevel(level) {
  const queuePreview = level.orders.slice(0, 5).map((order, index) => {
    normalizeOrderFields(order);
    return {
      id: order.id,
      agentId: order.agentId,
      remainingQuantity: order.remainingQuantity,
      queuePosition: index + 1,
      timestamp: order.timestamp,
      sequenceNumber: order.sequenceNumber,
    };
  });

  return {
    price: level.price,
    size: sumLevelSize(level),
    count: level.orders.length,
    frontOrderId: level.orders[0]?.id ?? null,
    frontAgentId: level.orders[0]?.agentId ?? null,
    frontTimestamp: level.orders[0]?.timestamp ?? null,
    frontSequenceNumber: level.orders[0]?.sequenceNumber ?? null,
    queuePreview,
    hasMoreInQueue: level.orders.length > queuePreview.length,
  };
}

export class OrderBook {
  constructor(tickSize = 0.01) {
    this.tickSize = tickSize;
    this.bids = [];       // [{ price, orders: [] }] sorted descending
    this.asks = [];       // [{ price, orders: [] }] sorted ascending
    this.orderMap = new Map(); // orderId -> order
    this.agentOrders = new Map(); // agentId -> Set<orderId>
  }

  /** Round price to tick size */
  roundPrice(price) {
    return Math.round(price / this.tickSize) * this.tickSize;
  }

  /** Best bid price or null */
  get bestBid() {
    return this.bids.length > 0 ? this.bids[0].price : null;
  }

  /** Best ask price or null */
  get bestAsk() {
    return this.asks.length > 0 ? this.asks[0].price : null;
  }

  /** Spread */
  get spread() {
    if (this.bestBid == null || this.bestAsk == null) return null;
    return this.bestAsk - this.bestBid;
  }

  /** Mid price */
  get midPrice() {
    if (this.bestBid == null && this.bestAsk == null) return null;
    if (this.bestBid == null) return this.bestAsk;
    if (this.bestAsk == null) return this.bestBid;
    return (this.bestBid + this.bestAsk) / 2;
  }

  /** Add a limit order to the book (after matching) */
  addOrder(order) {
    normalizeOrderFields(order);
    if (order.type !== 'limit' || order.remainingQuantity <= 0) return;
    if (this.orderMap.has(order.id)) return;

    const side = order.side === 'buy' ? this.bids : this.asks;
    const descending = order.side === 'buy';
    const price = this.roundPrice(order.price);
    order.price = price;

    const idx = findPriceIndex(side, price, descending);

    if (idx < side.length && Math.abs(side[idx].price - price) < this.tickSize / 2) {
      const queueIdx = findQueueInsertionIndex(side[idx].orders, order);
      side[idx].orders.splice(queueIdx, 0, order);
    } else {
      // New price level
      side.splice(idx, 0, { price, orders: [order] });
    }

    this.orderMap.set(order.id, order);

    if (!this.agentOrders.has(order.agentId)) {
      this.agentOrders.set(order.agentId, new Set());
    }
    this.agentOrders.get(order.agentId).add(order.id);
  }

  /** Remove a specific order from the book */
  removeOrder(orderId) {
    const order = this.orderMap.get(orderId);
    if (!order) return null;
    normalizeOrderFields(order);

    const side = order.side === 'buy' ? this.bids : this.asks;
    const price = order.price;

    for (let i = 0; i < side.length; i++) {
      if (Math.abs(side[i].price - price) < this.tickSize / 2) {
        const level = side[i];
        const orderIdx = level.orders.findIndex((levelOrder) => levelOrder.id === orderId);
        if (orderIdx !== -1) {
          level.orders.splice(orderIdx, 1);
          if (level.orders.length === 0) {
            side.splice(i, 1);
          }
        }
        break;
      }
    }

    this.orderMap.delete(orderId);
    const agentSet = this.agentOrders.get(order.agentId);
    if (agentSet) {
      agentSet.delete(orderId);
      if (agentSet.size === 0) this.agentOrders.delete(order.agentId);
    }

    return order;
  }

  /** Cancel an order */
  cancelOrder(orderId) {
    const order = this.removeOrder(orderId);
    if (order) {
      setOrderStatus(order, ORDER_STATUS.CANCELLED);
    }
    return order;
  }

  /** Remove expired orders, returns array of expired orders */
  removeExpired(currentTick) {
    const expired = [];
    for (const [orderId, order] of this.orderMap) {
      if (order.expiresAt != null && currentTick >= order.expiresAt) {
        expired.push(order);
      }
    }
    for (const order of expired) {
      this.removeOrder(order.id);
      setOrderStatus(order, ORDER_STATUS.EXPIRED);
    }
    return expired;
  }

  /** Get all order IDs for an agent */
  getAgentOrderIds(agentId) {
    const set = this.agentOrders.get(agentId);
    return set ? [...set] : [];
  }

  /** Get order by ID */
  getOrder(orderId) {
    return this.orderMap.get(orderId);
  }

  getBestBidLevel() {
    return this.bids[0] ?? null;
  }

  getBestAskLevel() {
    return this.asks[0] ?? null;
  }

  getQueuePosition(orderId) {
    const order = this.orderMap.get(orderId);
    if (!order) return null;

    normalizeOrderFields(order);
    const side = order.side === 'buy' ? this.bids : this.asks;

    for (const level of side) {
      if (Math.abs(level.price - order.price) >= this.tickSize / 2) continue;

      const position = level.orders.findIndex((levelOrder) => levelOrder.id === orderId);
      if (position === -1) continue;

      return {
        position: position + 1,
        levelOrderCount: level.orders.length,
        levelPrice: level.price,
        levelSize: sumLevelSize(level),
        side: order.side,
        timestamp: order.timestamp,
        sequenceNumber: order.sequenceNumber,
      };
    }

    return null;
  }

  /** Get depth snapshot: N best levels per side */
  getDepth(levels = 20) {
    const bidLevels = this.bids.slice(0, levels).map((level) => summarizeLevel(level));

    const askLevels = this.asks.slice(0, levels).map((level) => summarizeLevel(level));

    return { bidLevels, askLevels };
  }

  /** Get full cumulative depth for depth chart */
  getCumulativeDepth(levels = 50) {
    let cumBid = 0;
    const bidDepth = this.bids.slice(0, levels).map(l => {
      const size = sumLevelSize(l);
      cumBid += size;
      return { price: l.price, size, cumulative: cumBid };
    });

    let cumAsk = 0;
    const askDepth = this.asks.slice(0, levels).map(l => {
      const size = sumLevelSize(l);
      cumAsk += size;
      return { price: l.price, size, cumulative: cumAsk };
    });

    return { bidDepth, askDepth };
  }

  /** Total resting order count */
  get totalOrders() {
    return this.orderMap.size;
  }

  /** Total bid volume */
  get totalBidVolume() {
    let vol = 0;
    for (const level of this.bids) {
      for (const o of level.orders) vol += normalizeOrderFields(o).remainingQuantity;
    }
    return vol;
  }

  /** Total ask volume */
  get totalAskVolume() {
    let vol = 0;
    for (const level of this.asks) {
      for (const o of level.orders) vol += normalizeOrderFields(o).remainingQuantity;
    }
    return vol;
  }

  /** Clear all orders */
  clear() {
    this.bids = [];
    this.asks = [];
    this.orderMap.clear();
    this.agentOrders.clear();
  }

  /** Serialize for replay snapshots */
  snapshot() {
    return {
      bids: this.bids.map(l => ({
        price: l.price,
        orders: l.orders.map(o => ({ ...o })),
      })),
      asks: this.asks.map(l => ({
        price: l.price,
        orders: l.orders.map(o => ({ ...o })),
      })),
    };
  }
}
