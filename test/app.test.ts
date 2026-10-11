import { describe, expect, it } from 'bun:test';

import { createApp } from '../src/app.ts';
import { config } from '../src/config.ts';
import { MockReceiptScanner } from '../src/scanners/mock.ts';
import type { ReceiptScanner } from '../src/scanners/index.ts';

const testConfig = { ...config, rateLimitPerMinute: 1000, maxImageBytes: 1024 };
const app = createApp(testConfig, new MockReceiptScanner(0, 0));
const png = new File([new Uint8Array([137, 80, 78, 71])], 'bill.png', { type: 'image/png' });

const scan = (file: File, target = app) => {
  const form = new FormData();
  form.append('image', file);
  return target.handle(
    new Request('http://localhost/api/receipts/scan', { method: 'POST', body: form }),
  );
};

const mcp = (method: string, params: unknown = {}) =>
  app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );

describe('REST /api/receipts/scan', () => {
  it('returns receipt items', async () => {
    const res = await scan(png);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('rejects non image files', async () => {
    const res = await scan(new File(['hi'], 'a.txt', { type: 'text/plain' }));
    expect(res.status).toBe(415);
  });

  it('rejects images over the size limit', async () => {
    const res = await scan(new File([new Uint8Array(2048)], 'big.png', { type: 'image/png' }));
    expect(res.status).toBe(413);
  });

  it('returns 502 when the scanner output breaks the contract', async () => {
    const broken: ReceiptScanner = {
      scan: async () => ({ items: [{ name: '', quantity: 0, price: 1 }] }),
    };
    const res = await scan(png, createApp(testConfig, broken));
    expect(res.status).toBe(502);
  });
});

describe('MCP /mcp', () => {
  it('initializes', async () => {
    const res = await mcp('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.0.0' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { serverInfo: { name: string } } };
    expect(body.result.serverInfo.name).toBe('bill-please');
  });

  it('lists the scan_receipt tool', async () => {
    const body = (await (await mcp('tools/list')).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(body.result.tools.map((tool) => tool.name)).toContain('scan_receipt');
  });

  it('scans a receipt via tools/call', async () => {
    const body = (await (
      await mcp('tools/call', {
        name: 'scan_receipt',
        arguments: { imageBase64: Buffer.from('fake').toString('base64'), mimeType: 'image/png' },
      })
    ).json()) as { result: { isError?: boolean; structuredContent: { items: unknown[] } } };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.items.length).toBeGreaterThan(0);
  });
});
