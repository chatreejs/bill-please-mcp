import { createApp } from './app.ts';
import { config } from './config.ts';
import { createScanner } from './scanners/index.ts';

const app = createApp(config, createScanner(config)).listen(config.port);

console.log(`bill-please-mcp listening on http://localhost:${app.server?.port}`);
console.log(`  REST: POST /api/receipts/scan`);
console.log(`  MCP:  /mcp (Streamable HTTP)`);
