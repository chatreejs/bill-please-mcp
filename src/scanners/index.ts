import type { Config } from '../config.ts';
import {
  ReceiptScanResultSchema,
  type ReceiptScanResult,
} from '../schemas/receipt.ts';
import { MockReceiptScanner } from './mock.ts';
import type { ReceiptImage, ReceiptScanner } from './types.ts';

export type { ReceiptImage, ReceiptScanner } from './types.ts';

export const createScanner = (config: Config): ReceiptScanner => {
  switch (config.scanner) {
    case 'mock':
      return new MockReceiptScanner(config.mockMinDelayMs, config.mockMaxDelayMs);
    default:
      throw new Error(`Unknown SCANNER "${config.scanner}"`);
  }
};

/**
 * Scan an image and validate the scanner output against the shared contract,
 * so a misbehaving AI model can never send malformed items to clients.
 */
export const scanReceiptImage = async (
  scanner: ReceiptScanner,
  image: ReceiptImage,
): Promise<ReceiptScanResult> => {
  const result = await scanner.scan(image);
  return ReceiptScanResultSchema.parse(result);
};
