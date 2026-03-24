import { useRef, useEffect } from 'react';
import { useSimulationStore } from '../store/simulationStore.js';

export default function DepthChart() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const unsub = useSimulationStore.subscribe((state) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const { bidDepth, askDepth } = state.cumulativeDepth;
      if (bidDepth.length === 0 && askDepth.length === 0) return;

      const ctx = canvas.getContext('2d');
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      const w = rect.width;
      const h = rect.height;

      ctx.clearRect(0, 0, w, h);

      // Find ranges
      const allPrices = [
        ...bidDepth.map((d) => d.price),
        ...askDepth.map((d) => d.price),
      ];
      const allCum = [
        ...bidDepth.map((d) => d.cumulative),
        ...askDepth.map((d) => d.cumulative),
      ];

      if (allPrices.length === 0) return;

      const minPrice = Math.min(...allPrices);
      const maxPrice = Math.max(...allPrices);
      const maxCum = Math.max(...allCum, 1);
      const priceRange = maxPrice - minPrice || 1;

      const toX = (price) => ((price - minPrice) / priceRange) * w;
      const toY = (cum) => h - (cum / maxCum) * (h - 20);

      // Draw bid depth (green, right to left)
      if (bidDepth.length > 0) {
        ctx.beginPath();
        ctx.moveTo(toX(bidDepth[0].price), h);
        for (const d of bidDepth) {
          ctx.lineTo(toX(d.price), toY(d.cumulative));
        }
        ctx.lineTo(toX(bidDepth[bidDepth.length - 1].price), h);
        ctx.closePath();
        ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i < bidDepth.length; i++) {
          const d = bidDepth[i];
          if (i === 0) ctx.moveTo(toX(d.price), toY(d.cumulative));
          else ctx.lineTo(toX(d.price), toY(d.cumulative));
        }
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Draw ask depth (red, left to right)
      if (askDepth.length > 0) {
        ctx.beginPath();
        ctx.moveTo(toX(askDepth[0].price), h);
        for (const d of askDepth) {
          ctx.lineTo(toX(d.price), toY(d.cumulative));
        }
        ctx.lineTo(toX(askDepth[askDepth.length - 1].price), h);
        ctx.closePath();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i < askDepth.length; i++) {
          const d = askDepth[i];
          if (i === 0) ctx.moveTo(toX(d.price), toY(d.cumulative));
          else ctx.lineTo(toX(d.price), toY(d.cumulative));
        }
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Mid price line
      const mid = state.midPrice;
      if (mid) {
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.moveTo(toX(mid), 0);
        ctx.lineTo(toX(mid), h);
        ctx.strokeStyle = '#6b7280';
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
