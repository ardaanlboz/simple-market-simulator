import { useState } from 'react';

const topics = [
  {
    title: 'What is an Order Book?',
    content: `An order book is a list of all outstanding buy and sell orders for an asset, organized by price level. Buy orders (bids) are on one side, sell orders (asks) on the other. The highest bid and lowest ask form the "inside market" — the best prices currently available.

When a new order arrives that can match against an existing order on the opposite side, a trade occurs. If there's no match, the order rests in the book until it's filled, cancelled, or expires.`,
  },
  {
    title: 'What is Resting Liquidity?',
    content: `Resting liquidity refers to limit orders sitting in the order book waiting to be filled. These are passive orders — they provide liquidity for others to trade against.

When many limit buy orders cluster at a price level, they form a "wall" of liquidity. The price must consume all those orders before it can drop below that level. This is how support forms. The same logic applies in reverse for sell orders creating resistance.`,
  },
  {
    title: 'How Support Emerges',
    content: `Support levels emerge when many buy orders accumulate at or near a price level. In this simulation, random agents independently place limit buy orders. When multiple agents happen to place orders near similar prices — especially round numbers — a cluster forms.

As the price drops toward this cluster, incoming sell orders are absorbed by the resting buy orders. If the cluster is large enough, it stops the price from falling further. Each time price bounces off this level, it reinforces the perception of support — even though the agents placing these orders are acting randomly.`,
  },
  {
    title: 'How Resistance Emerges',
    content: `Resistance is the mirror of support. When many sell orders cluster at a price level, they form a barrier that prevents the price from rising further.

Random agents placing sell limits near similar prices create these barriers. When buying pressure pushes the price up into this zone, it gets absorbed by the resting sell orders. The price stalls or reverses — creating resistance. Resistance breaks when buying pressure finally exhausts all the sell orders at that level.`,
  },
  {
    title: 'Why Random Agents Create Patterns',
    content: `Even with purely random agents, recognizable chart patterns emerge because:

1. Clustering is natural — random numbers cluster. When 150 agents independently pick prices, some will overlap, especially near round numbers.

2. Order persistence — limit orders rest in the book for many ticks. This creates memory in the system even though agents are memoryless.

3. Price is emergent — price comes from actual order matching, not random generation. The order book acts as a filter that turns random intent into structured price action.

4. Asymmetric impact — a burst of market buys against thin liquidity moves price up sharply, while resting limits absorb gradual flow. This asymmetry creates trends, spikes, and reversals.`,
  },
  {
    title: 'The Spread and Price Discovery',
    content: `The spread is the gap between the best bid (highest buy) and the best ask (lowest sell). It represents the cost of immediately transacting.

A narrow spread means tight competition between buyers and sellers. A wide spread signals thin liquidity or high uncertainty.

Price discovery happens as market orders cross the spread and trade against resting limit orders. Each trade prints a new "last price" — the sequence of these prints forms the chart you see.`,
  },
  {
    title: 'Order Flow Imbalance',
    content: `Order flow imbalance measures whether there's more buying or selling pressure in the book. When bid volume significantly exceeds ask volume, there's bullish imbalance — and vice versa.

In this simulation, imbalance shifts randomly as agents add and remove orders. But temporary imbalances can persist long enough to drive price moves, creating trends and reversals that look intentional but are purely emergent.`,
  },
];

export default function EducationPanel() {
  const [activeIdx, setActiveIdx] = useState(0);

  return (
    <div className="flex h-full text-xs">
      {/* Topic list */}
      <div className="w-56 shrink-0 border-r border-gray-800 overflow-y-auto scrollbar-thin">
        {topics.map((topic, i) => (
          <button
            key={i}
            onClick={() => setActiveIdx(i)}
            className="w-full text-left px-3 py-2 transition-colors"
            style={{
              background: activeIdx === i ? '#1a2235' : 'transparent',
              color: activeIdx === i ? '#e5e7eb' : '#6b7280',
            }}
          >
            {topic.title}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 px-4 py-2 overflow-y-auto scrollbar-thin">
        <h3 className="text-sm font-bold text-gray-200 mb-3">
          {topics[activeIdx].title}
        </h3>
        <p className="text-gray-400 leading-relaxed whitespace-pre-line">
          {topics[activeIdx].content}
        </p>
      </div>
    </div>
  );
}
