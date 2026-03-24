import { useRef, useEffect } from 'react';
import { useSimulationStore } from '../store/simulationStore.js';

/**
 * Canvas-based liquidity heatmap showing order density at each price level.
 * Brighter = more liquidity. Green = bids, Red = asks.
 */
export default function LiquidityHeatmap() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const unsub = useSimulationStore.subscribe((state) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const { bidLevels, askLevels, midPrice } = state;
      if (bidLevels.length === 0 && askLevels.length === 0) return;

      const parent = canvas.parentElement;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = w * window.devicePixelRatio;
      canvas.height = h * window.devicePixelRatio;

      const ctx = canvas.getContext('2d');
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      ctx.clearRect(0, 0, w, h);

      const allLevels = [
        ...bidLevels.map((l) => ({ ...l, side: 'bid' })),
        ...askLevels.map((l) => ({ ...l, side: 'ask' })),
      ];

      if (allLevels.length === 0) return;

      const prices = allLevels.map((l) => l.price);
      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      const maxSize = Math.max(...allLevels.map((l) => l.size), 1);
      const range = maxP - minP || 1;

      const barHeight = Math.max(2, h / allLevels.length);

      for (const level of allLevels) {
        const y = h - ((level.price - minP) / range) * h;
        const intensity = Math.min(1, level.size / maxSize);

        if (level.side === 'bid') {
          ctx.fillStyle = `rgba(34, 197, 94, ${0.1 + intensity * 0.8})`;
        } else {
          ctx.fillStyle = `rgba(239, 68, 68, ${0.1 + intensity * 0.8})`;
        }

        const barWidth = intensity * w;
        ctx.fillRect(0, y - barHeight / 2, barWidth, barHeight);
      }

      // Mid price line
      if (midPrice) {
        const midY = h - ((midPrice - minP) / range) * h;
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.moveTo(0, midY);
        ctx.lineTo(w, midY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    return unsub;
  }, []);

  return (
    <div className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: 'block' }}
      />
    </div>
  );
}
