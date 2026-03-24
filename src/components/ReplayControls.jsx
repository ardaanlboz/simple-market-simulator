import { useSimulationStore } from '../store/simulationStore.js';
import { exportCandles, exportTrades, exportJSON, saveConfig, loadConfig } from '../utils/export.js';

export default function ReplayControls({ sim }) {
  const candles = useSimulationStore((s) => s.candles);
  const recentTrades = useSimulationStore((s) => s.recentTrades);
  const history = useSimulationStore((s) => s.history);
  const config = useSimulationStore((s) => s.config);
  const tick = useSimulationStore((s) => s.tick);
  const setConfig = useSimulationStore((s) => s.setConfig);

  const handleExportCandles = () => {
    exportCandles(candles);
  };

  const handleExportTrades = () => {
    exportTrades(recentTrades);
  };

  const handleExportAll = () => {
    exportJSON({
      config,
      candles,
      trades: recentTrades,
      history,
      exportedAt: new Date().toISOString(),
    }, `sim-export-${Date.now()}.json`);
  };

  const handleSaveConfig = () => {
    saveConfig(config);
  };

  const handleLoadConfig = () => {
    const saved = loadConfig();
    if (saved) {
      setConfig(saved);
      sim.updateConfig(saved);
    }
  };

  return (
    <div className="flex gap-6 h-full text-xs items-start">
      {/* Export */}
      <div className="flex flex-col gap-2">
        <div className="text-gray-400 font-bold mb-1">Export Data</div>
        <div className="flex gap-2">
          <button
            onClick={handleExportCandles}
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            Candles CSV
          </button>
          <button
            onClick={handleExportTrades}
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            Trades CSV
          </button>
          <button
            onClick={handleExportAll}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            Export All JSON
          </button>
        </div>
      </div>

      {/* Config save/load */}
      <div className="flex flex-col gap-2">
        <div className="text-gray-400 font-bold mb-1">Settings</div>
        <div className="flex gap-2">
          <button
            onClick={handleSaveConfig}
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            Save Config
          </button>
          <button
            onClick={handleLoadConfig}
            className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
          >
            Load Config
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-col gap-1">
        <div className="text-gray-400 font-bold mb-1">Session</div>
        <div className="text-gray-500">
          Ticks: <span className="text-gray-300">{tick.toLocaleString()}</span>
        </div>
        <div className="text-gray-500">
          Candles: <span className="text-gray-300">{candles.length}</span>
        </div>
        <div className="text-gray-500">
          History pts: <span className="text-gray-300">{history.length}</span>
        </div>
      </div>
    </div>
  );
}
