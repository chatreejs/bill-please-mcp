import { beforeEach, describe, expect, it } from 'bun:test';

import { createApp } from '../src/app.ts';
import { config } from '../src/config.ts';
import { configureLogger } from '../src/logger.ts';
import { UnreadableReceiptError } from '../src/scanners/errors.ts';
import type { Extraction } from '../src/scanners/extraction.ts';
import { extractionJsonSchema } from '../src/scanners/extraction.ts';
import { OcrLlmReceiptScanner } from '../src/scanners/ocr-llm-scanner.ts';
import type { ReceiptExtractor } from '../src/scanners/llm-client.ts';
import type { OcrClient, OcrResult } from '../src/scanners/ocr-client.ts';
import { reconcile, toReceiptItems } from '../src/scanners/postprocess.ts';

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  configureLogger({ level: 'INFO', color: false, write: (line) => logs.push(line) });
});

const RECEIPT_TEXT = [
  'ผัดไทยกุ้งสด                  2    240.00',
  'ส่วนลดสมาชิก                     -100.00',
  'ค่าบริการ 10%                      14.00',
  'ภาษีมูลค่าเพิ่ม 7%                    10.78',
  'รวมทั้งสิ้น                         164.78',
].join('\n');

const ocrResult = (text: string, confidence = 0.95): OcrResult => ({
  lines: text ? text.split('\n').map((line) => ({ text: line, confidence })) : [],
  text,
  width: 600,
  height: 800,
  durationMs: 1,
});

const extraction: Extraction = {
  items: [
    ['ผัดไทยกุ้งสด', 2, 240],
    ['ส่วนลดสมาชิก', 1, -100],
  ],
  servicePercent: 10,
  vatPercent: 7,
  vatIncluded: false,
  total: 164.78,
};

const stubOcr = (result: OcrResult): OcrClient => ({ recognize: async () => result });

class StubExtractor implements ReceiptExtractor {
  calls: string[] = [];
  constructor(private readonly result: Extraction) {}
  async extract(text: string) {
    this.calls.push(text);
    return this.result;
  }
}

const image = { data: new Uint8Array([1]), mimeType: 'image/jpeg' as const };

describe('toReceiptItems', () => {
  it('turns line amounts into unit prices and applies receipt rates to every item', () => {
    expect(toReceiptItems(extraction)).toEqual([
      { name: 'ผัดไทยกุ้งสด', quantity: 2, price: 120, servicePercentage: 10, vatPercentage: 7 },
      { name: 'ส่วนลดสมาชิก', quantity: 1, price: -100, servicePercentage: 10, vatPercentage: 7 },
    ]);
  });

  it('leaves out VAT when prices already include it', () => {
    const items = toReceiptItems({ ...extraction, servicePercent: 0, vatIncluded: true });
    expect(items[0]).toEqual({ name: 'ผัดไทยกุ้งสด', quantity: 2, price: 120 });
  });

  it('fixes fractional rates, empty names, zero amounts and bad quantities', () => {
    const items = toReceiptItems({
      items: [
        ['  Tea ', 0, 45],
        ['', 1, 10],
        ['Free water', 1, 0],
        ['Coupon', 2, -50],
        ['Rice', 3, 100],
      ],
      servicePercent: 0.1,
      vatPercent: 0.07,
      vatIncluded: false,
      total: null,
    });
    expect(items).toEqual([
      { name: 'Tea', quantity: 1, price: 45, servicePercentage: 10, vatPercentage: 7 },
      { name: 'Coupon', quantity: 1, price: -50, servicePercentage: 10, vatPercentage: 7 },
      { name: 'Rice', quantity: 3, price: 33.33, servicePercentage: 10, vatPercentage: 7 },
    ]);
  });
});

describe('reconcile', () => {
  it('prices items like the web and compares with the printed total', () => {
    const items = toReceiptItems(extraction);
    expect(reconcile(items, 164.78)).toEqual({ computedTotal: 164.78, printedTotal: 164.78, matches: true });
    expect(reconcile(items, 200).matches).toBe(false);
    expect(reconcile(items, null).matches).toBe(true);
  });
});

describe('extraction JSON schema', () => {
  it('has no boolean subschemas, which llama.cpp rejects', () => {
    expect(JSON.stringify(extractionJsonSchema)).not.toContain('"items":false');
  });
});

describe('OcrLlmReceiptScanner', () => {
  it('sends the OCR text to the extractor and returns contract items', async () => {
    const extractor = new StubExtractor(extraction);
    const scanner = new OcrLlmReceiptScanner(stubOcr(ocrResult(RECEIPT_TEXT)), extractor, 0.6);

    const result = await scanner.scan(image);
    expect(extractor.calls).toEqual([RECEIPT_TEXT]);
    expect(result.items).toHaveLength(2);
    expect(logs.some((line) => line.includes('total 164.78 (printed 164.78)'))).toBe(true);
  });

  it('warns when the items do not add up to the printed total', async () => {
    const scanner = new OcrLlmReceiptScanner(
      stubOcr(ocrResult(RECEIPT_TEXT)),
      new StubExtractor({ ...extraction, total: 999 }),
      0.6,
    );
    await scanner.scan(image);
    expect(logs.find((line) => line.includes('the receipt says 999'))).toContain('WARN');
  });

  it('skips the LLM when OCR finds nothing or is unsure', async () => {
    for (const ocr of [ocrResult(''), ocrResult(RECEIPT_TEXT, 0.3)]) {
      const extractor = new StubExtractor(extraction);
      const scanner = new OcrLlmReceiptScanner(stubOcr(ocr), extractor, 0.6);
      await expect(scanner.scan(image)).rejects.toBeInstanceOf(UnreadableReceiptError);
      expect(extractor.calls).toHaveLength(0);
    }
  });

  it('is unreadable when the LLM finds no items', async () => {
    const scanner = new OcrLlmReceiptScanner(
      stubOcr(ocrResult(RECEIPT_TEXT)),
      new StubExtractor({ ...extraction, items: [] }),
      0.6,
    );
    await expect(scanner.scan(image)).rejects.toBeInstanceOf(UnreadableReceiptError);
  });

  it('answers 422 on REST and a friendly tool error on MCP', async () => {
    const app = createApp(
      { ...config, rateLimitPerMinute: 1000 },
      new OcrLlmReceiptScanner(stubOcr(ocrResult('')), new StubExtractor(extraction), 0.6),
    );
    const form = new FormData();
    form.append('image', new File([new Uint8Array([1])], 'bill.jpg', { type: 'image/jpeg' }));
    const res = await app.handle(
      new Request('http://localhost/api/receipts/scan', { method: 'POST', body: form }),
    );
    expect(res.status).toBe(422);

    const mcp = await app.handle(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'scan_receipt', arguments: { imageBase64: 'AQ==', mimeType: 'image/jpeg' } },
        }),
      }),
    );
    const body = (await mcp.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]!.text).toContain('No receipt text found');
  });
});
