/**
 * Event Queue — latency-aware event scheduler for the market simulation.
 *
 * All actions (order submissions, cancellations) pass through this queue
 * with configurable delays before affecting the order book. This creates
 * realistic stale quotes, missed fills, and delayed reactions.
 *
 * Event processing order for same-tick events:
 *   1. CANCEL_ORDER  (priority 1)
 *   2. SUBMIT_ORDER  (priority 2)
 * Ties within the same type are broken by sequence number (insertion order).
 */

export const EVENT_TYPES = {
  SUBMIT_ORDER: 'SUBMIT_ORDER',
  CANCEL_ORDER: 'CANCEL_ORDER',
};

const EVENT_PRIORITY = {
  [EVENT_TYPES.CANCEL_ORDER]: 1,
  [EVENT_TYPES.SUBMIT_ORDER]: 2,
};

export class EventQueue {
  constructor() {
    this.events = [];
    this.nextId = 1;
    this.nextSequence = 1;
    this.processedLog = [];
    this.maxLogSize = 100;
  }

  /**
   * Schedule a new event.
   * @param {Object} params
   * @param {string} params.type         - EVENT_TYPES value
   * @param {string} params.sourceId     - Agent ID or 'user'
   * @param {Object} params.payload      - Event-specific data (order object or orderId)
   * @param {number} params.createdAt    - Tick when the decision was made
   * @param {number} params.scheduledFor - Tick when the event should execute
   * @param {Object} [params.snapshot]   - Market state snapshot at decision time
   * @returns {Object} The created event entry
   */
  schedule({ type, sourceId, payload, createdAt, scheduledFor, snapshot }) {
    const entry = {
      id: this.nextId++,
      type,
      sourceId,
      payload,
      createdAt,
      scheduledFor,
      sequenceNumber: this.nextSequence++,
      status: 'pending',
      snapshot: snapshot || null,
      result: null,
      executedAt: null,
    };
    this.events.push(entry);
    return entry;
  }

  /**
   * Return and remove all events due at or before currentTick,
   * sorted deterministically by priority then sequence number.
   */
  processDueEvents(currentTick) {
    const due = [];
    const remaining = [];

    for (const event of this.events) {
      if (event.status === 'pending' && event.scheduledFor <= currentTick) {
        due.push(event);
      } else if (event.status === 'pending') {
        remaining.push(event);
      }
      // non-pending events are discarded from the live list
    }

    this.events = remaining;

    // Deterministic sort: priority first, then insertion order
    due.sort((a, b) => {
      const pa = EVENT_PRIORITY[a.type] ?? 99;
      const pb = EVENT_PRIORITY[b.type] ?? 99;
      if (pa !== pb) return pa - pb;
      return a.sequenceNumber - b.sequenceNumber;
    });

    for (const event of due) {
      event.status = 'executed';
      event.executedAt = currentTick;
    }

    this.processedLog.push(...due);
    if (this.processedLog.length > this.maxLogSize) {
      this.processedLog = this.processedLog.slice(-this.maxLogSize);
    }

    return due;
  }

  /**
   * Remove a pending SUBMIT_ORDER event for a specific orderId.
   * Used when a cancel arrives before the order reaches the book.
   * @returns {boolean} true if a pending submit was removed
   */
  removePendingSubmitForOrder(orderId) {
    const idx = this.events.findIndex(
      (e) =>
        e.status === 'pending' &&
        e.type === EVENT_TYPES.SUBMIT_ORDER &&
        e.payload?.order?.id === orderId
    );
    if (idx !== -1) {
      this.events.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** Compact summary of pending events for the UI */
  getPendingSummary() {
    return this.events
      .filter((e) => e.status === 'pending')
      .map((e) => ({
        id: e.id,
        type: e.type,
        sourceId: e.sourceId,
        createdAt: e.createdAt,
        scheduledFor: e.scheduledFor,
        orderId: e.payload?.order?.id ?? e.payload?.orderId ?? null,
        side: e.payload?.order?.side ?? null,
        orderType: e.payload?.order?.type ?? null,
        price: e.payload?.order?.price ?? null,
        size: e.payload?.order?.quantity ?? e.payload?.order?.size ?? null,
      }));
  }

  /** Number of pending events */
  getPendingCount() {
    return this.events.filter((e) => e.status === 'pending').length;
  }

  /** Recent executed events for the debug log */
  getRecentLog(count = 20) {
    return this.processedLog.slice(-count).map((e) => ({
      id: e.id,
      type: e.type,
      sourceId: e.sourceId,
      createdAt: e.createdAt,
      scheduledFor: e.scheduledFor,
      executedAt: e.executedAt,
      result: e.result ?? null,
      orderId: e.payload?.order?.id ?? e.payload?.orderId ?? null,
    }));
  }

  clear() {
    this.events = [];
    this.processedLog = [];
  }

  reset() {
    this.clear();
    this.nextId = 1;
    this.nextSequence = 1;
  }
}

/**
 * Sample a latency value uniformly between min and max (inclusive).
 * Returns an integer number of ticks.
 */
export function sampleLatency(min, max, rng) {
  const lo = Math.max(0, Math.round(min));
  const hi = Math.max(lo, Math.round(max));
  if (lo >= hi) return lo;
  return rng.int(lo, hi);
}
