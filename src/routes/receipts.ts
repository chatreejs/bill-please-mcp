import { Elysia, t } from 'elysia';

import type { Config } from '../config.ts';
import { getLogger } from '../logger.ts';
import { type ReceiptScanner, scanReceiptImage } from '../scanners/index.ts';
import { SUPPORTED_IMAGE_TYPES, type SupportedImageType } from '../schemas/receipt.ts';

const log = getLogger('receipts.route');

const isSupportedImageType = (type: string): type is SupportedImageType =>
  (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(type);

/** REST endpoint used by bill-please web */
export const receiptRoutes = (config: Config, scanner: ReceiptScanner) =>
  new Elysia({ prefix: '/api/receipts' }).post(
    '/scan',
    async ({ body, status }) => {
      const { image } = body;
      if (!isSupportedImageType(image.type)) {
        log.warn(`Rejected unsupported image type "${image.type}"`);
        return status(415, { error: `Unsupported image type "${image.type}"` });
      }
      if (image.size > config.maxImageBytes) {
        log.warn(`Rejected image of ${image.size} bytes (max ${config.maxImageBytes})`);
        return status(413, { error: `Image larger than ${config.maxImageBytes} bytes` });
      }

      try {
        log.debug(`Scanning ${image.type} image of ${image.size} bytes`);
        const result = await scanReceiptImage(scanner, {
          data: new Uint8Array(await image.arrayBuffer()),
          mimeType: image.type,
        });
        log.info(`Scanned receipt with ${result.items.length} items`);
        return result;
      } catch (error) {
        log.error('Receipt scan failed', error);
        return status(502, { error: 'Could not read the receipt' });
      }
    },
    { body: t.Object({ image: t.File() }) },
  );
