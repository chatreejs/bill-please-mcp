import type { ReceiptScanResult } from '../schemas/receipt.ts';
import type { ReceiptScanner } from './types.ts';

const MOCK_RECEIPTS: ReceiptScanResult[] = [
  {
    items: [
      { name: 'Pad Thai', quantity: 2, price: 120, servicePercentage: 10, vatPercentage: 7 },
      { name: 'Tom Yum Kung', quantity: 1, price: 250, servicePercentage: 10, vatPercentage: 7 },
      { name: 'Thai Iced Tea', quantity: 3, price: 45, servicePercentage: 10, vatPercentage: 7 },
      { name: 'Mango Sticky Rice', quantity: 1, price: 150, servicePercentage: 10, vatPercentage: 7 },
    ],
  },
  {
    items: [
      { name: 'Wagyu Set', quantity: 2, price: 890, servicePercentage: 10, vatPercentage: 7 },
      { name: 'Salmon Sashimi', quantity: 1, price: 420, servicePercentage: 10, vatPercentage: 7 },
      { name: 'Ocha Refill', quantity: 4, price: 39, servicePercentage: 10, vatPercentage: 7 },
      { name: 'Member Discount', quantity: 1, price: -200 },
    ],
  },
  {
    items: [
      { name: 'Americano', quantity: 2, price: 75 },
      { name: 'Croissant', quantity: 1, price: 95, vatPercentage: 7 },
      { name: 'Cheesecake', quantity: 1, price: 135, vatPercentage: 7 },
    ],
  },
];

const randomInt = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/** Returns a random sample receipt after a delay, simulating a VLM call */
export class MockReceiptScanner implements ReceiptScanner {
  constructor(
    private readonly minDelayMs: number,
    private readonly maxDelayMs: number,
  ) {}

  async scan(): Promise<ReceiptScanResult> {
    await Bun.sleep(randomInt(this.minDelayMs, Math.max(this.minDelayMs, this.maxDelayMs)));
    return structuredClone(MOCK_RECEIPTS[randomInt(0, MOCK_RECEIPTS.length - 1)]!);
  }
}
