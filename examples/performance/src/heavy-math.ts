export interface VariantSummary {
  id: string;
  checksum: number;
  phases: number[];
}

const fib = (n: number): number => {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
};

export const calculateSignalVariants = (seed: number): VariantSummary[] => {
  return Array.from({ length: 3 }, (_, index) => {
    const depth = seed + index + 20;
    const checksum = fib(Math.min(32, depth));
    const phases = Array.from({ length: 4 }, (__, phaseIndex) =>
      Math.sin((depth + phaseIndex) / 5).valueOf(),
    );
    return {
      id: `variant-${seed}-${index}`,
      checksum,
      phases,
    } satisfies VariantSummary;
  });
};
