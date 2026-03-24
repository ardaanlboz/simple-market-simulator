import { normalizeOrderFields } from './orderBook.js';

function clampWholeShares(value) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

function clampNonNegative(value) {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

function resolveMarkPrice(markPrice, fallbackPrice = 0) {
  if (Number.isFinite(markPrice) && markPrice > 0) return markPrice;
  if (Number.isFinite(fallbackPrice) && fallbackPrice > 0) return fallbackPrice;
  return 0;
}

function compareOrders(a, b) {
  const aCreated = a.createdAt ?? a.timestamp ?? 0;
  const bCreated = b.createdAt ?? b.timestamp ?? 0;
  if (aCreated !== bCreated) return aCreated - bCreated;

  const aSequence = a.sequenceNumber ?? a.insertionIndex ?? 0;
  const bSequence = b.sequenceNumber ?? b.insertionIndex ?? 0;
  if (aSequence !== bSequence) return aSequence - bSequence;

  return String(a.id).localeCompare(String(b.id));
}

export function calculateShortUnrealizedPnL(account, markPrice) {
  const shortSize = Math.max(0, -(account.position ?? 0));
  if (shortSize <= 0) return 0;
  return ((account.averageShortEntryPrice ?? 0) - markPrice) * shortSize;
}

export function updatePositionAfterSellFill(account, quantity, price) {
  const fillQuantity = clampWholeShares(quantity);
  if (fillQuantity <= 0) return account;

  const proceeds = price * fillQuantity;
  account.cash += proceeds;

  if (account.position > 0) {
    const closingQuantity = Math.min(fillQuantity, account.position);
    if (closingQuantity > 0) {
      const realized = (price - account.averageLongEntryPrice) * closingQuantity;
      account.realizedLongPnL += realized;
      account.position -= closingQuantity;

      if (account.position === 0) {
        account.averageLongEntryPrice = 0;
      }
    }

    const openingShortQuantity = fillQuantity - closingQuantity;
    if (openingShortQuantity > 0) {
      const newShortSize = Math.max(0, -account.position) + openingShortQuantity;
      const existingShortValue = Math.max(0, -account.position) * account.averageShortEntryPrice;
      account.position -= openingShortQuantity;
      account.averageShortEntryPrice = newShortSize > 0
        ? (existingShortValue + price * openingShortQuantity) / newShortSize
        : 0;
    }

    return account;
  }

  const existingShortSize = Math.max(0, -account.position);
  const newShortSize = existingShortSize + fillQuantity;
  account.position -= fillQuantity;
  account.averageShortEntryPrice = newShortSize > 0
    ? ((account.averageShortEntryPrice * existingShortSize) + (price * fillQuantity)) / newShortSize
    : 0;

  return account;
}

export function updatePositionAfterBuyFill(account, quantity, price) {
  const fillQuantity = clampWholeShares(quantity);
  if (fillQuantity <= 0) return account;

  const cost = price * fillQuantity;
  account.cash -= cost;

  if (account.position < 0) {
    const coveringQuantity = Math.min(fillQuantity, -account.position);
    if (coveringQuantity > 0) {
      const realized = (account.averageShortEntryPrice - price) * coveringQuantity;
      account.realizedShortPnL += realized;
      account.position += coveringQuantity;

      if (account.position === 0) {
        account.averageShortEntryPrice = 0;
      }
    }

    const openingLongQuantity = fillQuantity - coveringQuantity;
    if (openingLongQuantity > 0) {
      const newLongSize = Math.max(0, account.position) + openingLongQuantity;
      const existingLongCost = Math.max(0, account.position) * account.averageLongEntryPrice;
      account.position += openingLongQuantity;
      account.averageLongEntryPrice = newLongSize > 0
        ? (existingLongCost + price * openingLongQuantity) / newLongSize
        : 0;
    }

    return account;
  }

  const existingLongSize = Math.max(0, account.position);
  const newLongSize = existingLongSize + fillQuantity;
  account.position += fillQuantity;
  account.averageLongEntryPrice = newLongSize > 0
    ? ((account.averageLongEntryPrice * existingLongSize) + (price * fillQuantity)) / newLongSize
    : 0;

  return account;
}

function markToMarketAccount(account, markPrice) {
  const price = resolveMarkPrice(markPrice, account.lastMarkPrice ?? 0);
  const longSize = Math.max(0, account.position);
  const shortSize = Math.max(0, -account.position);

  account.unrealizedLongPnL = longSize > 0
    ? (price - account.averageLongEntryPrice) * longSize
    : 0;
  account.unrealizedShortPnL = shortSize > 0
    ? calculateShortUnrealizedPnL(account, price)
    : 0;
  account.unrealizedPnL = account.unrealizedLongPnL + account.unrealizedShortPnL;
  account.realizedPnL = account.realizedLongPnL + account.realizedShortPnL;
  account.shortPositionSize = shortSize;
  account.equity = account.cash + account.position * price;
  account.grossExposure = Math.abs(account.position) * price;
  account.marginRatio = shortSize > 0
    ? account.equity / Math.max(price * shortSize, Number.EPSILON)
    : null;
  account.leverage = account.grossExposure > 0
    ? (account.equity > 0 ? account.grossExposure / account.equity : Number.POSITIVE_INFINITY)
    : 0;
  account.lastMarkPrice = price;
  return account;
}

function createAccount({
  id,
  canShort = false,
  startingCash = 0,
  startingPosition = 0,
  startingEntryPrice = 0,
  exemptFromRiskControls = false,
  maxShortPositionOverride = null,
}) {
  const longPosition = Math.max(0, Math.floor(startingPosition));
  const shortPosition = Math.max(0, -Math.floor(startingPosition));
  const entryPrice = resolveMarkPrice(startingEntryPrice, 0);

  return markToMarketAccount({
    id,
    canShort: !!canShort,
    cash: startingCash,
    position: longPosition - shortPosition,
    averageLongEntryPrice: longPosition > 0 ? entryPrice : 0,
    averageShortEntryPrice: shortPosition > 0 ? entryPrice : 0,
    realizedLongPnL: 0,
    realizedShortPnL: 0,
    realizedPnL: 0,
    unrealizedLongPnL: 0,
    unrealizedShortPnL: 0,
    unrealizedPnL: 0,
    shortPositionSize: 0,
    equity: startingCash,
    grossExposure: 0,
    marginRatio: null,
    leverage: 0,
    reservedBorrow: 0,
    borrowInUse: 0,
    exemptFromRiskControls: !!exemptFromRiskControls,
    maxShortPositionOverride,
    lastMarkPrice: entryPrice,
  }, entryPrice);
}

export class PortfolioManager {
  constructor(config = {}) {
    this.config = config;
    this.accounts = new Map();
    this.orderReservations = new Map();
    this.forcedCoverCount = 0;
    this.lastForcedCoverTick = null;
  }

  updateConfig(newConfig = {}) {
    this.config = { ...this.config, ...newConfig };
  }

  registerAgent(options) {
    const { id } = options;
    if (!id) return null;

    const existing = this.accounts.get(id);
    if (!existing) {
      const account = createAccount(options);
      this.accounts.set(id, account);
      return account;
    }

    if (options.canShort != null) existing.canShort = !!options.canShort;
    if (options.exemptFromRiskControls != null) {
      existing.exemptFromRiskControls = !!options.exemptFromRiskControls;
    }
    if (options.maxShortPositionOverride != null) {
      existing.maxShortPositionOverride = options.maxShortPositionOverride;
    }

    return existing;
  }

  ensureAccount(id, options = {}) {
    if (!id) return null;
    return this.accounts.get(id) ?? this.registerAgent({
      id,
      canShort: true,
      exemptFromRiskControls: true,
      startingCash: options.startingCash ?? 0,
    });
  }

  getAccount(id) {
    return this.accounts.get(id) ?? null;
  }

  getAccounts() {
    return [...this.accounts.values()];
  }

  reserveBorrow(orderId, agentId, quantity) {
    const reserved = clampWholeShares(quantity);
    if (reserved <= 0) {
      this.orderReservations.delete(orderId);
      return 0;
    }

    this.orderReservations.set(orderId, {
      agentId,
      quantity: reserved,
    });
    return reserved;
  }

  releaseBorrow(orderId, quantity = null) {
    const existing = this.orderReservations.get(orderId);
    if (!existing) return 0;

    if (quantity == null) {
      this.orderReservations.delete(orderId);
      return 0;
    }

    const nextQuantity = clampWholeShares(existing.quantity - quantity);
    if (nextQuantity <= 0) {
      this.orderReservations.delete(orderId);
      return 0;
    }

    existing.quantity = nextQuantity;
    return nextQuantity;
  }

  getReservedBorrowTotal() {
    let total = 0;
    for (const reservation of this.orderReservations.values()) {
      total += reservation.quantity;
    }
    return total;
  }

  getActiveBorrowTotal() {
    return this.getAccounts().reduce((total, account) => (
      account.exemptFromRiskControls
        ? total
        : total + Math.max(0, -account.position)
    ), 0);
  }

  getBorrowPoolSize() {
    const configured = this.config.borrowPoolSize;
    if (!Number.isFinite(configured)) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.floor(configured));
  }

  getBorrowPoolRemaining() {
    const poolSize = this.getBorrowPoolSize();
    if (!Number.isFinite(poolSize)) return Number.POSITIVE_INFINITY;
    return Math.max(0, poolSize - this.getActiveBorrowTotal() - this.getReservedBorrowTotal());
  }

  getAgentOpenSellQuantity(orderBook, agentId) {
    if (!orderBook || !agentId) return 0;

    return orderBook
      .getAgentOrderIds(agentId)
      .map((orderId) => orderBook.getOrder(orderId))
      .filter(Boolean)
      .reduce((total, order) => (
        order.side === 'sell'
          ? total + normalizeOrderFields(order).remainingQuantity
          : total
      ), 0);
  }

  rebalanceBorrowReservations(agentId, orderBook) {
    if (!agentId || !orderBook) return;

    const account = this.getAccount(agentId);
    if (!account) return;

    const openSellOrders = orderBook
      .getAgentOrderIds(agentId)
      .map((orderId) => orderBook.getOrder(orderId))
      .filter((order) => order?.side === 'sell')
      .map((order) => normalizeOrderFields(order))
      .sort(compareOrders);

    let remainingLongInventory = Math.max(0, account.position);
    const seenOrderIds = new Set();
    let reservedBorrow = 0;

    for (const order of openSellOrders) {
      const longCoveredQuantity = Math.min(remainingLongInventory, order.remainingQuantity);
      const reservedShortQuantity = Math.max(0, order.remainingQuantity - longCoveredQuantity);

      remainingLongInventory -= longCoveredQuantity;
      order.reservedShortQuantity = reservedShortQuantity;
      seenOrderIds.add(order.id);
      reservedBorrow += reservedShortQuantity;

      if (reservedShortQuantity > 0) {
        this.reserveBorrow(order.id, agentId, reservedShortQuantity);
      } else {
        this.releaseBorrow(order.id);
      }
    }

    for (const [orderId, reservation] of this.orderReservations.entries()) {
      if (reservation.agentId === agentId && !seenOrderIds.has(orderId)) {
        this.orderReservations.delete(orderId);
      }
    }

    account.reservedBorrow = reservedBorrow;
    account.borrowInUse = Math.max(0, -account.position);
  }

  getAllowedShortQuantity(account, requestedQuantity, orderBook, markPrice) {
    const requested = clampWholeShares(requestedQuantity);
    if (requested <= 0) return 0;
    if (account.exemptFromRiskControls) return requested;

    const openSellQuantity = this.getAgentOpenSellQuantity(orderBook, account.id);
    const availableLongInventory = Math.max(0, account.position - openSellQuantity);
    const requestedShortQuantity = Math.max(0, requested - availableLongInventory);
    if (requestedShortQuantity <= 0) return requested;

    if (!account.canShort || !this.config.shortSellingEnabled || !this.config.borrowAvailable) {
      return availableLongInventory;
    }

    const currentProjectedShort = Math.max(0, openSellQuantity - account.position);
    const price = resolveMarkPrice(markPrice, this.config.initialPrice);
    const equity = markToMarketAccount(account, price).equity;
    const maxShortPosition = Math.max(
      0,
      Math.floor(account.maxShortPositionOverride ?? this.config.maxShortPositionPerAgent ?? Number.POSITIVE_INFINITY)
    );
    const marginRequirement = clampNonNegative(this.config.marginRequirement);
    const maxLeverage = clampNonNegative(this.config.maxLeverage);
    const borrowCapacity = this.getBorrowPoolRemaining();

    const maxShortByMargin = marginRequirement > 0
      ? (equity > 0 && price > 0
        ? Math.floor(equity / (price * marginRequirement))
        : 0)
      : Number.POSITIVE_INFINITY;
    const maxShortByLeverage = maxLeverage > 0
      ? (equity > 0 && price > 0
        ? Math.floor((equity * maxLeverage) / price)
        : 0)
      : Number.POSITIVE_INFINITY;

    const maxTotalShortAllowed = Math.min(
      maxShortPosition,
      borrowCapacity + currentProjectedShort,
      maxShortByMargin,
      maxShortByLeverage
    );
    const allowedAdditionalShort = Math.max(0, maxTotalShortAllowed - currentProjectedShort);

    return Math.min(
      requested,
      clampWholeShares(availableLongInventory + allowedAdditionalShort)
    );
  }

  validateSellOrder(account, requestedQuantity, orderBook, markPrice) {
    const requested = clampWholeShares(requestedQuantity);
    const openSellQuantity = this.getAgentOpenSellQuantity(orderBook, account.id);
    const availableLongInventory = Math.max(0, account.position - openSellQuantity);
    const requestedShortQuantity = Math.max(0, requested - availableLongInventory);
    const acceptedQuantity = this.getAllowedShortQuantity(
      account,
      requested,
      orderBook,
      markPrice
    );

    let reason = null;
    if (requestedShortQuantity > 0 && acceptedQuantity < requested) {
      if (!account.canShort) reason = 'agent_cannot_short';
      else if (!this.config.shortSellingEnabled) reason = 'short_selling_disabled';
      else if (!this.config.borrowAvailable) reason = 'borrow_unavailable';
      else if (this.getBorrowPoolRemaining() <= 0) reason = 'borrow_pool_exhausted';
      else reason = 'short_risk_limit';
    }

    return {
      requestedQuantity: requested,
      acceptedQuantity,
      rejectedQuantity: Math.max(0, requested - acceptedQuantity),
      shortQuantity: Math.max(0, acceptedQuantity - availableLongInventory),
      reason,
      wasAdjusted: acceptedQuantity !== requested,
    };
  }

  validateOrder(order, orderBook, marketState = {}) {
    normalizeOrderFields(order);
    const account = this.ensureAccount(order.agentId);

    if (order.side !== 'sell' || !account) {
      return {
        requestedQuantity: order.quantity,
        acceptedQuantity: order.quantity,
        rejectedQuantity: 0,
        shortQuantity: 0,
        reason: null,
        wasAdjusted: false,
      };
    }

    const markPrice = resolveMarkPrice(
      marketState.midPrice ?? marketState.lastPrice ?? order.price,
      this.config.initialPrice
    );

    return this.validateSellOrder(account, order.quantity, orderBook, markPrice);
  }

  applyTrades(trades, orderBook, markPrice) {
    const touchedAgentIds = new Set();
    if (!Array.isArray(trades) || trades.length === 0) return touchedAgentIds;

    for (const trade of trades) {
      if (trade.buyAgentId) {
        const buyer = this.ensureAccount(trade.buyAgentId);
        updatePositionAfterBuyFill(buyer, trade.quantity ?? trade.size, trade.price);
        touchedAgentIds.add(buyer.id);
      }

      if (trade.sellAgentId) {
        const seller = this.ensureAccount(trade.sellAgentId);
        updatePositionAfterSellFill(seller, trade.quantity ?? trade.size, trade.price);
        touchedAgentIds.add(seller.id);
      }
    }

    for (const agentId of touchedAgentIds) {
      this.rebalanceBorrowReservations(agentId, orderBook);
      const account = this.getAccount(agentId);
      if (account) {
        markToMarketAccount(account, markPrice);
      }
    }

    return touchedAgentIds;
  }

  markAllToMarket(markPrice) {
    for (const account of this.getAccounts()) {
      markToMarketAccount(account, markPrice);
      account.borrowInUse = Math.max(0, -account.position);
    }
  }

  getAccountSnapshot(agentId, markPrice) {
    const account = this.getAccount(agentId);
    if (!account) return null;

    const snapshot = markToMarketAccount(account, markPrice);
    snapshot.borrowInUse = Math.max(0, -snapshot.position);
    snapshot.avgPrice = snapshot.position > 0
      ? snapshot.averageLongEntryPrice
      : snapshot.position < 0
        ? snapshot.averageShortEntryPrice
        : 0;

    return {
      id: snapshot.id,
      canShort: snapshot.canShort,
      cash: snapshot.cash,
      position: snapshot.position,
      avgPrice: snapshot.avgPrice,
      averageLongEntryPrice: snapshot.averageLongEntryPrice,
      averageShortEntryPrice: snapshot.averageShortEntryPrice,
      realizedPnL: snapshot.realizedPnL,
      unrealizedPnL: snapshot.unrealizedPnL,
      realizedLongPnL: snapshot.realizedLongPnL,
      realizedShortPnL: snapshot.realizedShortPnL,
      unrealizedLongPnL: snapshot.unrealizedLongPnL,
      unrealizedShortPnL: snapshot.unrealizedShortPnL,
      shortPositionSize: snapshot.shortPositionSize,
      borrowInUse: snapshot.borrowInUse,
      reservedBorrow: snapshot.reservedBorrow,
      equity: snapshot.equity,
      marginRatio: snapshot.marginRatio,
      leverage: snapshot.leverage,
    };
  }

  getShortSellingSnapshot(markPrice) {
    this.markAllToMarket(markPrice);

    const riskAccounts = this.getAccounts().filter((account) => !account.exemptFromRiskControls);

    return {
      enabled: !!this.config.shortSellingEnabled,
      borrowAvailable: !!this.config.borrowAvailable,
      borrowPoolSize: this.getBorrowPoolSize(),
      borrowPoolRemaining: this.getBorrowPoolRemaining(),
      activeBorrow: this.getActiveBorrowTotal(),
      reservedBorrow: this.getReservedBorrowTotal(),
      shortEnabledAgentCount: riskAccounts.filter((account) => account.canShort).length,
      activeShortCount: riskAccounts.filter((account) => account.position < 0).length,
      forcedCoverCount: this.forcedCoverCount,
      lastForcedCoverTick: this.lastForcedCoverTick,
    };
  }

  getShortDependentSellOrders(orderBook) {
    const orders = [];

    for (const account of this.getAccounts()) {
      if (account.exemptFromRiskControls) continue;

      for (const orderId of orderBook.getAgentOrderIds(account.id)) {
        const order = orderBook.getOrder(orderId);
        if (!order || order.side !== 'sell') continue;
        normalizeOrderFields(order);
        if ((order.reservedShortQuantity ?? 0) > 0) {
          orders.push(order);
        }
      }
    }

    return orders.sort((a, b) => compareOrders(b, a));
  }

  maybeForceCover(account, markPrice) {
    if (!this.config.enableForcedCover || !account || account.exemptFromRiskControls) {
      return null;
    }

    const snapshot = this.getAccountSnapshot(account.id, markPrice);
    if (!snapshot || snapshot.position >= 0 || snapshot.shortPositionSize <= 0) return null;

    const threshold = clampNonNegative(this.config.maintenanceMarginThreshold);
    const buffer = clampNonNegative(this.config.shortLiquidationBuffer);
    const currentMarginRatio = snapshot.marginRatio ?? Number.POSITIVE_INFINITY;

    if (currentMarginRatio >= threshold) return null;

    const targetRatio = threshold + buffer;
    const price = resolveMarkPrice(markPrice, this.config.initialPrice);
    const maximumSafeShort = targetRatio > 0 && snapshot.equity > 0 && price > 0
      ? Math.floor(snapshot.equity / (price * targetRatio))
      : 0;
    const coverSize = Math.max(
      1,
      Math.min(
        snapshot.shortPositionSize,
        snapshot.shortPositionSize - Math.max(0, maximumSafeShort)
      )
    );

    return {
      agentId: account.id,
      coverSize,
      marginRatio: currentMarginRatio,
      threshold,
      targetRatio,
    };
  }

  recordForcedCover(tick) {
    this.forcedCoverCount++;
    this.lastForcedCoverTick = tick;
  }
}
