import { useSimulationStore } from '../store/simulationStore.js';
import { formatPrice, formatSize } from '../utils/formatters.js';

export default function OrderBookDisplay() {
  const bidLevels = useSimulationStore((s) => s.bidLevels);
  const askLevels = useSimulationStore((s) => s.askLevels);
  const lastPrice = useSimulationStore((s) => s.lastPrice);
  const spread = useSimulationStore((s) => s.spread);

  const maxBidSize = bidLevels.reduce((m, l) => Math.max(m, l.size), 1);
  const maxAskSize = askLevels.reduce((m, l) => Math.max(m, l.size), 1);
  const maxSize = Math.max(maxBidSize, maxAskSize);

  // Show top 15 asks (reversed so lowest ask is at bottom) and top 15 bids
  const displayAsks = askLevels.slice(0, 15).reverse();
  const displayBids = bidLevels.slice(0, 15);

  return (
    <div className="flex flex-col h-full text-xs font-mono">
      {/* Header */}
      <div className="flex justify-between px-2 py-1 text-gray-500 border-b border-gray-800">
        <span className="w-16">Price</span>
        <span className="w-14 text-right">Size</span>
        <span className="w-10 text-right">#</span>
      </div>

      {/* Asks (sells) — displayed top to bottom, highest to lowest */}
      <div className="flex-1 overflow-hidden flex flex-col justify-end">
        {displayAsks.map((level, i) => (
          <div
            key={`ask-${i}`}
            className="flex justify-between items-center px-2 py-0.5 relative"
          >
            <div
              className="absolute inset-0 opacity-20"
              style={{
                background: '#ef4444',
                width: `${(level.size / maxSize) * 100}%`,
                right: 0,
                left: 'auto',
              }}
            />
            <span className="text-red-400 w-16 relative z-10">
              {formatPrice(level.price)}
            </span>
            <span className="text-gray-300 w-14 text-right relative z-10">
              {formatSize(level.size)}
            </span>
            <span className="text-gray-500 w-10 text-right relative z-10">
              {level.count}
            </span>
          </div>
        ))}
      </div>

      {/* Spread / last price */}
      <div className="flex justify-between items-center px-2 py-1.5 bg-gray-800/50 border-y border-gray-700">
        <span className="text-lg font-bold" style={{
          color: lastPrice >= (useSimulationStore.getState().midPrice || lastPrice) ? '#22c55e' : '#ef4444',
        }}>
          {formatPrice(lastPrice)}
        </span>
        <span className="text-gray-500 text-xs">
          Spread: {spread != null ? formatPrice(spread) : '—'}
        </span>
      </div>

      {/* Bids (buys) — highest to lowest */}
      <div className="flex-1 overflow-hidden">
        {displayBids.map((level, i) => (
          <div
            key={`bid-${i}`}
            className="flex justify-between items-center px-2 py-0.5 relative"
          >
            <div
              className="absolute inset-0 opacity-20"
              style={{
                background: '#22c55e',
                width: `${(level.size / maxSize) * 100}%`,
                right: 0,
                left: 'auto',
              }}
            />
            <span className="text-green-400 w-16 relative z-10">
              {formatPrice(level.price)}
            </span>
            <span className="text-gray-300 w-14 text-right relative z-10">
              {formatSize(level.size)}
            </span>
            <span className="text-gray-500 w-10 text-right relative z-10">
              {level.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
