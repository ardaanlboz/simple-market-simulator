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
  const shortSelling = useSimulationStore((s) => s.shortSelling);
  const latencyEnabled = useSimulationStore((s) => s.latencyEnabled);
  const pendingEvents = useSimulationStore((s) => s.pendingEvents);
  const pendingEventCount = useSimulationStore((s) => s.pendingEventCount);

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

  // Filter pending events for user-specific ones
  const pendingUserSubmits = pendingEvents.filter(
    (e) => e.sourceId === 'user' && e.type === 'SUBMIT_ORDER'
  );
  const pendingUserCancels = pendingEvents.filter(
    (e) => e.sourceId === 'user' && e.type === 'CANCEL_ORDER'
  );
  const pendingCancelOrderIds = new Set(pendingUserCancels.map((e) => e.orderId));

  const equity = userPosition.equity ?? (userBalance + userPosition.size * lastPrice);

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

        {/* Latency indicator */}
        {latencyEnabled && (
          <div className="text-[10px] text-amber-400/80 mt-1 px-1 py-1 rounded bg-amber-900/20 border border-amber-800/30">
            Latency ON — {pendingEventCount} pending
            {pendingUserSubmits.length > 0 && (
              <span> | {pendingUserSubmits.length} in flight</span>
            )}
          </div>
        )}

        <div className="text-[10px] text-gray-500 mt-1 px-1">
          Shorting {shortSelling.enabled ? 'enabled' : 'disabled'}
          {' '}• Borrow {shortSelling.borrowAvailable ? 'available' : 'off'}
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
          <span className="text-gray-500">Can Short:</span>
          <span className={userPosition.canShort ? 'text-green-400' : 'text-gray-400'}>
            {userPosition.canShort ? 'Yes' : 'No'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Short Size:</span>
          <span className={userPosition.shortPositionSize > 0 ? 'text-red-400' : 'text-gray-300'}>
            {userPosition.shortPositionSize}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Short Avg:</span>
          <span className="text-gray-300">{formatPrice(userPosition.averageShortEntryPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Balance:</span>
          <span className="text-gray-300">{formatPrice(userBalance)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Equity:</span>
          <span className="text-gray-300">{formatPrice(equity)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Borrow Used:</span>
          <span className="text-gray-300">{userPosition.borrowInUse}</span>
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
        <div className="flex justify-between">
          <span className="text-gray-500">Short Realized:</span>
          <span className={userPnl.realizedShort >= 0 ? 'text-green-400' : 'text-red-400'}>
            {formatPnl(userPnl.realizedShort)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Short Unreal.:</span>
          <span className={userPnl.unrealizedShort >= 0 ? 'text-green-400' : 'text-red-400'}>
            {formatPnl(userPnl.unrealizedShort)}
          </span>
        </div>
      </div>

      {/* Open orders + pending */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="text-gray-400 font-bold mb-1">
          Open Orders ({userOrders.length})
          {pendingUserSubmits.length > 0 && (
            <span className="text-amber-400 font-normal ml-1">
              + {pendingUserSubmits.length} in flight
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* In-flight orders (submitted but not yet arrived at book) */}
          {pendingUserSubmits.map((evt) => (
            <div key={`pending-${evt.id}`} className="py-1 border-b border-gray-800/40 opacity-60">
              <div className="flex items-center gap-2">
                <span className={evt.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                  {evt.side?.toUpperCase() ?? '?'}
                </span>
                <span className="text-gray-300">
                  {evt.price != null ? formatPrice(evt.price) : 'MKT'}
                </span>
                <span className="text-amber-400 ml-auto text-[10px] uppercase tracking-wide animate-pulse">
                  in flight
                </span>
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">
                Qty {evt.size} | {evt.orderType} | arrives tick {evt.scheduledFor}
              </div>
            </div>
          ))}

          {/* Resting orders in the book */}
          {userOrders.length === 0 && pendingUserSubmits.length === 0 ? (
            <div className="text-gray-600">No open orders</div>
          ) : (
            userOrders.map((order) => (
              <div key={order.id} className="py-1 border-b border-gray-800/40 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className={order.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                    {order.side.toUpperCase()}
                  </span>
                  <span className="text-gray-300">{formatPrice(order.price)}</span>
                  <span className="text-gray-500 ml-auto text-[10px] uppercase tracking-wide">
                    {pendingCancelOrderIds.has(order.id)
                      ? <span className="text-amber-400 animate-pulse">cancelling</span>
                      : order.status.replace('_', ' ')
                    }
                  </span>
                  <button
                    onClick={() => sim.cancelUserOrder(order.id)}
                    className="text-red-500 hover:text-red-400"
                    disabled={pendingCancelOrderIds.has(order.id)}
                  >
                    {pendingCancelOrderIds.has(order.id) ? '...' : '\u2715'}
                  </button>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  Qty {order.quantity} • Filled {order.filledQuantity} • Remaining {order.remainingQuantity}
                </div>
                {order.reservedShortQuantity > 0 && (
                  <div className="text-[10px] text-amber-400/70 mt-0.5">
                    Borrow reserved: {order.reservedShortQuantity}
                  </div>
                )}
                {order.queuePosition != null && order.priceLevelOrderCount != null && (
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    Queue {order.queuePosition}/{order.priceLevelOrderCount} @ {formatPrice(order.levelPrice ?? order.price)}
                  </div>
                )}
                {order.enteredBookAt != null && order.submittedAt != null && order.enteredBookAt > order.submittedAt && (
                  <div className="text-[10px] text-amber-400/60 mt-0.5">
                    Delay: {order.enteredBookAt - order.submittedAt} ticks
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Trade history */}
      <div className="flex flex-col w-56 shrink-0">
        <div className="text-gray-400 font-bold mb-1">My Trades ({userTradeHistory.length})</div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {userTradeHistory.slice(-20).reverse().map((t, i) => (
            <div key={i} className="py-1 border-b border-gray-800/40 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className={t.side === 'buy' ? 'text-green-400' : 'text-red-400'}>
                  {t.side === 'buy' ? 'B' : 'S'}
                </span>
                <span className="text-gray-300">{formatPrice(t.price)}</span>
                <span className="text-gray-500">x{t.size}</span>
                {t.isForcedCover && (
                  <span className="text-amber-400 text-[10px] uppercase tracking-wide">
                    forced
                  </span>
                )}
              </div>
              {t.slippageBps != null && (
                <div className="text-[10px] text-gray-500 mt-0.5">
                  Slip vs mid {t.slippageBps.toFixed(1)} bps
                  {t.levelsSwept > 1 ? ` • ${t.levelsSwept} lvls` : ''}
                  {t.quoteFadeVolume > 0 ? ` • faded ${t.quoteFadeVolume}` : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
