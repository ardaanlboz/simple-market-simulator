import { useSimulationStore } from '../store/simulationStore.js';
import { formatPrice, formatSize, formatPercent } from '../utils/formatters.js';

export default function MetricsPanel() {
  const lastPrice = useSimulationStore((s) => s.lastPrice);
  const spread = useSimulationStore((s) => s.spread);
  const midPrice = useSimulationStore((s) => s.midPrice);
  const volume = useSimulationStore((s) => s.volume);
  const volatility = useSimulationStore((s) => s.volatility);
  const orderFlowImbalance = useSimulationStore((s) => s.orderFlowImbalance);
  const totalOrders = useSimulationStore((s) => s.totalOrders);
  const totalBidVolume = useSimulationStore((s) => s.totalBidVolume);
  const totalAskVolume = useSimulationStore((s) => s.totalAskVolume);
  const makerStats = useSimulationStore((s) => s.makerStats);
  const shortSelling = useSimulationStore((s) => s.shortSelling);
  const patterns = useSimulationStore((s) => s.patterns);
  const config = useSimulationStore((s) => s.config);

  const spreadBps = spread != null && midPrice ? (spread / midPrice) * 10000 : null;
  const makerSpreadBps = makerStats.averageSpreadQuoted && midPrice
    ? (makerStats.averageSpreadQuoted / midPrice) * 10000
    : null;

  return (
    <div className="flex gap-6 h-full text-xs overflow-x-auto">
      {/* Price metrics */}
      <div className="flex flex-col gap-1 shrink-0">
        <div className="text-gray-400 font-bold mb-1">Price</div>
        <Metric label="Last" value={formatPrice(lastPrice)} />
        <Metric label="Mid" value={formatPrice(midPrice)} />
        <Metric label="Spread" value={spread != null ? `${formatPrice(spread)} (${spreadBps?.toFixed(1)} bps)` : '—'} />
        <Metric label="Volatility" value={formatPercent(volatility)} />
      </div>

      {/* Volume metrics */}
      <div className="flex flex-col gap-1 shrink-0">
        <div className="text-gray-400 font-bold mb-1">Volume</div>
        <Metric label="Total" value={formatSize(volume)} />
        <Metric label="Book Orders" value={totalOrders.toLocaleString()} />
        <Metric label="Bid Volume" value={formatSize(totalBidVolume)} color="#22c55e" />
        <Metric label="Ask Volume" value={formatSize(totalAskVolume)} color="#ef4444" />
      </div>

      <div className="flex flex-col gap-1 shrink-0">
        <div className="text-gray-400 font-bold mb-1">Short Selling</div>
        <Metric
          label="Status"
          value={shortSelling.enabled ? 'Enabled' : 'Disabled'}
          color={shortSelling.enabled ? '#f97316' : '#9ca3af'}
        />
        <Metric
          label="Borrow"
          value={shortSelling.borrowAvailable ? 'Available' : 'Off'}
          color={shortSelling.borrowAvailable ? '#22c55e' : '#ef4444'}
        />
        <Metric
          label="Pool"
          value={`${formatSize(shortSelling.borrowPoolRemaining)} / ${formatSize(shortSelling.borrowPoolSize)}`}
        />
        <Metric
          label="Used / Reserved"
          value={`${formatSize(shortSelling.activeBorrow)} / ${formatSize(shortSelling.reservedBorrow)}`}
        />
        <Metric
          label="Short Agents"
          value={`${shortSelling.activeShortCount} active / ${shortSelling.shortEnabledAgentCount} enabled`}
        />
        <Metric label="Forced Covers" value={shortSelling.forcedCoverCount.toLocaleString()} />
      </div>

      {config.enableMarketMakers && (
        <div className="flex flex-col gap-1 shrink-0">
          <div className="text-gray-400 font-bold mb-1">Market Makers</div>
          <Metric label="Count" value={makerStats.makerCount.toLocaleString()} />
          <Metric label="Resting Vol" value={formatSize(makerStats.totalRestingVolume)} color="#60a5fa" />
          <Metric label="Maker Fills" value={makerStats.fillCount.toLocaleString()} />
          <Metric
            label="Quoted Spread"
            value={makerStats.averageSpreadQuoted > 0
              ? `${formatPrice(makerStats.averageSpreadQuoted)} (${makerSpreadBps?.toFixed(1)} bps)`
              : '—'}
          />
          <Metric
            label="Top Of Book"
            value={makerStats.spreadSetByMakers
              ? 'Both Sides'
              : makerStats.bestBidControlled || makerStats.bestAskControlled
                ? `${makerStats.bestBidControlled ? 'Bid' : ''}${makerStats.bestBidControlled && makerStats.bestAskControlled ? ' / ' : ''}${makerStats.bestAskControlled ? 'Ask' : ''}`
                : 'No'}
            color={makerStats.spreadSetByMakers ? '#22c55e' : '#9ca3af'}
          />
        </div>
      )}

      {config.enableMarketMakers && (
        <div className="flex flex-col gap-1 shrink-0">
          <div className="text-gray-400 font-bold mb-1">Maker Inventory</div>
          <Metric label="Net" value={makerStats.netInventory.toLocaleString()} />
          <Metric label="Avg" value={makerStats.averageInventory.toFixed(1)} />
          <Metric label="Long / Short / Flat" value={`${makerStats.longCount} / ${makerStats.shortCount} / ${makerStats.flatCount}`} />
          <Metric label="Range" value={`${makerStats.minInventory} to ${makerStats.maxInventory}`} />
          <Metric label="Bid / Ask Vol" value={`${formatSize(makerStats.makerRestingBidVolume)} / ${formatSize(makerStats.makerRestingAskVolume)}`} />
        </div>
      )}

      {/* Order flow */}
      <div className="flex flex-col gap-1 shrink-0">
        <div className="text-gray-400 font-bold mb-1">Order Flow</div>
        <Metric
          label="Imbalance"
          value={formatPercent(orderFlowImbalance)}
          color={orderFlowImbalance > 0.1 ? '#22c55e' : orderFlowImbalance < -0.1 ? '#ef4444' : '#9ca3af'}
        />
        <div className="mt-1">
          <ImbalanceBar value={orderFlowImbalance} />
        </div>
      </div>

      {/* Support / Resistance */}
      <div className="flex flex-col gap-1 shrink-0">
        <div className="text-gray-400 font-bold mb-1">Support</div>
        {patterns.supportLevels.slice(0, 3).map((s, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-green-400">{formatPrice(s.price)}</span>
            <span className="text-gray-500">str:{s.strength}</span>
          </div>
        ))}
        {patterns.supportLevels.length === 0 && (
          <span className="text-gray-600">None detected</span>
        )}
      </div>

      <div className="flex flex-col gap-1 shrink-0">
        <div className="text-gray-400 font-bold mb-1">Resistance</div>
        {patterns.resistanceLevels.slice(0, 3).map((r, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-red-400">{formatPrice(r.price)}</span>
            <span className="text-gray-500">str:{r.strength}</span>
          </div>
        ))}
        {patterns.resistanceLevels.length === 0 && (
          <span className="text-gray-600">None detected</span>
        )}
      </div>

      {/* Liquidity zones */}
      <div className="flex flex-col gap-1 shrink-0">
        <div className="text-gray-400 font-bold mb-1">Liquidity Zones</div>
        {patterns.liquidityZones.slice(0, 4).map((z, i) => (
          <div key={i} className="flex gap-2">
            <span className={z.side === 'bid' ? 'text-green-400' : 'text-red-400'}>
              {formatPrice(z.price)}
            </span>
            <span className="text-gray-500">{formatSize(z.size)}</span>
          </div>
        ))}
        {patterns.liquidityZones.length === 0 && (
          <span className="text-gray-600">None detected</span>
        )}
      </div>

      {/* Breakouts */}
      <div className="flex flex-col gap-1 shrink-0">
        <div className="text-gray-400 font-bold mb-1">Signals</div>
        {patterns.breakouts.slice(-3).map((b, i) => (
          <div key={i} className="flex gap-2">
            <span className={b.direction === 'up' ? 'text-green-400' : 'text-red-400'}>
              {b.direction === 'up' ? '▲' : '▼'} {formatPrice(b.price)}
            </span>
          </div>
        ))}
        {patterns.volumeSpikes.slice(-3).map((v, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-yellow-400">⚡ Vol {v.ratio.toFixed(1)}x</span>
          </div>
        ))}
        {patterns.breakouts.length === 0 && patterns.volumeSpikes.length === 0 && (
          <span className="text-gray-600">None</span>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, color }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}:</span>
      <span className="font-mono" style={{ color: color || '#e5e7eb' }}>{value}</span>
    </div>
  );
}

function ImbalanceBar({ value }) {
  const pct = Math.abs(value) * 100;
  const isBullish = value > 0;
  return (
    <div className="w-32 h-2 bg-gray-800 rounded overflow-hidden relative">
      <div className="absolute inset-0 flex">
        <div className="w-1/2 flex justify-end">
          {!isBullish && (
            <div
              className="h-full rounded-l"
              style={{
                width: `${Math.min(pct, 100)}%`,
                background: '#ef4444',
              }}
            />
          )}
        </div>
        <div className="w-1/2">
          {isBullish && (
            <div
              className="h-full rounded-r"
              style={{
                width: `${Math.min(pct, 100)}%`,
                background: '#22c55e',
              }}
            />
          )}
        </div>
      </div>
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600" />
    </div>
  );
}
