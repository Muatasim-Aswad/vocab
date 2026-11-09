export type NowMs = () => number;

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

const systemNowMs: NowMs = () => Date.now();

function createNowIso(nowMs: NowMs): () => string {
  return () => toIso(nowMs());
}

export const systemNowIso = createNowIso(systemNowMs);
