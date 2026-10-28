# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun dev               # dev server on localhost:3001, restarts on change
bun start             # run without watch mode
bun test              # bun:test suite in test/
bun run check-types   # tsc --noEmit
bun run inspect       # MCP Inspector; choose Streamable HTTP and http://localhost:3001/mcp
```

asdf installs Bun, and `.tool-versions` pins it to `bun 1.4.3`. For local config, copy `.env.example` to `.env`. There is no linter or formatter yet.

## Purpose

This is the backend for [bill-please](../bill-please), a client-only React PWA that splits restaurant bills. It turns a receipt photo into structured bill items. One server exposes the same scanner in two ways:

| Endpoint                  | Protocol                                   | Consumer                                                                  |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `POST /api/receipts/scan` | REST, `multipart/form-data`, field `image` | bill-please web                                                           |
| `/mcp`                    | MCP Streamable HTTP, stateless             | AI clients such as Claude, ChatGPT and Cursor                             |
| `GET /health`             | REST                                       | Docker healthcheck, and bill-please web to enable the "Add from bill" button |

## Architecture

```
src/
  index.ts            entry point: createApp(config, createScanner(config)).listen()
  app.ts              Elysia app, in order: requestLogger, cors, /health, rateLimit, receipt routes, mcp routes
  config.ts           parses Bun.env into the `config` object
  logger.ts           Spring Boot style logger: getLogger(name), LOG_LEVEL, logContext (AsyncLocalStorage, like Log4j's MDC)
  request-logger.ts   Elysia plugin: X-Request-Id, one access log line per request, unhandled errors; clientIp()
  schemas/receipt.ts  zod contract: ReceiptItemSchema, ReceiptScanResultSchema, SUPPORTED_IMAGE_TYPES
  scanners/
    types.ts          ReceiptScanner interface { scan(image): ReceiptScanResult }, ReceiptImage
    index.ts          createScanner(config) factory that switches on SCANNER, and scanReceiptImage()
    mock.ts           MockReceiptScanner: a random sample receipt after a random delay
    errors.ts         UnreadableReceiptError: no usable text in the image (REST 422)
    hybrid/
      index.ts        HybridReceiptScanner: OCR, then LLM, then post-processing and a total check
      ocr-client.ts   HttpOcrClient for bill-please-ocr POST /v1/ocr, forwards X-Request-Id
      llm-client.ts   OpenAiCompatibleExtractor: chat completions with a json_schema response_format
      extraction.ts   compact LLM output schema (zod) and its JSON schema for llama.cpp
      prompt.ts       system prompt with one short example
      postprocess.ts  toReceiptItems (compact output to the contract) and reconcile (vs printed total)
  routes/receipts.ts  REST scan route: 415 for a bad mime type, 413 for size, 502 for a scanner failure
  mcp/
    server.ts         createMcpServer() registers the tool `scan_receipt`
    route.ts          `/mcp` route using WebStandardStreamableHTTPServerTransport
test/app.test.ts      tests through app.handle(new Request(...)), without a real port
test/hybrid.test.ts   hybrid scanner with a stub OCR client and extractor, no network
```

Key points:

- **Dependency injection.** `createApp(config, scanner)` takes the scanner, so tests pass `new MockReceiptScanner(0, 0)` or a broken stub. New routes follow the same `xxxRoutes(config, scanner)` plugin pattern.
- **Contract validation.** Always call the scanner through `scanReceiptImage(scanner, image)`. It runs `zod.parse` on the scanner output, so a misbehaving AI model can never return malformed items. The REST route turns the error into a 502, and MCP returns `isError`.
- **Hybrid scanner.** `SCANNER=hybrid` sends the photo to bill-please-ocr and only the OCR text to the LLM.
  - The LLM returns a compact shape to save tokens: items as `[name, quantity, line amount]`, plus receipt-level `servicePercent`, `vatPercent`, `vatIncluded` and the printed `total`. `toReceiptItems` divides the amount by the quantity and puts the receipt rates on every item, discounts included, so the web total equals the receipt total.
  - A VAT-inclusive receipt keeps its printed prices and gets no `vatPercentage`. This follows the recommendation in the local docs. The user hasn't confirmed it yet.
  - `reconcile` prices the items the way the web does and logs WARN when they don't match the printed total. There is no retry or fallback yet.
  - When OCR finds no lines, the mean confidence is under `OCR_MIN_CONFIDENCE`, or the LLM finds no items, the scanner throws `UnreadableReceiptError` without calling the LLM. REST answers 422, and MCP returns a friendly `isError`.
  - llama.cpp rejects boolean subschemas, so `extraction.ts` strips the `items: false` that zod adds to tuples.
- **MCP transport.** The route uses the SDK's `WebStandardStreamableHTTPServerTransport`, which takes a Request and returns a Response, so it fits Elysia without a community MCP plugin. It runs in stateless mode (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) and creates a fresh `McpServer` and transport per request, closed in `finally`. The route must keep `{ parse: 'none' }`, otherwise Elysia consumes the body before the transport reads it.
- **MCP tool `scan_receipt`.** Its input is `{ imageBase64, mimeType }` and its `outputSchema` is `ReceiptScanResultSchema.shape`. It returns both `structuredContent` and a JSON `text` content, and has the `readOnlyHint` annotation.
- **Logging.** Never use `console.*`. Use `const log = getLogger('area.name')` from `src/logger.ts`, which has no dependencies.
  - The format follows Spring Boot: `<ISO time> <LEVEL> <pid> --- [bill-please-mcp] [<requestId>|main] <logger> : <msg>`. Errors print as `Name: message`, then the stack, then `Caused by:`. Non-Error arguments are JSON-stringified, so each record stays on one line.
  - The request id comes from `logContext`. `onRequest` sets it with `enterWith`, so it follows async calls without being passed around. The server reuses a valid incoming `X-Request-Id` and always sends it back.
  - The access log line is `METHOD path status Nms ip=… ua="…"`, with the user agent JSON-quoted, or `-` if missing. 2xx and 3xx log at INFO, 4xx at WARN and 5xx at ERROR. `/health` from infra probes (User-Agent `kube-probe/*` or `Wget/*`) logs only at DEBUG, and from the web at INFO.
  - `onRequest` resolves the client IP, because Bun can't see the socket after the response.
  - Never log image bytes or secrets. Tests capture output with `configureLogger({ write })`.
- **Rate limiting.** It uses `elysia-rate-limit` v4. v5 needs Elysia 2, which is still in beta, so stay on Elysia 1.4. The limit is in memory per process and skips `/health`. The client IP comes from `X-Forwarded-For` only when `TRUST_PROXY=true`.

## Contract with bill-please web (keep in sync)

`src/schemas/receipt.ts` mirrors `IReceiptItem` and `IReceiptScanResult` in `../bill-please/src/interfaces/receipt.ts`:

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

- `price` is the unit price before service charge and VAT. It can be negative for discounts.
- `servicePercentage` and `vatPercentage` are per item, not per bill. That is a user decision. Both are optional and default to 0.
- The web converts items with `receiptItemToBillItem` in `../bill-please/src/utils/bill.util.ts`. Service is price × quantity × service %, and VAT is (price × quantity + service) × VAT %. Its manual item form uses the same formula.
- The web also re-normalizes responses with `normalizeReceiptItems` and drops items without a name or price.

How the web calls this server, in `../bill-please/src/utils/receipt.util.ts`:

- It reads the URL from `VITE_APP_BILL_PLEASE_MCP_URL`, for example `http://localhost:3001`. There is no local mock fallback anymore.
- It resizes photos in the browser to a JPEG of at most 1600 px at quality 0.85 before upload. If the browser can't decode the photo, for example HEIC outside Safari, it sends the original file. So this server must keep accepting HEIC and HEIF.
- It polls `GET /health` with TanStack Query every 60 s and on window focus, and disables the "Add from bill" button unless the server is healthy. CORS must therefore allow the web origin on `/health` too.
- The Axios timeout for a scan is 60 s.

## Environment (`.env.example`)

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3001` | |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated list. Add the LAN IP origin to test from a phone. `*` matches one part of a hostname, for example `https://bill-please-*-chatreejs-projects.vercel.app` for Vercel previews. |
| `MAX_IMAGE_BYTES` | 5 MB | |
| `RATE_LIMIT_PER_MINUTE` | `30` | |
| `TRUST_PROXY` | | |
| `SCANNER` | `mock` | |
| `MOCK_MIN_DELAY_MS`, `MOCK_MAX_DELAY_MS` | `5000`, `10000` | Simulates VLM latency |
| `OCR_URL`, `OCR_TIMEOUT_MS` | `http://localhost:8000`, `20000` | bill-please-ocr |
| `OCR_MIN_CONFIDENCE` | `0.6` | Mean line confidence below this answers 422 without an LLM call |
| `LLM_URL`, `LLM_MODEL`, `LLM_TIMEOUT_MS` | `http://localhost:8080/v1`, `qwen3-4b-instruct-2507`, `45000` | Any OpenAI compatible API |
| `LLM_API_KEY` | | Bearer token, only for APIs that need one |
| `LOG_LEVEL` | `INFO` | `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` or `OFF` |

## Deployment

The target is Docker on the user's own server. The `Dockerfile` uses `oven/bun:1-alpine`, installs production dependencies only, runs as the non-root `bun` user and has a wget healthcheck. There is no docker-compose, because the user never runs Docker locally and Jenkins builds the images. Nobody has run the Docker build yet.

The Jenkins pipeline in `ci/Jenkinsfile` is copied from `../passwords`. Its stages run in this order:

1. Prepare Env reads the version from package.json. On `develop` it becomes `X.Y.Z-develop.<date>.<build>`.
2. Test runs check-types and the tests with lcov coverage in `oven/bun:1.4.3-alpine`. Keep that tag in sync with `.tool-versions`.
3. SonarQube scans with `sonar-project.properties`.
4. It builds the Docker image, scans it with Trivy and pushes `chatreejs/bill-please-mcp` to Docker Hub.
5. It triggers the gitops job `chatreejs/gitops/bill-please-backend-manifest-{dev,prod}` with the parameter `MCP_IMAGE_TAG`, then notifies Discord.

The manifest repo is `../../gitlab.com/chatreedev-manifest/bill-please-backend`. One Helm chart deploys this server and bill-please-ocr into the `bill-please-mcp-{dev,prod}` namespaces, and the ocr pipeline sets `OCR_IMAGE_TAG` on the same gitops jobs. In the cluster, the mcp config uses `SCANNER=hybrid` with the in-release OCR service and the shared llm-server.

There is no GitHub Actions CI, by the user's choice.

## Status and roadmap

Done: REST and MCP endpoints, the mock scanner, the hybrid scanner, the zod contract, CORS, rate limiting, Spring Boot style logging with request ids, graceful SIGTERM shutdown, tests (30 passing), the Dockerfile and the web integration.

Likely next steps:

1. Code work happens on `develop`, with `git@github.com:chatreejs/bill-please-mcp` as the remote. Add commitlint and husky like bill-please, for Conventional Commits with a lowercase subject.
2. Finish the hybrid scanner: test it on real receipts, add a scan queue (one GPU serves one scan at a time), a `/livez` probe and a dependency-aware `/health`, and maybe a cloud fallback. The user hasn't chosen a cloud provider.
3. Add auth on `/mcp`, an API key or OAuth, before exposing a paid model publicly.
4. Use a shared rate-limit store if the server runs as several replicas.
5. A possible future MCP tool could create a bill-please bill from the items and return a link that opens the web app pre-filled. That needs an import-from-URL feature in bill-please web, which only uses localStorage today.
6. Add lint and format tooling. bill-please uses eslint and prettier, with single quotes and trailing commas.

## Related repos

- [bill-please-ocr](../bill-please-ocr) is the OCR step of the hybrid scanner. It is a Python service with FastAPI and PaddleOCR, and `POST /v1/ocr` returns receipt text lines. The user decided to keep OCR in Python and keep this Elysia server as the API, which will call the OCR service over HTTP. The design and roadmap are in the local `docs/` folder, which is gitignored and not pushed.
- The shared on-prem LLM is the `llm-server` Helm chart in `../../gitlab.com/chatreedev-manifest/llm-server`, at `http://llm-server.llm-server.svc:8080/v1`. Its NetworkPolicy admits pods labelled `app: bill-please-mcp` from the `bill-please-mcp-{dev,prod}` namespaces, so the manifest keeps that label on the mcp pods.

To test the hybrid scanner locally, run bill-please-ocr with `PORT=8000 uv run python -m receipt_ocr` in its repo, port-forward the LLM with `kubectl -n llm-server port-forward svc/llm-server 8080:8080`, and start this server with `SCANNER=hybrid bun dev`. The defaults of `OCR_URL` and `LLM_URL` point at those ports.
