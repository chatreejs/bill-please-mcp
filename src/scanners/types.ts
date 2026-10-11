import type { ReceiptScanResult, SupportedImageType } from '../schemas/receipt.ts';

export interface ReceiptImage {
  data: Uint8Array;
  mimeType: SupportedImageType;
}

/** Turns a receipt image into structured bill items (OCR / VLM backend) */
export interface ReceiptScanner {
  scan(image: ReceiptImage): Promise<ReceiptScanResult>;
}
