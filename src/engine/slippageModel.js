function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sumLevelSize(level) {
  return level.orders.reduce((sum, order) => sum + order.remainingSize, 0);
}

function sumTradeNotional(trades) {
  return trades.reduce((sum, trade) => sum + trade.price * trade.size, 0);
}

export function getBookPressure(oppositeLevels, orderSize, config, marketState) {
  const depthLevels = Math.max(2, Math.round(config.slippageDepthLevels || 6));
  const levels = oppositeLevels
    .slice(0, depthLevels)
    .map((level, index) => ({
      level,
      index,
      price: level.price,
      size: sumLevelSize(level),
    }))
    .filter((snapshot) => snapshot.size > 0);

  const topLevelSize = levels[0]?.size || 0;
  const nearbyDepth = levels.reduce((sum, snapshot) => sum + snapshot.size, 0);
  const tickSize = config.tickSize || 0.01;
  const spread = marketState.spread ?? tickSize;
  const spreadTicks = spread / tickSize;
  const velocityTicks = Math.abs(marketState.priceVelocity || 0) / tickSize;
  const volatilityTicks = (marketState.volatility || 0) * Math.max(1, marketState.midPrice || 1) / tickSize;

  const sizeVsTop = topLevelSize > 0 ? orderSize / topLevelSize : orderSize;
  const sizeVsDepth = nearbyDepth > 0 ? orderSize / nearbyDepth : orderSize;
  const targetDepth = Math.max(
    (config.baseOrderSize || 1) * depthLevels * 6,
    orderSize * 2
  );
  const thinness = clamp(1 - nearbyDepth / Math.max(1, targetDepth), 0, 1);

  const sizePressure = Math.max(0, sizeVsDepth - 0.1);
  const sweepPressure = Math.max(0, sizeVsTop - 0.85);
  const nonlinearPressure = sizePressure ** 2.2 + sweepPressure ** 1.8 * 0.7;
  const spreadPressure = Math.max(0, spreadTicks - 1) / 8;
  const speedPressure = clamp(velocityTicks / 10 + volatilityTicks / 20, 0, 2);
  const intensity = clamp(config.slippageIntensity ?? 1, 0, 3);
  const impactScore = nonlinearPressure * (
    1 +
    spreadPressure * 0.8 +
    speedPressure * 0.6 +
    thinness * 0.9
  ) * intensity;

  return {
    levels,
    orderSize,
    topLevelSize,
    nearbyDepth,
    thinness,
    spread,
    spreadTicks,
    speedPressure,
    sizeVsTop,
    sizeVsDepth,
    impactScore,
  };
}

export function computeLiquidityFade(bookPressure) {
  const shouldApplyImpact = bookPressure.topLevelSize > 0 && (
    bookPressure.sizeVsTop >= 0.75 || bookPressure.sizeVsDepth >= 0.25
  );

  if (!shouldApplyImpact || bookPressure.levels.length === 0) {
    return [];
  }

  const fadeBase = clamp(bookPressure.impactScore * 0.06, 0, 0.45);

  if (fadeBase <= 0) {
    return [];
  }

  const adjustments = [];
  let cumulativeDepth = 0;

  for (const snapshot of bookPressure.levels) {
    const reachPressure = clamp(
      (bookPressure.orderSize - cumulativeDepth)
      / Math.max(1, snapshot.size),
      0,
      2
    );
    const depthWeight = 0.35 + (snapshot.index / Math.max(1, bookPressure.levels.length - 1)) * 0.9;
    const fadeRatio = clamp(fadeBase * depthWeight * reachPressure, 0, 0.75);
    const fadeSize = Math.floor(snapshot.size * fadeRatio);

    if (fadeSize > 0) {
      adjustments.push({ index: snapshot.index, fadeSize });
    }

    cumulativeDepth += snapshot.size;
  }

  return adjustments;
}

export function summarizeExecution(order, trades, context) {
  const filledSize = trades.reduce((sum, trade) => sum + trade.size, 0);
  const averageFillPrice = filledSize > 0
    ? sumTradeNotional(trades) / filledSize
    : null;
  const levelsSwept = new Set(trades.map((trade) => trade.price)).size;
  const sign = order.side === 'buy' ? 1 : -1;

  const arrivalPrice = context.arrivalPrice ?? context.referencePrice ?? averageFillPrice;
  const referencePrice = context.referencePrice ?? arrivalPrice ?? averageFillPrice;
  const quoteSlippage = averageFillPrice != null && arrivalPrice != null
    ? sign * (averageFillPrice - arrivalPrice)
    : null;
  const totalSlippage = averageFillPrice != null && referencePrice != null
    ? sign * (averageFillPrice - referencePrice)
    : null;

  return {
    side: order.side,
    requestedSize: order.size,
    filledSize,
    unfilledSize: Math.max(0, order.size - filledSize),
    averageFillPrice,
    arrivalPrice,
    referencePrice,
    quoteSlippage,
    quoteSlippageBps: quoteSlippage != null && arrivalPrice
      ? (quoteSlippage / arrivalPrice) * 10000
      : null,
    totalSlippage,
    totalSlippageBps: totalSlippage != null && referencePrice
      ? (totalSlippage / referencePrice) * 10000
      : null,
    levelsSwept,
    topLevelSize: context.topLevelSize,
    nearbyDepth: context.nearbyDepth,
    depthConsumedRatio: context.nearbyDepth > 0
      ? filledSize / context.nearbyDepth
      : null,
    quoteFadeVolume: context.quoteFadeVolume || 0,
    impactScore: context.impactScore || 0,
    thinness: context.thinness || 0,
    speedPressure: context.speedPressure || 0,
    spread: context.spread ?? null,
    tick: trades[trades.length - 1]?.tick ?? null,
    timestamp: trades[trades.length - 1]?.timestamp ?? Date.now(),
  };
}
