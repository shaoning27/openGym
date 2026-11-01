// Legacy dynamic types are explicit during the full language migration.
/* Any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM, OpenRouter, a gateway of your own.
 * Same wire shape as openai.ts; the base URL comes from configuration and the key is optional.
 * `max_tokens` rather than `max_completion_tokens` because that is the field every one of
 * those servers understands. */
import { httpAdapter } from './http.ts';
import { chatCompletionsSpec } from './openai.ts';
// temperature 0: a plan diff wants determinism, and greedy decoding is also what grammar-
// constrained sampling on a local server handles fastest. A gateway that mounts the API under a
// path without a version (Open WebUI's /openai) is reached by the 404 fallback in http.ts (#508).
export const compatibleSpec: any = chatCompletionsSpec('compatible', { maxTokensField: 'max_tokens', temperature: 0, versionlessFallback: true });
export default httpAdapter(compatibleSpec);
