// Legacy dynamic types are explicit during the full language migration.
/* Google Gemini (Generative Language API). The key travels as a header, never as `?key=` —
 * a query string ends up in proxy logs, error messages and browser history. */
import { httpAdapter } from './http.ts';
import { SYSTEM_PROMPT } from '../system-prompt.ts';
const versionOf: any = (m?: any) => { const v: any = /^gemini-(\d+)(?:\.(\d+))?/.exec(m); return v ? Number(v[1]) * 100 + Number(v[2] || 0) : 0; };
export const geminiSpec: any = {
    id: 'gemini',
    path: (model?: any) => `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    modelsPath: '/v1beta/models?pageSize=200',
    headers: (key?: any) => ({ 'x-goog-api-key': key }),
    // No responseSchema on purpose: Gemini's OpenAPI subset rejects the type unions our schemas
    // use for before/after, and json mime plus the validator already holds the line.
    body: ({ prompt, system, maxTokens }: any) => ({
        systemInstruction: { parts: [{ text: system ? SYSTEM_PROMPT + '\n\n' + system : SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens }
    }),
    errorMessage: (data?: any) => data && data.error && data.error.message,
    readText: (data?: any) => {
        const cand: any = (data.candidates || [])[0];
        if (!cand) {
            const block: any = data.promptFeedback && data.promptFeedback.blockReason;
            return { error: block ? `the request was blocked: ${block}` : 'the answer had no candidates' };
        }
        if (cand.finishReason === 'MAX_TOKENS')
            return { text: '', truncated: true };
        if (cand.finishReason && cand.finishReason !== 'STOP')
            return { error: `the model stopped early: ${cand.finishReason}` };
        const text: any = ((cand.content && cand.content.parts) || []).map((p?: any) => p.text || '').join('');
        return { text, truncated: false };
    },
    // After a refused model (#758): the newest plain Flash the key lists, since that is the one a
    // free key can call; then the newest non-preview Gemini; then whatever text model is there.
    preferModel: (models?: any) => {
        const newest: any = (list?: any) => list.slice().sort((a?: any, b?: any) => versionOf(b) - versionOf(a))[0];
        return newest(models.filter((m?: any) => /^gemini-[\d.]+-flash$/.test(m)))
            || newest(models.filter((m?: any) => /^gemini-/.test(m) && !/preview|exp/.test(m)))
            || models[0];
    },
    readModels: (data?: any) => (data.models || [])
        .filter((m?: any) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
        .map((m?: any) => String(m.name || '').replace(/^models\//, ''))
};
export default httpAdapter(geminiSpec);
