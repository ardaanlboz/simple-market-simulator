import { useSimulationStore } from '../store/simulationStore.js';
import SimulationControls from './SimulationControls.jsx';
import CandlestickChart from './CandlestickChart.jsx';
import OrderBookDisplay from './OrderBookDisplay.jsx';
import DepthChart from './DepthChart.jsx';
import TradeTape from './TradeTape.jsx';
import ManualTrading from './ManualTrading.jsx';
import MetricsPanel from './MetricsPanel.jsx';
import EducationPanel from './EducationPanel.jsx';
import ReplayControls from './ReplayControls.jsx';
import LiquidityHeatmap from './LiquidityHeatmap.jsx';

export default function Layout({ sim }) {
  const activePanel = useSimulationStore((s) => s.activePanel);
  const bottomPanel = useSimulationStore((s) => s.bottomPanel);
  const chartType = useSimulationStore((s) => s.chartType);
  const showPatterns = useSimulationStore((s) => s.showPatterns);
  const setActivePanel = useSimulationStore((s) => s.setActivePanel);
  const setBottomPanel = useSimulationStore((s) => s.setBottomPanel);
  const setChartType = useSimulationStore((s) => s.setChartType);
  const setShowPatterns = useSimulationStore((s) => s.setShowPatterns);
  const lastPrice = useSimulationStore((s) => s.lastPrice);
  const tick = useSimulationStore((s) => s.tick);

  return (
    <div className="h-screen flex flex-col" style={{ background: '#0a0e17' }}>
      {/* Top bar */}
      <header
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: '#1f2937' }}
      >
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold text-gray-200 tracking-wide">
            MARKET SIMULATOR
          </h1>
          <span className="text-xs text-gray-500">|</span>
          <span className="text-sm font-mono font-bold text-gray-100">
            {lastPrice?.toFixed(2)}
          </span>
          <span className="text-xs text-gray-500">T:{tick}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Chart type toggle */}
          <button
            onClick={() => setChartType(chartType === 'candlestick' ? 'line' : 'candlestick')}
            className="px-2 py-1 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
          >
            {chartType === 'candlestick' ? 'Candles' : 'Line'}
          </button>
          {/* Pattern toggle */}
          <button
            onClick={() => setShowPatterns(!showPatterns)}
            className="px-2 py-1 rounded text-xs transition-colors"
            style={{
              background: showPatterns ? '#1e3a5f' : '#374151',
              color: showPatterns ? '#60a5fa' : '#6b7280',
            }}
          >
            S/R Lines
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — controls */}
        <aside
          className="w-60 shrink-0 border-r p-3 overflow-y-auto scrollbar-thin"
          style={{ borderColor: '#1f2937' }}
        >
          <SimulationControls sim={sim} />
        </aside>

        {/* Center — chart */}
        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0">
            <CandlestickChart />
          </div>
        </main>

        {/* Right panel — order book, depth, tape, heatmap */}
        <aside
          className="w-72 shrink-0 border-l flex flex-col"
          style={{ borderColor: '#1f2937' }}
        >
          {/* Panel tabs */}
          <div className="flex border-b" style={{ borderColor: '#1f2937' }}>
            {[
              { id: 'orderbook', label: 'Book' },
              { id: 'depth', label: 'Depth' },
              { id: 'tape', label: 'Tape' },
              { id: 'heatmap', label: 'Heat' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActivePanel(tab.id)}
                className="flex-1 py-2 text-xs transition-colors"
                style={{
                  background: activePanel === tab.id ? '#1a2235' : 'transparent',
                  color: activePanel === tab.id ? '#e5e7eb' : '#6b7280',
                  borderBottom: activePanel === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 min-h-0">
            {activePanel === 'orderbook' && <OrderBookDisplay />}
            {activePanel === 'depth' && <DepthChart />}
            {activePanel === 'tape' && <TradeTape />}
            {activePanel === 'heatmap' && <LiquidityHeatmap />}
          </div>
        </aside>
      </div>

      {/* Bottom panel */}
      <div className="border-t" style={{ borderColor: '#1f2937', height: '200px' }}>
        {/* Bottom tabs */}
        <div className="flex border-b" style={{ borderColor: '#1f2937' }}>
          {[
            { id: 'trading', label: 'Manual Trading' },
            { id: 'metrics', label: 'Metrics & Patterns' },
            { id: 'replay', label: 'Export & Replay' },
            { id: 'education', label: 'Learn' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setBottomPanel(tab.id)}
              className="px-4 py-1.5 text-xs transition-colors"
              style={{
                background: bottomPanel === tab.id ? '#1a2235' : 'transparent',
                color: bottomPanel === tab.id ? '#e5e7eb' : '#6b7280',
                borderBottom: bottomPanel === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Bottom content */}
        <div className="h-[calc(100%-32px)] p-3 overflow-hidden">
          {bottomPanel === 'trading' && <ManualTrading sim={sim} />}
          {bottomPanel === 'metrics' && <MetricsPanel />}
          {bottomPanel === 'replay' && <ReplayControls sim={sim} />}
          {bottomPanel === 'education' && <EducationPanel />}
        </div>
      </div>
    </div>
  );
}
