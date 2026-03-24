import { useState } from 'react';
import { useSimulationStore } from '../store/simulationStore.js';
import { configRanges, marketMakerConfigRanges } from '../data/defaultConfig.js';

export default function SimulationControls({ sim }) {
  const { isRunning, isPaused, tick, speed, config } = useSimulationStore();
  const setSpeed = useSimulationStore((s) => s.setSpeed);
  const [expanded, setExpanded] = useState(false);

  const updateQuoteSize = (key, value) => {
    const nextRange = {
      ...(config.quoteSizeRange || { min: 1, max: 1 }),
      [key]: value,
    };
    if (nextRange.min > nextRange.max) {
      if (key === 'min') nextRange.max = value;
      else nextRange.min = value;
    }
    sim.updateConfig({ quoteSizeRange: nextRange });
  };

  const handleStart = () => {
    if (!isRunning) sim.start();
    else if (isPaused) sim.resume();
    else sim.pause();
  };

  const speeds = [1, 2, 5, 10, 20, 40];

  return (
    <div className="flex flex-col gap-3">
      {/* Transport controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleStart}
          className="flex-1 px-3 py-2 rounded font-bold text-sm transition-colors"
          style={{
            background: isRunning && !isPaused ? '#ef4444' : '#22c55e',
            color: '#fff',
          }}
        >
          {!isRunning ? '▶ Start' : isPaused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <button
          onClick={sim.step}
          className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm transition-colors"
        >
          ⏭ Step
        </button>
        <button
          onClick={sim.reset}
          className="px-3 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm transition-colors"
        >
          ↺ Reset
        </button>
      </div>

      {/* Speed controls */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-400 w-12">Speed:</span>
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className="px-2 py-1 rounded text-xs transition-colors"
            style={{
              background: speed === s ? '#3b82f6' : '#374151',
              color: speed === s ? '#fff' : '#9ca3af',
            }}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* Tick counter */}
      <div className="text-xs text-gray-500">
        Tick: <span className="text-gray-300 font-mono">{tick.toLocaleString()}</span>
      </div>

      {/* Expandable config */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-gray-400 hover:text-gray-200 text-left transition-colors"
      >
        {expanded ? '▾ Hide Parameters' : '▸ Show Parameters'}
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1 scrollbar-thin">
          {Object.entries(configRanges).map(([key, range]) => (
            <div key={key}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-400">{range.label}</span>
                <span className="text-gray-300 font-mono">
                  {typeof config[key] === 'number' && config[key] % 1 !== 0
                    ? config[key].toFixed(2)
                    : config[key]}
                </span>
              </div>
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step}
                value={config[key]}
                onChange={(e) => sim.updateConfig({ [key]: parseFloat(e.target.value) })}
                className="w-full h-1 rounded-lg appearance-none cursor-pointer"
                style={{ accentColor: '#3b82f6' }}
              />
            </div>
          ))}

          <div className="pt-2 mt-1 border-t border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-300 font-semibold">Market Makers</span>
              <button
                type="button"
                onClick={() => sim.updateConfig({ enableMarketMakers: !config.enableMarketMakers })}
                className="px-2 py-1 rounded text-[11px] transition-colors"
                style={{
                  background: config.enableMarketMakers ? '#14532d' : '#374151',
                  color: config.enableMarketMakers ? '#bbf7d0' : '#9ca3af',
                }}
              >
                {config.enableMarketMakers ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            {config.enableMarketMakers && (
              <div className="flex flex-col gap-2">
                {Object.entries(marketMakerConfigRanges).map(([key, range]) => {
                  const value = key === 'quoteSizeRangeMin'
                    ? config.quoteSizeRange?.min
                    : key === 'quoteSizeRangeMax'
                      ? config.quoteSizeRange?.max
                      : config[key];

                  return (
                    <div key={key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">{range.label}</span>
                        <span className="text-gray-300 font-mono">
                          {typeof value === 'number' && value % 1 !== 0
                            ? value.toFixed(2)
                            : value}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={range.min}
                        max={range.max}
                        step={range.step}
                        value={value}
                        onChange={(e) => {
                          const nextValue = parseFloat(e.target.value);
                          if (key === 'quoteSizeRangeMin') {
                            updateQuoteSize('min', nextValue);
                          } else if (key === 'quoteSizeRangeMax') {
                            updateQuoteSize('max', nextValue);
                          } else {
                            sim.updateConfig({ [key]: nextValue });
                          }
                        }}
                        className="w-full h-1 rounded-lg appearance-none cursor-pointer"
                        style={{ accentColor: '#22c55e' }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
