/**
 * Order Book — maintains bid and ask sides with price-time priority.
 *
 * Bids sorted descending (best bid = highest price first).
 * Asks sorted ascending (best ask = lowest price first).
 * Each price level holds a FIFO queue of orders.
 */

let nextOrderId = 1;

export function createOrderId() {
  return `ORD-${nextOrderId++}`;
}

export function resetOrderIdCounter() {
  nextOrderId = 1;
}

/**
 * Create a new order object.
 */
export function createOrder({
  side,
  type,
  price,
  size,
  agentId,
  tick,
  lifetime = null,
}) {
  const id = createOrderId();
  return {
    id,
    side,        // 'buy' | 'sell'
    type,        // 'limit' | 'market'
    price: type === 'market' ? null : price,
    size,
    remainingSize: size,
    agentId,
    createdAt: tick,
    expiresAt: lifetime != null ? tick + lifetime : null,
    status: 'open', // 'open' | 'partial' | 'filled' | 'cancelled' | 'expired'
  };
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
    if (order.type !== 'limit' || order.remainingSize <= 0) return;

    const side = order.side === 'buy' ? this.bids : this.asks;
    const descending = order.side === 'buy';
    const price = this.roundPrice(order.price);
    order.price = price;

    const idx = findPriceIndex(side, price, descending);

    if (idx < side.length && Math.abs(side[idx].price - price) < this.tickSize / 2) {
      // Price level exists — append to queue
      side[idx].orders.push(order);
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

    const side = order.side === 'buy' ? this.bids : this.asks;
    const price = order.price;

    for (let i = 0; i < side.length; i++) {
      if (Math.abs(side[i].price - price) < this.tickSize / 2) {
        const level = side[i];
        const orderIdx = level.orders.indexOf(order);
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
      order.status = 'cancelled';
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
      order.status = 'expired';
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

  /** Get depth snapshot: N best levels per side */
  getDepth(levels = 20) {
    const bidLevels = this.bids.slice(0, levels).map(l => ({
      price: l.price,
      size: l.orders.reduce((sum, o) => sum + o.remainingSize, 0),
      count: l.orders.length,
    }));

    const askLevels = this.asks.slice(0, levels).map(l => ({
      price: l.price,
      size: l.orders.reduce((sum, o) => sum + o.remainingSize, 0),
      count: l.orders.length,
    }));

    return { bidLevels, askLevels };
  }

  /** Get full cumulative depth for depth chart */
  getCumulativeDepth(levels = 50) {
    let cumBid = 0;
    const bidDepth = this.bids.slice(0, levels).map(l => {
      const size = l.orders.reduce((sum, o) => sum + o.remainingSize, 0);
      cumBid += size;
      return { price: l.price, size, cumulative: cumBid };
    });

    let cumAsk = 0;
    const askDepth = this.asks.slice(0, levels).map(l => {
      const size = l.orders.reduce((sum, o) => sum + o.remainingSize, 0);
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
      for (const o of level.orders) vol += o.remainingSize;
    }
    return vol;
  }

  /** Total ask volume */
  get totalAskVolume() {
    let vol = 0;
    for (const level of this.asks) {
      for (const o of level.orders) vol += o.remainingSize;
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
