# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun dev               # dev server on localhost:3001 (watch mode)
bun start             # run without watch
bun test              # bun:test suite in test/
bun run check-types   # tsc --noEmit
bun run inspect       # MCP Inspector → Streamable HTTP, http://localhost:3001/mcp
```

Bun is installed via **asdf** and pinned in `.tool-versions` (`bun 1.4.3`). Copy `.env.example` → `.env` for local config. There is no linter/formatter configured yet.

## Purpose

Backend for [bill-please](../bill-please) (a client-only React PWA that splits restaurant bills). It turns a receipt photo into structured bill items. One server exposes the same scanner two ways:

| Endpoint                  | Protocol                                   | Consumer                                                                  |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `POST /api/receipts/scan` | REST, `multipart/form-data`, field `image` | bill-please web                                                           |
| `/mcp`                    | MCP Streamable HTTP, **stateless**         | AI clients (Claude, ChatGPT, Cursor, …)                                   |
| `GET /health`             | REST                                       | Docker healthcheck + bill-please web (enables the "Add from bill" button) |

## Architecture.

```
src/
  index.ts            entry: createApp(config, createScanner(config)).listen()
  app.ts              Elysia app: requestLogger → cors → /health → rateLimit → receipt routes → mcp routes
  config.ts           env parsing (Bun.env) → `config` object
  logger.ts           Spring Boot style logger: getLogger(name), LOG_LEVEL, logContext (AsyncLocalStorage ≈ MDC)
  request-logger.ts   Elysia plugin: X-Request-Id, access log line per request, unhandled errors; clientIp()
  schemas/receipt.ts  zod contract: ReceiptItemSchema, ReceiptScanResultSchema, SUPPORTED_IMAGE_TYPES
  scanners/
    types.ts          ReceiptScanner interface { scan(image) → ReceiptScanResult }, ReceiptImage
    index.ts          createScanner(config) factory (switch on SCANNER env) + scanReceiptImage()
    mock.ts           MockReceiptScanner: random sample receipt after a random delay
  routes/receipts.ts  REST scan route (validates mime type 415, size 413, scanner failure 502)
  mcp/
    server.ts         createMcpServer(): registers tool `scan_receipt`
    route.ts          `/mcp` route using WebStandardStreamableHTTPServerTransport
test/app.test.ts      tests via app.handle(new Request(...)), no real port
```

Key points:

- **Dependency injection**: `createApp(config, scanner)` takes the scanner so tests pass `new MockReceiptScanner(0, 0)` or a broken stub. Keep new routes following the `xxxRoutes(config, scanner)` plugin pattern.
- **Contract validation**: always go through `scanReceiptImage(scanner, image)`; it `zod.parse`s the scanner output so a misbehaving AI model can never return malformed items (route maps the throw to 502 / MCP `isError`).
- **MCP transport**: uses the SDK's `WebStandardStreamableHTTPServerTransport` (Request → Response), which fits Elysia natively — no community Elysia MCP plugin. Stateless mode (`sessionIdGenerator: undefined`, `enableJsonResponse: true`): a fresh `McpServer` + transport per request, closed in `finally`. The route **must** keep `{ parse: 'none' }` so Elysia doesn't consume the body before the transport reads it.
- **MCP tool `scan_receipt`**: input `{ imageBase64, mimeType }`, `outputSchema` = `ReceiptScanResultSchema.shape`, returns both `structuredContent` and a JSON `text` content. Annotated `readOnlyHint`.
- **Logging**: never use `console.*`; use `const log = getLogger('area.name')` from `src/logger.ts` (zero deps). Format mirrors Spring Boot: `<ISO time> <LEVEL> <pid> --- [bill-please-mcp] [<requestId>|main] <logger> : <msg>`, errors printed as `Name: message` + stack + `Caused by:`. Non-Error args are JSON-stringified to keep one line. The request id comes from `logContext` (set with `enterWith` in `onRequest`, so it follows async calls without passing it around); a valid incoming `X-Request-Id` is reused and always echoed back. Access log: INFO for 2xx/3xx, WARN 4xx, ERROR 5xx, `/health` only at DEBUG. Client IP is resolved in `onRequest` (Bun can't see the socket after the response). Never log image bytes or secrets. Tests capture output via `configureLogger({ write })`.
- **Rate limiting**: `elysia-rate-limit` v4 (v5 needs Elysia 2, still beta — stay on Elysia 1.4). In-memory per process, skips `/health`. Client IP from `X-Forwarded-For` only when `TRUST_PROXY=true`.

## Contract with bill-please web (keep in sync!)

`src/schemas/receipt.ts` mirrors `IReceiptItem` / `IReceiptScanResult` in `../bill-please/src/interfaces/receipt.ts`:

```json
{
  "items": [
    {
      "name": "Pad Thai",
      "quantity": 2,
      "price": 120,
      "servicePercentage": 10,
      "vatPercentage": 7
    },
    { "name": "Member Discount", "quantity": 1, "price": -200 }
  ]
}
```

- `price` = **unit** price before service/VAT; negative allowed (discounts).
- `servicePercentage` / `vatPercentage` are **per item** (user decision — not bill-level), optional, default 0.
- The web side converts with `receiptItemToBillItem` (`../bill-please/src/utils/bill.util.ts`): service = price×qty×s%, VAT = (price×qty + service)×v%. Same formula as its manual item form.
- The web also defensively re-normalizes responses (`normalizeReceiptItems`), drops items without name/price.

How the web calls this server (`../bill-please/src/utils/receipt.util.ts`):

- Env `VITE_APP_BILL_PLEASE_MCP_URL` (e.g. `http://localhost:3001`); no local mock fallback anymore.
- Resizes photos client-side to ≤1600px JPEG (q 0.85) before upload; falls back to original file if the browser can't decode (HEIC outside Safari) — so HEIC/HEIF must stay accepted here.
- Polls `GET /health` via TanStack Query every 60 s (+ on window focus); "Add from bill" button is disabled unless healthy. CORS must therefore allow the web origin on `/health` too.
- Axios timeout 60 s on scan.

## Environment (`.env.example`)

`PORT` (3001), `CORS_ORIGINS` (comma list, default `http://localhost:3000`; add LAN IP origin to test from a phone), `MAX_IMAGE_BYTES` (5 MB), `RATE_LIMIT_PER_MINUTE` (30), `TRUST_PROXY`, `SCANNER` (`mock`), `MOCK_MIN_DELAY_MS` / `MOCK_MAX_DELAY_MS` (5000–10000, simulates VLM latency), `LOG_LEVEL` (`INFO`; TRACE/DEBUG/INFO/WARN/ERROR/OFF).

## Deployment

Target is **Docker on the user's own server** (`Dockerfile`: `oven/bun:1-alpine`, prod deps only, non-root `bun` user, wget healthcheck). No docker-compose: the user never runs Docker locally; images are built by Jenkins (below). The Docker build has not been run yet.

CI/CD: Jenkins pipeline in `ci/Jenkinsfile` (copied from `../passwords`): Prepare Env (version from package.json; `develop` → `X.Y.Z-develop.<date>.<build>`) → Test (`oven/bun:1.4.3-alpine`, keep in sync with `.tool-versions`; check-types + tests with lcov coverage) → SonarQube (`sonar-project.properties`) → docker build → Trivy → push `chatreejs/bill-please-mcp` to Docker Hub → triggers gitops job `chatreejs/gitops/bill-please-mcp-manifest-{dev,prod}` with param `MCP_IMAGE_TAG` → Discord notify. No GitHub Actions CI (user's choice).

## Status & roadmap

Done: REST + MCP endpoints, mock scanner, zod contract, CORS, rate limit, Spring Boot style logging with request ids, graceful SIGTERM shutdown, tests (17 passing), Dockerfile, web integration.

Not done yet (likely next steps):

1. Commit the code on `develop` (remote `git@github.com:chatreejs/bill-please-mcp`; `main` so far only holds README/LICENSE/CODE_OF_CONDUCT/CONTRIBUTING/SECURITY/.github). Code work happens on `develop`. Add commitlint/husky like bill-please (Conventional Commits, lowercase subject).
2. **Real scanner**: AI provider not chosen yet (user picked "mock only for now"). Implement `ReceiptScanner` (e.g. Claude / Gemini / OpenAI vision with structured JSON output), register in `createScanner`, select via `SCANNER`. Prompt should extract per-item service/VAT %, unit price, negative discounts, Thai + English receipts.
3. **Auth on `/mcp`** (API key or OAuth) before exposing a paid model publicly.
4. Shared rate-limit store if running multiple replicas.
5. Possible future MCP tool: create a bill-please bill from items and return a link that opens the web app pre-filled (would need an import-from-URL feature in bill-please web, which is currently localStorage-only).
6. Lint/format tooling (bill-please uses eslint + prettier, single quotes, trailing commas).
