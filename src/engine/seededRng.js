/**
 * Seeded pseudo-random number generator using Mulberry32.
 * Produces repeatable sequences from a given seed.
 */
export class SeededRng {
  constructor(seed = 42) {
    this.seed = seed;
    this.state = seed;
  }

  /** Reset to initial seed */
  reset() {
    this.state = this.seed;
  }

  /** Core Mulberry32 — returns float in [0, 1) */
  next() {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max) */
  float(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive */
  int(min, max) {
    return Math.floor(this.float(min, max + 1));
  }

  /** Boolean with given probability of true */
  bool(p = 0.5) {
    return this.next() < p;
  }

  /** Gaussian (normal) distribution via Box-Muller */
  gaussian(mean = 0, stddev = 1) {
    const u1 = this.next();
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stddev;
  }

  /** Exponential distribution with rate lambda */
  exponential(lambda = 1) {
    return -Math.log(this.next() || 1e-10) / lambda;
  }

  /** Pick from array of { value, weight } objects */
  weightedChoice(options) {
    const totalWeight = options.reduce((sum, o) => sum + o.weight, 0);
    let r = this.next() * totalWeight;
    for (const option of options) {
      r -= option.weight;
      if (r <= 0) return option.value;
    }
    return options[options.length - 1].value;
  }

  /** Pick random element from array */
  pick(arr) {
    if (arr.length === 0) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Log-normal distribution — produces right-skewed positive values */
  logNormal(mu = 0, sigma = 1) {
    return Math.exp(this.gaussian(mu, sigma));
  }

  /** Pareto distribution — rare large values */
  pareto(alpha = 1.5, xMin = 1) {
    return xMin / Math.pow(this.next() || 1e-10, 1 / alpha);
  }
}
