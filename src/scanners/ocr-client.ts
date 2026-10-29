import * as z from 'zod';

import { getLogger, logContext } from '../logger.ts';
import { UnreadableReceiptError } from './errors.ts';
import type { ReceiptImage } from './types.ts';

const log = getLogger('scanner.ocr');

const OcrResultSchema = z.object({
  lines: z.array(z.object({ text: z.string(), confidence: z.number() })),
  text: z.string(),
  width: z.number(),
  height: z.number(),
  durationMs: z.number(),
});

export type OcrResult = z.infer<typeof OcrResultSchema>;

export interface OcrClient {
  recognize(image: ReceiptImage): Promise<OcrResult>;
}

/** Client for bill-please-ocr `POST /v1/ocr` */
export class HttpOcrClient implements OcrClient {
  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
  ) {}

  async recognize(image: ReceiptImage): Promise<OcrResult> {
    const form = new FormData();
    form.append('image', new Blob([image.data], { type: image.mimeType }), 'receipt');

    const requestId = logContext.getStore()?.requestId;
    const res = await fetch(`${this.url}/v1/ocr`, {
      method: 'POST',
      body: form,
      headers: requestId ? { 'x-request-id': requestId } : {},
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (res.status === 422) {
      throw new UnreadableReceiptError('The OCR service could not decode the image');
    }
    if (!res.ok) {
      throw new Error(`OCR service answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const result = OcrResultSchema.parse(await res.json());
    log.debug(`OCR found ${result.lines.length} lines in ${result.durationMs}ms`);
    return result;
  }
}
