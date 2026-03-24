/**
 * useSimulation — bridge between SimulationLoop engine and React.
 * Creates engine on mount, wires callbacks to Zustand store.
 */

import { useRef, useEffect, useCallback } from 'react';
import { SimulationLoop } from '../engine/simulationLoop.js';
import { useSimulationStore } from '../store/simulationStore.js';
import { createOrder } from '../engine/orderBook.js';

/**
 * Process user fill records arriving from the engine callback.
 * Handles both latency-delayed fills and resting-order fills.
 */
function processUserFills(store, data) {
  if (!data.userFills || data.userFills.length === 0) return;

  for (const fill of data.userFills) {
    if (fill.isRestingFill) {
      // A resting limit order was hit by another agent
      store.getState().recordUserTrade({
        side: fill.side,
        price: fill.trades[0].price,
        size: fill.trades[0].size,
        tick: fill.trades[0].tick,
        timestamp: fill.trades[0].timestamp,
        isForcedCover: !!fill.isForcedCover,
      });
    } else {
      // Our order arrived (possibly after delay) and matched
      const { order, trades, summary } = fill;
      const side = order.side;
      if (order.type === 'market' && summary?.filledSize > 0) {
        store.getState().recordUserTrade({
          side,
          price: summary.averageFillPrice,
          size: summary.filledSize,
          tick: summary.tick ?? data.tick,
          timestamp: summary.timestamp,
          arrivalPrice: summary.arrivalPrice,
          referencePrice: summary.referencePrice,
          slippage: summary.totalSlippage,
          slippageBps: summary.totalSlippageBps,
          impactSlippage: summary.quoteSlippage,
          impactSlippageBps: summary.quoteSlippageBps,
          levelsSwept: summary.levelsSwept,
          quoteFadeVolume: summary.quoteFadeVolume,
          isForcedCover: !!fill.isForcedCover,
        });
      } else {
        for (const trade of trades) {
          store.getState().recordUserTrade({
            side,
            price: trade.price,
            size: trade.size,
            tick: trade.tick,
            timestamp: trade.timestamp,
            isForcedCover: !!fill.isForcedCover,
          });
        }
      }
    }
  }
}

function createEngineCallback(store) {
  return (data) => {
    store.getState().updateFromEngine(data);
    processUserFills(store, data);
  };
}

export function useSimulation() {
  const engineRef = useRef(null);
  const store = useSimulationStore;
  const config = useSimulationStore((s) => s.config);
  const speed = useSimulationStore((s) => s.speed);

  // Initialize engine
  useEffect(() => {
    const engine = new SimulationLoop(config, createEngineCallback(store));
    engineRef.current = engine;
    // Push initial state
    engine._pushUpdate();
    return () => engine.destroy();
    // Only create once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync speed changes
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setSpeed(speed);
    }
  }, [speed]);

  const start = useCallback(() => {
    engineRef.current?.start();
  }, []);

  const pause = useCallback(() => {
    engineRef.current?.pause();
  }, []);

  const resume = useCallback(() => {
    engineRef.current?.resume();
  }, []);

  const step = useCallback(() => {
    engineRef.current?.step();
  }, []);

  const reset = useCallback(() => {
    const state = store.getState();
    const engine = new SimulationLoop(state.config, createEngineCallback(store));
    engineRef.current?.destroy();
    engineRef.current = engine;
    state.resetUser();
    engine._pushUpdate();
  }, [store]);

  const updateConfig = useCallback((updates) => {
    store.getState().setConfig(updates);
    if (engineRef.current) {
      engineRef.current.updateConfig(updates);
    }
  }, [store]);

  const placeUserOrder = useCallback(({ side, type, price, size }) => {
    const engine = engineRef.current;
    if (!engine) return;

    const state = store.getState();
    const order = createOrder({
      side,
      type,
      price: type === 'limit' ? price : null,
      size,
      agentId: 'user',
      tick: state.tick,
      lifetime: type === 'limit' ? 5000 : null,
    });

    if (engine.config.enableLatency) {
      // Schedule through the event queue — fills arrive via callback later
      engine.scheduleUserOrder(order);
    } else {
      engine.processUserOrder(order);
    }
  }, [store]);

  const cancelUserOrder = useCallback((orderId) => {
    const engine = engineRef.current;
    if (!engine) return;

    if (engine.config.enableLatency) {
      engine.scheduleUserCancel(orderId);
    } else {
      engine.cancelUserOrder(orderId);
    }
  }, []);

  const getEngine = useCallback(() => engineRef.current, []);

  return {
    start,
    pause,
    resume,
    step,
    reset,
    updateConfig,
    placeUserOrder,
    cancelUserOrder,
    getEngine,
  };
}
