import type { Config } from '../config.ts';
import { getLogger } from '../logger.ts';
import {
  ReceiptScanResultSchema,
  type ReceiptScanResult,
} from '../schemas/receipt.ts';
import { OcrLlmReceiptScanner } from './ocr-llm-scanner.ts';
import { OpenAiCompatibleExtractor } from './llm-client.ts';
import { HttpOcrClient } from './ocr-client.ts';
import type { ReceiptImage, ReceiptScanner } from './types.ts';

const log = getLogger('scanner');

export { UnreadableReceiptError } from './errors.ts';
export type { ReceiptImage, ReceiptScanner } from './types.ts';

export const createScanner = (config: Config): ReceiptScanner =>
  new OcrLlmReceiptScanner(
    new HttpOcrClient(config.ocrUrl, config.ocrTimeoutMs),
    new OpenAiCompatibleExtractor(config.llmUrl, config.llmModel, config.llmTimeoutMs, {
      apiKey: config.llmApiKey,
      reasoningEffort: config.llmReasoningEffort,
      outputFormat: config.llmOutputFormat,
    }),
    config.ocrMinConfidence,
  );

/**
 * Scan an image and validate the scanner output against the shared contract,
 * so a misbehaving AI model can never send malformed items to clients.
 */
export const scanReceiptImage = async (
  scanner: ReceiptScanner,
  image: ReceiptImage,
): Promise<ReceiptScanResult> => {
  const startedAt = performance.now();
  const result = await scanner.scan(image);
  log.debug(`${scanner.constructor.name} finished in ${Math.round(performance.now() - startedAt)}ms`);

  return ReceiptScanResultSchema.parse(result);
};
