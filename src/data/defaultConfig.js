/**
 * Default simulation configuration.
 * All parameters are user-adjustable.
 */
export const defaultConfig = {
  // Market
  initialPrice: 100.0,
  tickSize: 0.01,

  // Agents
  numAgents: 150,
  actionFrequency: 1.0, // multiplier on agent activity rate
  buyProbability: 0.5, // base buy vs sell probability
  buyBias: 0.5, // center of agent buy bias distribution
  limitProbability: 0.8, // base limit vs market probability
  limitBias: 0.8, // center of agent limit bias distribution

  // Order sizes
  baseOrderSize: 10,
  minOrderSize: 1,
  maxOrderSize: 500,

  // Order lifetime (in ticks)
  baseLifetime: 500,
  minLifetime: 50,
  maxLifetime: 5000,

  // Cancellation
  cancelProbability: 1.0, // multiplier on agent cancel rate

  // Price offset for limit orders
  priceOffsetRange: 1.0, // base offset from mid price

  // Execution quality
  slippageIntensity: 1.0, // amplifies quote fade for large market orders

  // Market makers
  enableMarketMakers: false,
  numberOfMarketMakers: 4,
  baseSpreadTicks: 2,
  quoteSizeRange: { min: 6, max: 24 },
  quoteRefreshInterval: 30,
  staleQuoteLifetime: 120,
  inventorySkewStrength: 3,
  maxInventory: 150,
  makerCancellationDelay: 8,
  makerReactionDelay: 12,
  probabilityOfJoiningBestBidAsk: 0.6,
  probabilityOfQuotingOneTickAway: 0.25,

  // Simulation speed
  tickInterval: 25, // ms between ticks at 1x speed
  ticksPerCandle: 100, // ticks per OHLCV candle

  // Random seed
  seed: 42,

  // Manual trading
  userStartingBalance: 10000,
};

/**
 * Slider ranges for each config parameter.
 */
export const configRanges = {
  numAgents: { min: 10, max: 5000, step: 10, label: "Number of Agents" },
  actionFrequency: { min: 0.1, max: 3.0, step: 0.1, label: "Action Frequency" },
  buyProbability: { min: 0.1, max: 0.9, step: 0.05, label: "Buy Probability" },
  limitProbability: {
    min: 0.3,
    max: 0.98,
    step: 0.02,
    label: "Limit Order Probability",
  },
  baseOrderSize: { min: 1, max: 100, step: 1, label: "Base Order Size" },
  maxOrderSize: { min: 50, max: 2000, step: 50, label: "Max Order Size" },
  baseLifetime: { min: 50, max: 3000, step: 50, label: "Base Order Lifetime" },
  cancelProbability: { min: 0.1, max: 3.0, step: 0.1, label: "Cancel Rate" },
  priceOffsetRange: {
    min: 0.1,
    max: 5.0,
    step: 0.1,
    label: "Price Offset Range",
  },
  slippageIntensity: { min: 0, max: 3, step: 0.1, label: "Slippage Intensity" },
  ticksPerCandle: { min: 20, max: 500, step: 10, label: "Ticks Per Candle" },
  initialPrice: { min: 10, max: 1000, step: 10, label: "Initial Price" },
  tickSize: { min: 0.01, max: 1.0, step: 0.01, label: "Tick Size" },
  seed: { min: 1, max: 99999, step: 1, label: "Random Seed" },
};

export const marketMakerConfigRanges = {
  numberOfMarketMakers: { min: 1, max: 20, step: 1, label: "Number of Makers" },
  baseSpreadTicks: { min: 1, max: 12, step: 1, label: "Base Spread Ticks" },
  quoteSizeRangeMin: { min: 1, max: 200, step: 1, label: "Min Quote Size" },
  quoteSizeRangeMax: { min: 1, max: 400, step: 1, label: "Max Quote Size" },
  quoteRefreshInterval: { min: 5, max: 300, step: 5, label: "Refresh Interval" },
  staleQuoteLifetime: { min: 20, max: 600, step: 10, label: "Stale Quote Lifetime" },
  inventorySkewStrength: { min: 0, max: 12, step: 0.5, label: "Inventory Skew" },
  maxInventory: { min: 10, max: 1000, step: 10, label: "Max Inventory" },
  makerCancellationDelay: { min: 1, max: 60, step: 1, label: "Cancel Delay" },
  makerReactionDelay: { min: 1, max: 120, step: 1, label: "Reaction Delay" },
  probabilityOfJoiningBestBidAsk: { min: 0, max: 1, step: 0.05, label: "Join Best Prob." },
  probabilityOfQuotingOneTickAway: { min: 0, max: 1, step: 0.05, label: "One Tick Away Prob." },
};
