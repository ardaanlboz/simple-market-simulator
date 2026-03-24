/**
 * useSimulation — bridge between SimulationLoop engine and React.
 * Creates engine on mount, wires callbacks to Zustand store.
 */

import { useRef, useEffect, useCallback } from 'react';
import { SimulationLoop } from '../engine/simulationLoop.js';
import { useSimulationStore } from '../store/simulationStore.js';
import { createOrder } from '../engine/orderBook.js';

export function useSimulation() {
  const engineRef = useRef(null);
  const store = useSimulationStore;
  const config = useSimulationStore((s) => s.config);
  const speed = useSimulationStore((s) => s.speed);

  // Initialize engine
  useEffect(() => {
    const engine = new SimulationLoop(config, (data) => {
      store.getState().updateFromEngine(data);
      store.getState().updateUnrealizedPnl();
    });
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
    const engine = new SimulationLoop(state.config, (data) => {
      store.getState().updateFromEngine(data);
      store.getState().updateUnrealizedPnl();
    });
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

    const trades = engine.processUserOrder(order);

    // Record fills
    for (const trade of trades) {
      store.getState().recordUserTrade({
        side,
        price: trade.price,
        size: trade.size,
        tick: trade.tick,
        timestamp: trade.timestamp,
      });
    }

    // Track resting limit orders
    if (type === 'limit' && order.remainingSize > 0 && order.status === 'open') {
      store.getState().addUserOrder(order);
    }
  }, [store]);

  const cancelUserOrder = useCallback((orderId) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.cancelUserOrder(orderId);
    store.getState().removeUserOrder(orderId);
  }, [store]);

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
