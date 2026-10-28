import { getLogger } from '../../logger.ts';
import type { ReceiptScanResult } from '../../schemas/receipt.ts';
import { UnreadableReceiptError } from '../errors.ts';
import type { ReceiptImage, ReceiptScanner } from '../types.ts';
import type { ReceiptExtractor } from './llm-client.ts';
import type { OcrClient } from './ocr-client.ts';
import { reconcile, toReceiptItems } from './postprocess.ts';

const log = getLogger('scanner.hybrid');

/**
 * Reads the receipt text with bill-please-ocr, then has an LLM turn the text into items.
 * Only the OCR text reaches the LLM, never the photo.
 */
export class HybridReceiptScanner implements ReceiptScanner {
  constructor(
    private readonly ocr: OcrClient,
    private readonly extractor: ReceiptExtractor,
    private readonly minMeanConfidence: number,
  ) {}

  async scan(image: ReceiptImage): Promise<ReceiptScanResult> {
    const ocr = await this.ocr.recognize(image);
    const meanConfidence = ocr.lines.length
      ? ocr.lines.reduce((sum, line) => sum + line.confidence, 0) / ocr.lines.length
      : 0;
    log.info(
      `OCR read ${ocr.lines.length} lines in ${ocr.durationMs}ms, mean confidence ${meanConfidence.toFixed(2)}`,
    );
    // Skip the LLM call, which costs 10 s or more, when there is nothing to read
    if (ocr.lines.length === 0 || meanConfidence < this.minMeanConfidence) {
      throw new UnreadableReceiptError(
        `OCR found ${ocr.lines.length} lines with mean confidence ${meanConfidence.toFixed(2)}`,
      );
    }

    const extraction = await this.extractor.extract(ocr.text);
    const items = toReceiptItems(extraction);
    if (items.length === 0) {
      throw new UnreadableReceiptError('The LLM found no items in the receipt text');
    }

    const check = reconcile(items, extraction.total);
    if (check.matches) {
      log.info(`Extracted ${items.length} items, total ${check.computedTotal} (printed ${check.printedTotal})`);
    } else {
      log.warn(
        `Extracted ${items.length} items, but they add up to ${check.computedTotal} ` +
          `while the receipt says ${check.printedTotal}`,
      );
    }
    return { items };
  }
}
