# Market Simulator

A browser-based stock market simulation where price action emerges from a live order book and truly random agents. Study how support, resistance, clustering, and recognizable chart behavior can emerge even when participants are acting randomly.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser. Click **Start** to begin the simulation.

## How It Works

### Order Book Engine

The core is a real order book with price-time priority matching:

- **Limit orders** rest in the book at a specified price until filled, cancelled, or expired
- **Market orders** immediately match against the best available resting orders
- **Partial fills** are supported — large orders can match against multiple resting orders
- **Bid/ask ladders** maintain sorted price levels with FIFO queues at each level

Price is never generated synthetically. Every price movement comes from actual order matching.

### Random Agents

The simulation runs 150 agents (configurable) that act purely randomly but with realistic weighted distributions:

- **Activity rate**: Each agent has a randomly-assigned probability of acting per tick (0.5–15%). Most ticks, most agents do nothing.
- **Buy/sell bias**: Each agent has a slight random bias toward buying or selling (30–70%).
- **Order type**: Limit orders are ~80% of submissions. Market orders are aggressive and rarer.
- **Size**: Exponentially distributed — most orders are small, large orders are rare (Pareto-like).
- **Price offset**: Limit orders cluster near the current mid price (exponential distribution). ~15% snap to round numbers.
- **Lifetime**: Orders persist for 50–5000 ticks, creating lasting liquidity structure.
- **Cancellation**: Each agent randomly cancels resting orders at a low rate.

No agent follows any strategy, trend, or pattern. All behavior is memoryless and probabilistic.

### How Support and Resistance Emerge

Even with purely random agents:

1. **Clustering is natural** — when 150 independent agents pick prices near the mid, some overlap by chance, especially near round numbers.
2. **Order persistence** — limit orders rest in the book for many ticks, creating memory in the system even though agents are memoryless.
3. **Price bounces** — when price drops into a cluster of buy orders, those orders absorb selling pressure. If the cluster is large enough, price reverses — creating observable support.
4. **Self-reinforcing structure** — the chart reacts to order clusters, creating the same patterns that real traders use to make decisions.

### Seeded Randomness

The simulation uses a Mulberry32 PRNG seeded with a configurable seed. Same seed = same simulation run, allowing reproducible experiments.

## Features

- **Live candlestick/line chart** with volume bars (TradingView lightweight-charts)
- **Real-time order book ladder** with size visualization
- **Depth chart** showing cumulative bid/ask liquidity
- **Trade tape** (time & sales)
- **Liquidity heatmap** showing order density at each price level
- **Pattern detection**: support/resistance levels, volume spikes, breakouts, liquidity zones
- **Manual trading**: place market/limit orders, track position, PnL, and trade history
- **Simulation controls**: play, pause, step, reset, speed (1x–20x)
- **All parameters configurable**: agents, order sizes, lifetimes, cancel rates, price offsets, tick size, seed
- **Export**: candles CSV, trades CSV, full JSON export
- **Save/load** custom parameter configurations to localStorage
- **Education panel** explaining order books, liquidity, and emergent structure

## Project Structure

```
src/
├── engine/
│   ├── seededRng.js          # Mulberry32 PRNG with distributions
│   ├── orderBook.js          # Order book with bid/ask ladders
│   ├── matchingEngine.js     # Order matching with partial fills
│   ├── simulationLoop.js     # Main tick loop orchestrator
│   ├── metricsEngine.js      # OHLCV candles, volume, volatility
│   └── patternDetector.js    # Support/resistance/breakout detection
├── agents/
│   └── randomAgentSystem.js  # Random agent population
├── store/
│   └── simulationStore.js    # Zustand state management
├── data/
│   └── defaultConfig.js      # Default parameters and ranges
├── utils/
│   ├── formatters.js         # Price/volume formatting
│   └── export.js             # CSV/JSON export utilities
├── hooks/
│   └── useSimulation.js      # Engine ↔ React bridge
├── components/
│   ├── Layout.jsx            # Main app layout
│   ├── CandlestickChart.jsx  # TradingView chart
│   ├── OrderBookDisplay.jsx  # Order book ladder
│   ├── DepthChart.jsx        # Canvas depth chart
│   ├── TradeTape.jsx         # Time & sales
│   ├── SimulationControls.jsx# Play/pause/speed/config
│   ├── ManualTrading.jsx     # User trading panel
│   ├── MetricsPanel.jsx      # Spread, volume, patterns
│   ├── EducationPanel.jsx    # Learning content
│   ├── ReplayControls.jsx    # Export & replay tools
│   └── LiquidityHeatmap.jsx  # Canvas heatmap
├── App.jsx
├── main.jsx
└── index.css
```

## Tech Stack

- React 19
- Vite 8
- Tailwind CSS 4
- Zustand 5 (state management)
- TradingView lightweight-charts 4 (charting)
- Canvas API (depth chart, heatmap)
- Fully client-side — no backend required
