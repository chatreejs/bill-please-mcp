import type { ReceiptItem } from '../schemas/receipt.ts';
import type { Extraction } from './extraction.ts';

const round2 = (value: number) => Math.round(value * 100) / 100;

// Small models sometimes write 10% as 0.1
const percent = (value: number) => {
  const fixed = value > 0 && value < 1 ? value * 100 : value;
  return fixed > 0 && fixed <= 100 ? round2(fixed) : 0;
};

export interface Reconciliation {
  computedTotal: number;
  printedTotal: number | null;
  // false when the receipt has no printed total, because nothing was checked
  matches: boolean;
}

// A quantity column printed before the name, e.g. "4.00 F1.Water", that the model left in the name
const LEADING_QUANTITY = /^(\d+(?:\.\d+)?)\s*[x×]?\s+(?=\S)/;

const splitLeadingQuantity = (name: string, quantity: number): [string, number] => {
  const match = LEADING_QUANTITY.exec(name);
  if (!match) return [name, quantity];
  const printed = Number(match[1]);
  // A decimal like "4.00" is always a quantity column. A bare "2" counts only when it equals the quantity
  if (printed === quantity || (quantity === 1 && match[1]!.includes('.') && printed > 0)) {
    return [name.slice(match[0].length), printed];
  }
  return [name, quantity];
};

/**
 * Maps the LLM output to the client contract. The receipt-level service charge and
 * VAT go on every item, discounts included, so the web total equals the receipt total.
 * A VAT-inclusive receipt keeps its printed prices and gets no VAT percentage.
 */
export const toReceiptItems = (extraction: Extraction): ReceiptItem[] => {
  const servicePercentage = percent(extraction.servicePercent);
  const vatPercentage = extraction.vatIncluded ? 0 : percent(extraction.vatPercent);

  return extraction.items.flatMap(([rawName, rawQuantity, amount]) => {
    const [name, quantity] = splitLeadingQuantity(
      rawName.trim(),
      Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1,
    );
    if (!name || !Number.isFinite(amount) || amount === 0) return [];
    // Discounts are one line, whatever quantity the model wrote
    const unitQuantity = amount < 0 ? 1 : quantity;

    return [
      {
        name,
        quantity: unitQuantity,
        price: round2(amount / unitQuantity),
        ...(servicePercentage ? { servicePercentage } : {}),
        ...(vatPercentage ? { vatPercentage } : {}),
      },
    ];
  });
};

/** Compares the items, priced the way the web prices them, with the printed grand total */
export const reconcile = (items: ReceiptItem[], printedTotal: number | null): Reconciliation => {
  const computedTotal = round2(
    items.reduce((sum, item) => {
      const base = item.price * item.quantity;
      const service = base * ((item.servicePercentage ?? 0) / 100);
      const vat = (base + service) * ((item.vatPercentage ?? 0) / 100);
      return sum + base + service + vat;
    }, 0),
  );
  const tolerance = Math.max(1, Math.abs(printedTotal ?? 0) * 0.005);
  return {
    computedTotal,
    printedTotal,
    matches: printedTotal !== null && Math.abs(computedTotal - printedTotal) <= tolerance,
  };
};

/**
 * Receipts such as "ราคารวม 315.89, VAT 7% 22.11, ราคารวมสุทธิ 338.00" print a VAT line even
 * though the item prices already include it, and small models often read that as VAT on top.
 * When the model's reading doesn't match the printed total and the opposite reading does, use the opposite.
 */
export const resolveVatIncluded = (extraction: Extraction): Extraction => {
  if (extraction.total === null || percent(extraction.vatPercent) === 0) return extraction;
  if (reconcile(toReceiptItems(extraction), extraction.total).matches) return extraction;
  const flipped = { ...extraction, vatIncluded: !extraction.vatIncluded };
  return reconcile(toReceiptItems(flipped), extraction.total).matches ? flipped : extraction;
};
