import * as z from 'zod';

import { getLogger } from '../../logger.ts';
import { type Extraction, ExtractionSchema, extractionJsonSchema } from './extraction.ts';
import { SYSTEM_PROMPT, userPrompt } from './prompt.ts';

const log = getLogger('scanner.llm');

const ChatCompletionSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }), finish_reason: z.string().nullish() }))
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

export interface ReceiptExtractor {
  extract(ocrText: string): Promise<Extraction>;
}

/**
 * Extractor for any OpenAI compatible chat completions API, such as llama.cpp
 * llama-server. The JSON schema in `response_format` constrains decoding, so the
 * model can only produce JSON in the extraction shape.
 */
export class OpenAiCompatibleExtractor implements ReceiptExtractor {
  constructor(
    private readonly url: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly apiKey?: string,
  ) {}

  async extract(ocrText: string): Promise<Extraction> {
    const startedAt = performance.now();
    const res = await fetch(`${this.url}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(ocrText) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'receipt', strict: true, schema: extractionJsonSchema },
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`LLM server answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const completion = ChatCompletionSchema.parse(await res.json());
    const choice = completion.choices[0]!;
    const tokens = completion.usage
      ? ` prompt=${completion.usage.prompt_tokens} completion=${completion.usage.completion_tokens} tokens`
      : '';
    log.info(`${this.model} answered in ${Math.round(performance.now() - startedAt)}ms${tokens}`);
    if (choice.finish_reason === 'length') {
      throw new Error('LLM output was cut off at max_tokens');
    }

    return ExtractionSchema.parse(JSON.parse(choice.message.content));
  }
}
