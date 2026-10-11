import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';

import type { Config } from '../config.ts';
import { type ReceiptScanner, scanReceiptImage } from '../scanners/index.ts';
import {
  ReceiptScanResultSchema,
  SUPPORTED_IMAGE_TYPES,
} from '../schemas/receipt.ts';

const toolError = (text: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text }],
});

/** MCP server exposing Bill Please tools to AI clients */
export const createMcpServer = (config: Config, scanner: ReceiptScanner) => {
  const server = new McpServer({
    name: 'bill-please',
    version: '0.1.0',
  });

  server.registerTool(
    'scan_receipt',
    {
      title: 'Scan receipt',
      description:
        'Read a restaurant receipt image and return its line items ' +
        '(name, quantity, unit price, service charge %, VAT %) as JSON ' +
        'ready to import into Bill Please.',
      inputSchema: {
        imageBase64: z.string().min(1).describe('Receipt image, base64 encoded without data: prefix'),
        mimeType: z.enum(SUPPORTED_IMAGE_TYPES).describe('Image MIME type'),
      },
      outputSchema: ReceiptScanResultSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ imageBase64, mimeType }) => {
      const data = Buffer.from(imageBase64, 'base64');
      if (data.length === 0) return toolError('imageBase64 is not valid base64');
      if (data.length > config.maxImageBytes) {
        return toolError(`Image larger than ${config.maxImageBytes} bytes`);
      }

      try {
        const result = await scanReceiptImage(scanner, { data, mimeType });
        return {
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      } catch (error) {
        console.error('MCP receipt scan failed', error);
        return toolError('Could not read the receipt');
      }
    },
  );

  return server;
};
