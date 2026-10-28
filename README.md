<h1 align="center">
  <p align="center">Bill-Please MCP</p>
</h1>

Receipt scanning backend for [Bill Please](https://github.com/chatreejs/bill-please).
One server exposes the same receipt scanner in two ways:

| Endpoint | Protocol | Used by |
|---|---|---|
| `POST /api/receipts/scan` | REST, `multipart/form-data` with an `image` field | bill-please web |
| `/mcp` | [MCP](https://modelcontextprotocol.io) Streamable HTTP, stateless | AI clients such as Claude, ChatGPT and Cursor |
| `GET /health` | REST | The Docker healthcheck, and bill-please web to enable "Add from bill" |

It runs on [Bun](https://bun.sh) with [ElysiaJS](https://elysiajs.com), the official
[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and zod.

## Response contract

Both endpoints return the same JSON, which matches `IReceiptScanResult` in bill-please web.
MCP returns it as `structuredContent`.

```json
{
  "items": [
    { "name": "Pad Thai", "quantity": 2, "price": 120, "servicePercentage": 10, "vatPercentage": 7 },
    { "name": "Member Discount", "quantity": 1, "price": -200 }
  ]
}
```

`price` is the unit price before service charge and VAT. The schema is in
`src/schemas/receipt.ts`, and the server checks every scanner result against it.

## Development

```bash
cp .env.example .env
bun install
bun dev            # http://localhost:3001
bun test
bun run check-types
```

Try the REST endpoint:

```bash
curl -F image=@receipt.jpg http://localhost:3001/api/receipts/scan
```

To try the MCP endpoint, run the MCP Inspector with `bun run inspect`. Choose the
Streamable HTTP transport and the URL `http://localhost:3001/mcp`.

## Scanners

`SCANNER` selects the implementation of the `ReceiptScanner` interface in
`src/scanners/types.ts`.

- `mock` returns a random sample receipt after a delay between `MOCK_MIN_DELAY_MS`
  and `MOCK_MAX_DELAY_MS`.
- `hybrid` sends the photo to [bill-please-ocr](https://github.com/chatreejs/bill-please-ocr)
  at `OCR_URL`, then sends only the OCR text to an OpenAI compatible LLM at `LLM_URL`.
  In the cluster that LLM is the shared llama.cpp `llm-server`. A receipt with no
  readable text gets a 422 without an LLM call.

To run the hybrid scanner locally, start bill-please-ocr on port 8000, port-forward the
LLM to port 8080 and set `SCANNER=hybrid`:

```bash
zsh -c 'trap "kill 0" INT TERM EXIT
kubectl -n llm-server port-forward svc/llm-server 8080:8080 &
(cd ../bill-please-ocr && PORT=8000 uv run python -m receipt_ocr) &
bun dev'
```

To add another scanner, implement `ReceiptScanner` and register it in `createScanner`
in `src/scanners/index.ts`.

## Logging

Logs use Spring Boot's console format, with the request id in place of the
thread name:

```text
2026-10-11T17:34:02.182+07:00  INFO 25352 --- [bill-please-mcp] [ web-123] receipts.route   : Scanned receipt with 4 items
2026-10-11T17:34:02.183+07:00  INFO 25352 --- [bill-please-mcp] [ web-123] http.access      : POST /api/receipts/scan 200 121ms ip=::1
```

`LOG_LEVEL` sets the level to `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` or `OFF`.
The default is `INFO`. Every response has an `X-Request-Id` header. Send your own
`X-Request-Id` to find the same request in the logs of several services. The hybrid
scanner passes it on to bill-please-ocr.

## Docker

The Jenkins pipeline in `ci/Jenkinsfile` builds and deploys the image. It runs the
tests, scans with SonarQube, builds the image, scans it with Trivy, pushes it and
triggers the GitOps deploy. To run the image by hand:

```bash
docker build -t bill-please-mcp .
docker run -d -p 3001:3001 --env-file .env bill-please-mcp
```

Behind a reverse proxy, set `TRUST_PROXY=true` so rate limiting uses the client IP
from `X-Forwarded-For`.

## MCP tools

| Tool | Input | Output |
|---|---|---|
| `scan_receipt` | `imageBase64`, `mimeType` | `{ items: ReceiptItem[] }` |

## Security notes

- `/mcp` has no authentication yet. Add an API key or OAuth before you expose a
  paid model.
- Each process keeps its own in-memory rate limit. Use a shared store if you run
  several replicas.

Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).

## Can I contribute?

Yes.

- [Star the repo](https://github.com/chatreejs/bill-please-mcp).
- [Report a bug](https://github.com/chatreejs/bill-please-mcp/issues) if something doesn't work.
- [Suggest a feature](https://github.com/chatreejs/bill-please-mcp/issues).
- [Join our Discord server](https://discord.gg/HdknCHG7Rr) for less formal discussion.

Please read the [contributing guidelines](./CONTRIBUTING.md) and follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

Released under the [AGPL-3.0 License](./LICENSE).
