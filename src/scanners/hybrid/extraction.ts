import * as z from 'zod';

/**
 * What the LLM returns. It is smaller than the client contract to save tokens,
 * because generation speed is the bottleneck on the T400. `toReceiptItems` maps it.
 *
 * Each item is [name, quantity, line amount as printed]. Service charge and VAT are
 * receipt level, and `total` is the printed grand total, used only to check the result.
 */
export const ExtractionSchema = z.object({
  items: z.array(z.tuple([z.string(), z.number(), z.number()])),
  servicePercent: z.number(),
  vatPercent: z.number(),
  vatIncluded: z.boolean(),
  total: z.number().nullable(),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

// llama.cpp rejects the boolean `items: false` that zod adds to tuples.
// maxItems already stops extra tuple entries.
const dropBooleanItems = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(dropBooleanItems);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key, value]) => !(key === 'items' && typeof value === 'boolean'))
      .map(([key, value]) => [key, dropBooleanItems(value)]),
  );
};

export const extractionJsonSchema = dropBooleanItems(z.toJSONSchema(ExtractionSchema)) as Record<
  string,
  unknown
>;
