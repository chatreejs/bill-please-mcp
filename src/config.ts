const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: int(Bun.env.PORT, 3001),
  corsOrigins: (Bun.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  maxImageBytes: int(Bun.env.MAX_IMAGE_BYTES, 5 * 1024 * 1024),
  rateLimitPerMinute: int(Bun.env.RATE_LIMIT_PER_MINUTE, 30),
  trustProxy: Bun.env.TRUST_PROXY === 'true',
  scanner: Bun.env.SCANNER ?? 'mock',
  mockMinDelayMs: int(Bun.env.MOCK_MIN_DELAY_MS, 5000),
  mockMaxDelayMs: int(Bun.env.MOCK_MAX_DELAY_MS, 10000),
};

export type Config = typeof config;
