import { useSimulationStore } from '../store/simulationStore.js';
import { formatPrice } from '../utils/formatters.js';

export default function TradeTape() {
  const recentTrades = useSimulationStore((s) => s.recentTrades);

  // Show last 50 trades, newest first
  const trades = recentTrades.slice(-50).reverse();

  return (
    <div className="flex flex-col h-full text-xs font-mono">
      <div className="flex justify-between px-2 py-1 text-gray-500 border-b border-gray-800">
        <span className="w-16">Price</span>
        <span className="w-12 text-right">Size</span>
        <span className="w-12 text-right">Side</span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {trades.length === 0 ? (
          <div className="text-gray-600 text-center py-4">No trades yet</div>
        ) : (
          trades.map((trade) => (
            <div
              key={trade.id}
              className="flex justify-between items-center px-2 py-0.5 hover:bg-gray-800/30"
            >
              <span
                className="w-16"
                style={{ color: trade.aggressor === 'buy' ? '#22c55e' : '#ef4444' }}
              >
                {formatPrice(trade.price)}
              </span>
              <span className="text-gray-400 w-12 text-right">
                {trade.size}
              </span>
              <span
                className="w-12 text-right uppercase"
                style={{ color: trade.aggressor === 'buy' ? '#22c55e' : '#ef4444' }}
              >
                {trade.aggressor === 'buy' ? 'BUY' : 'SELL'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
