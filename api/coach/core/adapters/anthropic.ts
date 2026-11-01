// Legacy dynamic types are explicit during the full language migration.
/* Anthropic Messages API. */
import { httpAdapter } from './http.ts';
import { SYSTEM_PROMPT } from '../system-prompt.ts';
export const ANTHROPIC_VERSION: any = '2023-06-01';
export const anthropicSpec: any = {
    id: 'anthropic',
    path: () => '/v1/messages',
    modelsPath: '/v1/models',
    headers: (key?: any) => ({
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        // Required for a call made from a browser context. Harmless from a server, and the phone's
        // native HTTP path does not need it either — it is here so a plain-browser dev run works.
        'anthropic-dangerous-direct-browser-access': 'true'
    }),
    // The rules block is marked cacheable: identical for every job of a task, so subsequent
    // jobs read it from Anthropic's prompt cache at a tenth of the input price.
    body: ({ model, prompt, system, maxTokens }: any) => ({
        model,
        max_tokens: maxTokens,
        system: system
            ? [{ type: 'text', text: SYSTEM_PROMPT + '\n\n' + system, cache_control: { type: 'ephemeral' } }]
            : SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }]
    }),
    errorMessage: (data?: any) => data && data.error && data.error.message,
    readText: (data?: any) => {
        if (data.stop_reason === 'refusal')
            return { error: 'the model declined this request' + (data.stop_details && data.stop_details.explanation ? ': ' + data.stop_details.explanation : '') };
        const text: any = (data.content || []).filter((b?: any) => b && b.type === 'text').map((b?: any) => b.text).join('');
        return { text, truncated: data.stop_reason === 'max_tokens' };
    },
    readModels: (data?: any) => (data.data || []).map((m?: any) => m.id)
};
export default httpAdapter(anthropicSpec);
