const query = window.matchMedia('(prefers-reduced-motion: reduce)');

export const motion = {
  reduced: query.matches,
  d(seconds: number): number {
    return this.reduced ? Math.min(seconds * 0.35, 0.4) : seconds;
  },
};

query.addEventListener('change', (e) => {
  motion.reduced = e.matches;
});
