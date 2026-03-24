import { useState } from 'react';
import { useSimulationStore } from '../store/simulationStore.js';
import { formatPrice, formatPnl } from '../utils/formatters.js';

export default function ManualTrading({ sim }) {
  const [orderType, setOrderType] = useState('market');
  const [side, setSide] = useState('buy');
  const [size, setSize] = useState(10);
  const [price, setPrice] = useState('');

  const lastPrice = useSimulationStore((s) => s.lastPrice);
  const bestBid = useSimulationStore((s) => s.bestBid);
  const bestAsk = useSimulationStore((s) => s.bestAsk);
  const userBalance = useSimulationStore((s) => s.userBalance);
  const userPosition = useSimulationStore((s) => s.userPosition);
  const userPnl = useSimulationStore((s) => s.userPnl);
  const userOrders = useSimulationStore((s) => s.userOrders);
  const userTradeHistory = useSimulationStore((s) => s.userTradeHistory);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (size <= 0) return;

    sim.placeUserOrder({
      side,
      type: orderType,
      price: orderType === 'limit' ? parseFloat(price) || lastPrice : null,
      size: parseInt(size),
    });
  };

  const equity = userBalance + userPnl.unrealized +
    Math.abs(userPosition.size) * (userPosition.size > 0 ? lastPrice : -lastPrice + 2 * userPosition.avgPrice);

  return (
    <div className="flex gap-4 h-full text-xs">
      {/* Order form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 w-52 shrink-0">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setOrderType('market')}
            className="flex-1 py-1 rounded text-xs transition-colors"
            style={{
              background: orderType === 'market' ? '#3b82f6' : '#374151',
              color: orderType === 'market' ? '#fff' : '#9ca3af',
            }}
          >
            Market
          </button>
          <button
            type="button"
            onClick={() => setOrderType('limit')}
            className="flex-1 py-1 rounded text-xs transition-colors"
            style={{
              background: orderType === 'limit' ? '#3b82f6' : '#374151',
              color: orderType === 'limit' ? '#fff' : '#9ca3af',
            }}
          >
            Limit
          </button>
        </div>

        {orderType === 'limit' && (
          <input
            type="number"
            step="0.01"
            placeholder={`Price (${formatPrice(lastPrice)})`}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="px-2 py-1.5 rounded bg-gray-800 border border-gray-700 text-gray-200 text-xs focus:border-blue-500 focus:outline-none"
          />
        )}

        <input
          type="number"
          min="1"
          placeholder="Size"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className="px-2 py-1.5 rounded bg-gray-800 border border-gray-700 text-gray-200 text-xs focus:border-blue-500 focus:outline-none"
        />

        <div className="flex gap-1">
          <button
            type="submit"
            onClick={() => setSide('buy')}
            className="flex-1 py-2 rounded font-bold text-white transition-colors hover:brightness-110"
            style={{ background: '#22c55e' }}
          >
            BUY {bestAsk ? `@ ${formatPrice(bestAsk)}` : ''}
          </button>
          <button
            type="submit"
            onClick={() => setSide('sell')}
            className="flex-1 py-2 rounded font-bold text-white transition-colors hover:brightness-110"
            style={{ background: '#ef4444' }}
          >
            SELL {bestBid ? `@ ${formatPrice(bestBid)}` : ''}
          </button>
        </div>
      </form>

      {/* Position & PnL */}
      <div className="flex flex-col gap-1 w-44 shrink-0">
        <div className="text-gray-400 font-bold mb-1">Position</div>
        <div className="flex justify-between">
          <span className="text-gray-500">Size:</span>
          <span className={userPosition.size > 0 ? 'text-green-400' : userPosition.size < 0 ? 'text-red-400' : 'text-gray-300'}>
            {userPosition.size > 0 ? '+' : ''}{userPosition.size}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Avg Entry:</span>
          <span className="text-gray-300">{formatPrice(userPosition.avgPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Balance:</span>
          <span className="text-gray-300">{formatPrice(userBalance)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Realized:</span>
          <span className={userPnl.realized >= 0 ? 'text-green-400' : 'text-red-400'}>
            {formatPnl(userPnl.realized)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Unrealized:</span>
          <span className={userPnl.unrealized >= 0 ? 'text-green-400' : 'text-red-400'}>
            {formatPnl(userPnl.unrealized)}
          </span>
        </div>
      </div>

      {/* Open orders */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="text-gray-400 font-bold mb-1">Open Orders ({userOrders.length})</div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {userOrders.length === 0 ? (
            <div className="text-gray-600">No open orders</div>
          ) : (
            userOrders.map((order) => (
              <div key={order.id} className="flex items-center gap-2 py-0.5">
                <span className={order.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                  {order.side.toUpperCase()}
                </span>
                <span className="text-gray-300">{formatPrice(order.price)}</span>
                <span className="text-gray-500">x{order.remainingSize}</span>
                <button
                  onClick={() => sim.cancelUserOrder(order.id)}
                  className="text-red-500 hover:text-red-400 ml-auto"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Trade history */}
      <div className="flex flex-col w-48 shrink-0">
        <div className="text-gray-400 font-bold mb-1">My Trades ({userTradeHistory.length})</div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {userTradeHistory.slice(-20).reverse().map((t, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <span className={t.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                {t.side === 'buy' ? 'B' : 'S'}
              </span>
              <span className="text-gray-300">{formatPrice(t.price)}</span>
              <span className="text-gray-500">x{t.size}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
