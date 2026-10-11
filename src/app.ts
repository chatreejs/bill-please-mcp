import { cors } from '@elysiajs/cors';
import { Elysia } from 'elysia';
import { rateLimit } from 'elysia-rate-limit';

import type { Config } from './config.ts';
import { mcpRoutes } from './mcp/route.ts';
import { receiptRoutes } from './routes/receipts.ts';
import type { ReceiptScanner } from './scanners/index.ts';

export const createApp = (config: Config, scanner: ReceiptScanner) =>
  new Elysia()
    .use(cors({ origin: config.corsOrigins }))
    .get('/health', () => ({ status: 'ok' }))
    .use(
      rateLimit({
        duration: 60_000,
        max: config.rateLimitPerMinute,
        skip: (request) => new URL(request.url).pathname === '/health',
        generator: (request, server) =>
          (config.trustProxy
            ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
            : undefined) ??
          server?.requestIP(request)?.address ??
          '',
      }),
    )
    .use(receiptRoutes(config, scanner))
    .use(mcpRoutes(config, scanner));
