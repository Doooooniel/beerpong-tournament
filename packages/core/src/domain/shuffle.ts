/** Fisher-Yates mit übergebenem Zufall in [0, 1) (Architekturregel 4: Zufall nur aus ctx). */
export const shuffle = <T>(items: readonly T[], random: () => number): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
};
