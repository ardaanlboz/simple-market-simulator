/**
 * Zustand store — bridges the simulation engine and React UI.
 *
 * Holds display state (updated from engine callbacks),
 * user trading state, and UI preferences.
 */

import { create } from 'zustand';
import { defaultConfig } from '../data/defaultConfig.js';

function createDefaultUserPortfolio(config = defaultConfig) {
  return {
    id: 'user',
    canShort: true,
    cash: config.userStartingBalance,
    position: 0,
    avgPrice: 0,
    averageLongEntryPrice: 0,
    averageShortEntryPrice: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    realizedLongPnL: 0,
    realizedShortPnL: 0,
    unrealizedLongPnL: 0,
    unrealizedShortPnL: 0,
    shortPositionSize: 0,
    borrowInUse: 0,
    reservedBorrow: 0,
    equity: config.userStartingBalance,
    marginRatio: null,
    leverage: 0,
  };
}

function createDefaultShortSellingState(config = defaultConfig) {
  return {
    enabled: !!config.shortSellingEnabled,
    borrowAvailable: !!config.borrowAvailable,
    borrowPoolSize: config.borrowPoolSize,
    borrowPoolRemaining: config.borrowPoolSize,
    activeBorrow: 0,
    reservedBorrow: 0,
    shortEnabledAgentCount: 0,
    activeShortCount: 0,
    forcedCoverCount: 0,
    lastForcedCoverTick: null,
  };
}

export const useSimulationStore = create((set, get) => ({
  // --- Simulation control ---
  isRunning: false,
  isPaused: false,
  tick: 0,
  speed: 1,
  config: { ...defaultConfig },

  // --- Market data ---
  lastPrice: defaultConfig.initialPrice,
  bestBid: null,
  bestAsk: null,
  spread: null,
  midPrice: defaultConfig.initialPrice,

  // --- Order book display ---
  bidLevels: [],
  askLevels: [],
  cumulativeDepth: { bidDepth: [], askDepth: [] },

  // --- Candles and trades ---
  candles: [],
  currentCandle: null,
  recentTrades: [],

  // --- Metrics ---
  volume: 0,
  volatility: 0,
  orderFlowImbalance: 0,
  totalOrders: 0,
  totalBidVolume: 0,
  totalAskVolume: 0,
  makerStats: {
    enabled: false,
    makerCount: 0,
    totalRestingVolume: 0,
    makerRestingBidVolume: 0,
    makerRestingAskVolume: 0,
    fillCount: 0,
    averageSpreadQuoted: 0,
    averageSpreadQuotedLifetime: 0,
    inventories: [],
    netInventory: 0,
    averageInventory: 0,
    longCount: 0,
    shortCount: 0,
    flatCount: 0,
    minInventory: 0,
    maxInventory: 0,
    bestBidControlled: false,
    bestAskControlled: false,
    spreadSetByMakers: false,
    makerMarkToMarket: 0,
  },

  // --- Patterns ---
  patterns: {
    supportLevels: [],
    resistanceLevels: [],
    volumeSpikes: [],
    breakouts: [],
    localHighs: [],
    localLows: [],
    liquidityZones: [],
    bounceMarkers: [],
  },

  // --- History (for replay) ---
  history: [],

  // --- User trading ---
  userBalance: defaultConfig.userStartingBalance,
  userPosition: {
    size: 0,
    avgPrice: 0,
    canShort: true,
    averageLongEntryPrice: 0,
    averageShortEntryPrice: 0,
    shortPositionSize: 0,
    borrowInUse: 0,
    reservedBorrow: 0,
    equity: defaultConfig.userStartingBalance,
    marginRatio: null,
    leverage: 0,
  },
  userOrders: [],
  userTradeHistory: [],
  userPnl: {
    realized: 0,
    unrealized: 0,
    realizedLong: 0,
    realizedShort: 0,
    unrealizedLong: 0,
    unrealizedShort: 0,
  },
  userEquityCurve: [],
  shortSelling: createDefaultShortSellingState(defaultConfig),

  // --- Latency / event queue ---
  latencyEnabled: false,
  pendingEvents: [],
  pendingEventCount: 0,
  eventLog: [],

  // --- UI state ---
  chartType: 'candlestick', // 'candlestick' | 'line'
  showPatterns: true,
  activePanel: 'orderbook', // 'orderbook' | 'depth' | 'tape'
  bottomPanel: 'trading',   // 'trading' | 'metrics' | 'education' | 'replay'
  showEducation: false,

  // --- Actions ---

  /** Bulk update from engine callback */
  updateFromEngine: (data) => set((state) => {
    const userPortfolio = data.userPortfolio ?? createDefaultUserPortfolio(state.config);
    const nextEquityCurve = userPortfolio.equity != null
      && state.userEquityCurve[state.userEquityCurve.length - 1]?.tick !== data.tick
      ? [...state.userEquityCurve, { tick: data.tick, equity: userPortfolio.equity }]
      : state.userEquityCurve;

    return {
      tick: data.tick,
      lastPrice: data.lastPrice,
      bestBid: data.bestBid,
      bestAsk: data.bestAsk,
      spread: data.spread,
      midPrice: data.midPrice,
      bidLevels: data.bidLevels,
      askLevels: data.askLevels,
      cumulativeDepth: data.cumulativeDepth,
      candles: data.candles,
      currentCandle: data.currentCandle,
      recentTrades: data.recentTrades,
      volume: data.volume,
      volatility: data.volatility,
      orderFlowImbalance: data.orderFlowImbalance,
      totalOrders: data.totalOrders,
      totalBidVolume: data.totalBidVolume,
      totalAskVolume: data.totalAskVolume,
      makerStats: data.makerStats,
      patterns: data.patterns,
      history: data.history,
      userOrders: data.userOrders,
      userBalance: userPortfolio.cash,
      userPosition: {
        size: userPortfolio.position,
        avgPrice: userPortfolio.avgPrice,
        canShort: userPortfolio.canShort,
        averageLongEntryPrice: userPortfolio.averageLongEntryPrice,
        averageShortEntryPrice: userPortfolio.averageShortEntryPrice,
        shortPositionSize: userPortfolio.shortPositionSize,
        borrowInUse: userPortfolio.borrowInUse,
        reservedBorrow: userPortfolio.reservedBorrow,
        equity: userPortfolio.equity,
        marginRatio: userPortfolio.marginRatio,
        leverage: userPortfolio.leverage,
      },
      userPnl: {
        realized: userPortfolio.realizedPnL,
        unrealized: userPortfolio.unrealizedPnL,
        realizedLong: userPortfolio.realizedLongPnL,
        realizedShort: userPortfolio.realizedShortPnL,
        unrealizedLong: userPortfolio.unrealizedLongPnL,
        unrealizedShort: userPortfolio.unrealizedShortPnL,
      },
      userEquityCurve: nextEquityCurve,
      shortSelling: data.shortSelling ?? state.shortSelling,
      isRunning: data.isRunning,
      isPaused: data.isPaused,
      latencyEnabled: data.latencyEnabled ?? false,
      pendingEvents: data.pendingEvents ?? [],
      pendingEventCount: data.pendingEventCount ?? 0,
      eventLog: data.eventLog ?? [],
    };
  }),

  setConfig: (updates) => set((state) => ({
    config: { ...state.config, ...updates },
  })),

  setSpeed: (speed) => set({ speed }),
  setChartType: (chartType) => set({ chartType }),
  setShowPatterns: (show) => set({ showPatterns: show }),
  setActivePanel: (panel) => set({ activePanel: panel }),
  setBottomPanel: (panel) => set({ bottomPanel: panel }),
  setShowEducation: (show) => set({ showEducation: show }),

  /** Record a user trade */
  recordUserTrade: (trade) => set((state) => {
    return {
      userTradeHistory: [...state.userTradeHistory, trade],
    };
  }),

  addUserOrder: (order) => set((state) => ({
    userOrders: [...state.userOrders, order],
  })),

  removeUserOrder: (orderId) => set((state) => ({
    userOrders: state.userOrders.filter(o => o.id !== orderId),
  })),

  /** Update unrealized PnL based on current price */
  updateUnrealizedPnl: () => set((state) => state),

  /** Reset user trading state */
  resetUser: () => set({
    userBalance: defaultConfig.userStartingBalance,
    userPosition: {
      size: 0,
      avgPrice: 0,
      canShort: true,
      averageLongEntryPrice: 0,
      averageShortEntryPrice: 0,
      shortPositionSize: 0,
      borrowInUse: 0,
      reservedBorrow: 0,
      equity: defaultConfig.userStartingBalance,
      marginRatio: null,
      leverage: 0,
    },
    userOrders: [],
    userTradeHistory: [],
    userPnl: {
      realized: 0,
      unrealized: 0,
      realizedLong: 0,
      realizedShort: 0,
      unrealizedLong: 0,
      unrealizedShort: 0,
    },
    userEquityCurve: [],
    shortSelling: createDefaultShortSellingState(defaultConfig),
  }),
}));
