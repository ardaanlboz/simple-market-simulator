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
  actionFrequency: 1.0,    // multiplier on agent activity rate
  buyProbability: 0.5,     // base buy vs sell probability
  buyBias: 0.5,            // center of agent buy bias distribution
  limitProbability: 0.8,   // base limit vs market probability
  limitBias: 0.8,          // center of agent limit bias distribution

  // Order sizes
  baseOrderSize: 10,
  minOrderSize: 1,
  maxOrderSize: 500,

  // Order lifetime (in ticks)
  baseLifetime: 500,
  minLifetime: 50,
  maxLifetime: 5000,

  // Cancellation
  cancelProbability: 1.0,  // multiplier on agent cancel rate

  // Price offset for limit orders
  priceOffsetRange: 1.0,   // base offset from mid price

  // Simulation speed
  tickInterval: 25,        // ms between ticks at 1x speed
  ticksPerCandle: 100,     // ticks per OHLCV candle

  // Random seed
  seed: 42,

  // Manual trading
  userStartingBalance: 10000,
};

/**
 * Slider ranges for each config parameter.
 */
export const configRanges = {
  numAgents: { min: 10, max: 500, step: 10, label: 'Number of Agents' },
  actionFrequency: { min: 0.1, max: 3.0, step: 0.1, label: 'Action Frequency' },
  buyProbability: { min: 0.1, max: 0.9, step: 0.05, label: 'Buy Probability' },
  limitProbability: { min: 0.3, max: 0.98, step: 0.02, label: 'Limit Order Probability' },
  baseOrderSize: { min: 1, max: 100, step: 1, label: 'Base Order Size' },
  maxOrderSize: { min: 50, max: 2000, step: 50, label: 'Max Order Size' },
  baseLifetime: { min: 50, max: 3000, step: 50, label: 'Base Order Lifetime' },
  cancelProbability: { min: 0.1, max: 3.0, step: 0.1, label: 'Cancel Rate' },
  priceOffsetRange: { min: 0.1, max: 5.0, step: 0.1, label: 'Price Offset Range' },
  ticksPerCandle: { min: 20, max: 500, step: 10, label: 'Ticks Per Candle' },
  initialPrice: { min: 10, max: 1000, step: 10, label: 'Initial Price' },
  tickSize: { min: 0.01, max: 1.0, step: 0.01, label: 'Tick Size' },
  seed: { min: 1, max: 99999, step: 1, label: 'Random Seed' },
};
