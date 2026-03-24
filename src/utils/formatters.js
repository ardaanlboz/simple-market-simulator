/**
 * Formatting utilities for prices, volumes, and numbers.
 */

export function formatPrice(price, decimals = 2) {
  if (price == null || isNaN(price)) return '—';
  return price.toFixed(decimals);
}

export function formatSize(size) {
  if (size == null || isNaN(size)) return '—';
  if (size >= 1000000) return (size / 1000000).toFixed(1) + 'M';
  if (size >= 1000) return (size / 1000).toFixed(1) + 'K';
  return size.toFixed(0);
}

export function formatPercent(value, decimals = 2) {
  if (value == null || isNaN(value)) return '—';
  return (value * 100).toFixed(decimals) + '%';
}

export function formatPnl(value) {
  if (value == null || isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return sign + value.toFixed(2);
}

export function formatTimestamp(ts) {
  const date = new Date(ts);
  return date.toLocaleTimeString();
}

export function formatTick(tick) {
  return `T${tick}`;
}

export function classNames(...args) {
  return args.filter(Boolean).join(' ');
}
