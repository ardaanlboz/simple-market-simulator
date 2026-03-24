/**
 * Export utilities — save simulation data as JSON or CSV.
 */

export function exportJSON(data, filename = 'simulation-data.json') {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}

export function exportCSV(rows, headers, filename = 'simulation-data.csv') {
  const headerLine = headers.join(',');
  const lines = rows.map(row =>
    headers.map(h => {
      const val = row[h];
      if (typeof val === 'string' && val.includes(',')) return `"${val}"`;
      return val ?? '';
    }).join(',')
  );
  const csv = [headerLine, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportCandles(candles) {
  exportCSV(
    candles,
    ['time', 'open', 'high', 'low', 'close', 'volume'],
    'candles.csv'
  );
}

export function exportTrades(trades) {
  exportCSV(
    trades,
    ['id', 'price', 'size', 'aggressor', 'buyAgentId', 'sellAgentId', 'tick', 'timestamp'],
    'trades.csv'
  );
}

export function saveConfig(config) {
  localStorage.setItem('market-sim-config', JSON.stringify(config));
}

export function loadConfig() {
  const saved = localStorage.getItem('market-sim-config');
  return saved ? JSON.parse(saved) : null;
}
