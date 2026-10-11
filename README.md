<h1 align="center">
  <p align="center">🧾 Bill-Please MCP</p>
</h1>

Receipt scanning backend for [Bill Please](https://github.com/chatreejs/bill-please).
One server exposes the same receipt scanner two ways:

| Endpoint | Protocol | Used by |
|---|---|---|
| `POST /api/receipts/scan` | REST, `multipart/form-data` with an `image` field | bill-please web |
| `/mcp` | [MCP](https://modelcontextprotocol.io) Streamable HTTP (stateless) | AI clients (Claude, ChatGPT, Cursor, ...) |
| `GET /health` | REST | Docker healthcheck, bill-please web (enables "Add from bill") |

Stack: [Bun](https://bun.sh) + [ElysiaJS](https://elysiajs.com) + the official
[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) + zod.

## Response contract

Both endpoints return the same JSON (MCP returns it as `structuredContent`),
matching `IReceiptScanResult` in bill-please web:

```json
{
  "items": [
    { "name": "Pad Thai", "quantity": 2, "price": 120, "servicePercentage": 10, "vatPercentage": 7 },
    { "name": "Member Discount", "quantity": 1, "price": -200 }
  ]
}
```

`price` is the unit price before service charge and VAT. The schema lives in
`src/schemas/receipt.ts`; every scanner result is validated against it.

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

Try the MCP endpoint with the MCP Inspector (`bun run inspect`), choose
transport **Streamable HTTP** and URL `http://localhost:3001/mcp`.

## Scanners

The OCR / VLM backend sits behind the `ReceiptScanner` interface
(`src/scanners/types.ts`). Only `mock` exists today: it returns a random sample
receipt after `MOCK_MIN_DELAY_MS`–`MOCK_MAX_DELAY_MS`. To add a real model,
implement `ReceiptScanner` and register it in `createScanner`
(`src/scanners/index.ts`), selected with the `SCANNER` env var.

## Docker

```bash
cp .env.example .env
docker compose up -d --build
```

Behind a reverse proxy set `TRUST_PROXY=true` so rate limiting uses the real
client IP from `X-Forwarded-For`.

## MCP tools

| Tool | Input | Output |
|---|---|---|
| `scan_receipt` | `imageBase64`, `mimeType` | `{ items: ReceiptItem[] }` |

## Security notes

- `/mcp` has no authentication yet; add an API key or OAuth before exposing a
  paid model.
- Rate limiting is in-memory per process; use a shared store if you run
  multiple replicas.

Report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).

## Can I contribute?

Yes!

- **[Give us a ⭐️](https://github.com/chatreejs/bill-please-mcp)** Help this project gain visibility and stand out.
- **[Report a bug](https://github.com/chatreejs/bill-please-mcp/issues)** If something is not working, let us know.
- **[Suggest a feature](https://github.com/chatreejs/bill-please-mcp/issues)** We are open to new ideas.
- **[Join our Discord server](https://discord.gg/HdknCHG7Rr)** To discuss things in a less formal way.

Please read the [contributing guidelines](./CONTRIBUTING.md) and follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

Released under the [AGPL-3.0 License](./LICENSE).
