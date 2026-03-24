/**
 * Zustand store — bridges the simulation engine and React UI.
 *
 * Holds display state (updated from engine callbacks),
 * user trading state, and UI preferences.
 */

import { create } from 'zustand';
import { defaultConfig } from '../data/defaultConfig.js';

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
  userPosition: { size: 0, avgPrice: 0 },
  userOrders: [],
  userTradeHistory: [],
  userPnl: { realized: 0, unrealized: 0 },
  userEquityCurve: [],

  // --- UI state ---
  chartType: 'candlestick', // 'candlestick' | 'line'
  showPatterns: true,
  activePanel: 'orderbook', // 'orderbook' | 'depth' | 'tape'
  bottomPanel: 'trading',   // 'trading' | 'metrics' | 'education' | 'replay'
  showEducation: false,

  // --- Actions ---

  /** Bulk update from engine callback */
  updateFromEngine: (data) => set({
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
    isRunning: data.isRunning,
    isPaused: data.isPaused,
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
    const newHistory = [...state.userTradeHistory, trade];
    const pos = { ...state.userPosition };
    let balance = state.userBalance;
    let realized = state.userPnl.realized;

    if (trade.side === 'buy') {
      const cost = trade.price * trade.size;
      balance -= cost;
      if (pos.size >= 0) {
        // Adding to long
        const totalCost = pos.avgPrice * pos.size + cost;
        pos.size += trade.size;
        pos.avgPrice = pos.size > 0 ? totalCost / pos.size : 0;
      } else {
        // Covering short
        const pnl = (pos.avgPrice - trade.price) * Math.min(trade.size, Math.abs(pos.size));
        realized += pnl;
        balance += pnl;
        pos.size += trade.size;
        if (pos.size > 0) {
          pos.avgPrice = trade.price;
        }
      }
    } else {
      const proceeds = trade.price * trade.size;
      balance += proceeds;
      if (pos.size <= 0) {
        // Adding to short
        const totalCost = Math.abs(pos.avgPrice * pos.size) + proceeds;
        pos.size -= trade.size;
        pos.avgPrice = pos.size !== 0 ? totalCost / Math.abs(pos.size) : 0;
      } else {
        // Selling long
        const pnl = (trade.price - pos.avgPrice) * Math.min(trade.size, pos.size);
        realized += pnl;
        balance += pnl - proceeds;
        pos.size -= trade.size;
        if (pos.size < 0) {
          pos.avgPrice = trade.price;
        }
      }
    }

    const unrealized = pos.size !== 0
      ? (state.lastPrice - pos.avgPrice) * pos.size
      : 0;

    const equity = balance + unrealized + Math.abs(pos.size) * state.lastPrice;
    const equityCurve = [...state.userEquityCurve, { tick: state.tick, equity }];

    return {
      userBalance: balance,
      userPosition: pos,
      userTradeHistory: newHistory,
      userPnl: { realized, unrealized },
      userEquityCurve: equityCurve,
    };
  }),

  addUserOrder: (order) => set((state) => ({
    userOrders: [...state.userOrders, order],
  })),

  removeUserOrder: (orderId) => set((state) => ({
    userOrders: state.userOrders.filter(o => o.id !== orderId),
  })),

  /** Update unrealized PnL based on current price */
  updateUnrealizedPnl: () => set((state) => {
    const { size, avgPrice } = state.userPosition;
    const unrealized = size !== 0 ? (state.lastPrice - avgPrice) * size : 0;
    return { userPnl: { ...state.userPnl, unrealized } };
  }),

  /** Reset user trading state */
  resetUser: () => set({
    userBalance: defaultConfig.userStartingBalance,
    userPosition: { size: 0, avgPrice: 0 },
    userOrders: [],
    userTradeHistory: [],
    userPnl: { realized: 0, unrealized: 0 },
    userEquityCurve: [],
  }),
}));
