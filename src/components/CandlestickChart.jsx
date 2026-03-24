import { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode } from 'lightweight-charts';
import { useSimulationStore } from '../store/simulationStore.js';

export default function CandlestickChart() {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const lineSeriesRef = useRef(null);
  const supportLinesRef = useRef([]);
  const resistanceLinesRef = useRef([]);

  const chartType = useSimulationStore((s) => s.chartType);
  const showPatterns = useSimulationStore((s) => s.showPatterns);

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0e17' },
        textColor: '#6b7280',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1a2235' },
        horzLines: { color: '#1a2235' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#374151', width: 1, style: 2 },
        horzLine: { color: '#374151', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#1f2937',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#1f2937',
        timeVisible: false,
        tickMarkFormatter: (time) => `${time}`,
      },
      handleScale: { axisPressedMouseMove: true },
      handleScroll: { vertTouchDrag: false },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    });

    const lineSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      visible: false,
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    lineSeriesRef.current = lineSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, []);

  // Toggle chart type
  useEffect(() => {
    if (candleSeriesRef.current) {
      candleSeriesRef.current.applyOptions({
        visible: chartType === 'candlestick',
      });
    }
    if (lineSeriesRef.current) {
      lineSeriesRef.current.applyOptions({
        visible: chartType === 'line',
      });
    }
  }, [chartType]);

  // Update data on each tick
  useEffect(() => {
    const unsub = useSimulationStore.subscribe((state) => {
      const { candles, currentCandle, patterns } = state;
      if (!candleSeriesRef.current) return;

      // Build candle data
      const allCandles = [...candles];
      if (currentCandle) allCandles.push(currentCandle);

      if (allCandles.length === 0) return;

      const candleData = allCandles.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const lineData = allCandles.map((c) => ({
        time: c.time,
        value: c.close,
      }));

      const volumeData = allCandles.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)',
      }));

      candleSeriesRef.current.setData(candleData);
      lineSeriesRef.current.setData(lineData);
      volumeSeriesRef.current.setData(volumeData);

      // Pattern overlays
      if (showPatterns && chartRef.current) {
        // Clear old lines
        for (const line of supportLinesRef.current) {
          candleSeriesRef.current.removePriceLine(line);
        }
        for (const line of resistanceLinesRef.current) {
          candleSeriesRef.current.removePriceLine(line);
        }
        supportLinesRef.current = [];
        resistanceLinesRef.current = [];

        // Draw support levels
        for (const s of patterns.supportLevels.slice(0, 3)) {
          const line = candleSeriesRef.current.createPriceLine({
            price: s.price,
            color: 'rgba(34, 197, 94, 0.5)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `S`,
          });
          supportLinesRef.current.push(line);
        }

        // Draw resistance levels
        for (const r of patterns.resistanceLevels.slice(0, 3)) {
          const line = candleSeriesRef.current.createPriceLine({
            price: r.price,
            color: 'rgba(239, 68, 68, 0.5)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: `R`,
          });
          resistanceLinesRef.current.push(line);
        }
      }
    });

    return unsub;
  }, [showPatterns]);

  return (
    <div ref={containerRef} className="w-full h-full" />
  );
}
