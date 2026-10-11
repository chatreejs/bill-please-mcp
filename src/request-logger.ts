import { Elysia } from 'elysia';

import type { Config } from './config.ts';
import { getLogger, logContext } from './logger.ts';

const log = getLogger('http.access');

const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

// Kubernetes liveness/readiness probes and the Docker HEALTHCHECK (wget)
const PROBE_USER_AGENT = /^(kube-probe|wget)\//i;

/** Client IP, trusting X-Forwarded-For only behind our own reverse proxy */
export const clientIp = (
  request: Request,
  server: { requestIP: (request: Request) => { address: string } | null } | null,
  trustProxy: boolean,
) =>
  (trustProxy ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined) ??
  server?.requestIP(request)?.address ??
  '';

/**
 * Assigns every request an id (reusing a sane incoming `X-Request-Id`), exposes
 * it to all loggers via `logContext`, echoes it back in the response header and
 * writes one access log line per request.
 */
export const requestLogger = (config: Config) =>
  new Elysia({ name: 'request-logger' })
    .onRequest(({ request, set, server }) => {
      const incoming = request.headers.get('x-request-id');
      const requestId =
        incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID().slice(0, 8);
      logContext.enterWith({
        requestId,
        startedAt: performance.now(),
        // Resolve now: Bun can no longer see the socket once the response is sent
        clientIp: clientIp(request, server, config.trustProxy),
      });
      set.headers['x-request-id'] = requestId;
    })
    .onError({ as: 'global' }, ({ code, error, request }) => {
      // Expected client errors (404, validation) are covered by the access log
      if (code === 'NOT_FOUND' || code === 'VALIDATION' || code === 'PARSE') return;
      log.error(`Unhandled error on ${request.method} ${new URL(request.url).pathname}`, error);
    })
    .onAfterResponse({ as: 'global' }, ({ request, set, responseValue }) => {
      const context = logContext.getStore();
      const path = new URL(request.url).pathname;
      const status =
        responseValue instanceof Response ? responseValue.status : Number(set.status ?? 200);
      const duration = context ? Math.round(performance.now() - context.startedAt) : 0;
      const userAgent = request.headers.get('user-agent') ?? '';
      // JSON-quoted: user agents contain spaces and must not break the single line
      const line = `${request.method} ${path} ${status} ${duration}ms ip=${context?.clientIp || '-'} ua=${userAgent ? JSON.stringify(userAgent) : '-'}`;

      // Infra probes hit /health every few seconds; web client polls stay visible
      const isProbe = PROBE_USER_AGENT.test(userAgent);
      if (path === '/health' && status < 400 && isProbe) log.debug(line);
      else if (status >= 500) log.error(line);
      else if (status >= 400) log.warn(line);
      else log.info(line);
    });
