export type TranslationEndpointMode = 'auto' | 'responses' | 'chat_completions'

export interface TranslationConfig {
    apiBaseUrl: string
    apiKey: string
    model: string
    targetLanguage: string
    endpointMode: TranslationEndpointMode
    timeoutMs: number
}

export interface TranslationRequest {
    text: string
    sourceType?: string
    signal?: AbortSignal
}

export interface TranslationResult {
    text: string
    endpointUsed: Exclude<TranslationEndpointMode, 'auto'>
}

export class TranslationError extends Error {
    status?: number
    body?: string

    constructor (message: string, opts?: { status?: number, body?: string }) {
        super(message)
        this.name = 'TranslationError'
        this.status = opts?.status
        this.body = opts?.body
    }
}

const DEFAULT_TIMEOUT_MS = 30000

function getFetch (): typeof fetch {
    const fn = (globalThis as any)?.fetch
    if (typeof fn !== 'function') {
        throw new TranslationError('Fetch API is not available in this environment')
    }
    return fn.bind(globalThis)
}

function normalizeBaseUrl (rawBaseUrl: string): string {
    return (rawBaseUrl ?? '').trim().replace(/\/+$/, '')
}

function buildEndpointUrl (baseUrl: string, endpointPath: string): string {
    const normalizedBase = normalizeBaseUrl(baseUrl)
    if (!normalizedBase) {
        throw new TranslationError('Translation API Base URL is not configured')
    }
    const path = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
    return `${normalizedBase}${path}`
}

function buildSystemPrompt (targetLanguage: string, sourceType?: string): string {
    const safeLanguage = (targetLanguage ?? '').trim() || 'Simplified Chinese'
    const safeSourceType = (sourceType ?? 'text').trim()

    return [
        `Translate the user's selected content into ${safeLanguage}.`,
        'Only translate. Do not explain, summarize, or expand.',
        'Preserve code, commands, file paths, URLs, identifiers, variable names, option flags, and configuration keys exactly as written.',
        'If the content mixes code and natural language, translate only the natural language parts.',
        'Preserve original line breaks and structure whenever reasonable.',
        `Source type: ${safeSourceType}.`,
    ].join(' ')
}

function extractTextFromResponses (data: any): string {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
        return data.output_text.trim()
    }

    const output = Array.isArray(data?.output) ? data.output : []
    const parts: string[] = []

    for (const item of output) {
        if (item?.type !== 'message') {
            continue
        }
        const content = Array.isArray(item?.content) ? item.content : []
        for (const part of content) {
            if (part?.type === 'output_text' && typeof part?.text === 'string' && part.text.trim()) {
                parts.push(part.text.trim())
            }
        }
    }

    return parts.join('\n\n').trim()
}

function extractTextFromChatCompletions (data: any): string {
    const choices = Array.isArray(data?.choices) ? data.choices : []
    const first = choices[0]
    const message = first?.message

    if (typeof message?.content === 'string' && message.content.trim()) {
        return message.content.trim()
    }

    if (Array.isArray(message?.content)) {
        const parts = message.content
            .map((part: any) => (typeof part?.text === 'string' ? part.text.trim() : ''))
            .filter(Boolean)
        return parts.join('\n\n').trim()
    }

    return ''
}

function combineAbortSignals (signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
    const activeSignals = signals.filter(Boolean) as AbortSignal[]
    if (!activeSignals.length) {
        return undefined
    }
    if (activeSignals.length === 1) {
        return activeSignals[0]
    }

    const controller = new AbortController()
    const onAbort = (): void => {
        if (!controller.signal.aborted) {
            controller.abort()
        }
        cleanup()
    }
    const cleanup = (): void => {
        for (const signal of activeSignals) {
            signal.removeEventListener('abort', onAbort)
        }
    }

    for (const signal of activeSignals) {
        if (signal.aborted) {
            onAbort()
            return controller.signal
        }
        signal.addEventListener('abort', onAbort, { once: true })
    }

    return controller.signal
}

async function requestJson (url: string, body: any, apiKey: string, signal?: AbortSignal): Promise<any> {
    const fetchFn = getFetch()
    const res = await fetchFn(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
    })

    const text = await res.text()
    let data: any = null
    try {
        data = text ? JSON.parse(text) : null
    } catch {
        data = null
    }

    if (!res.ok) {
        const message =
            data?.error?.message ||
            data?.message ||
            text ||
            `Request failed with status ${res.status}`
        throw new TranslationError(message, { status: res.status, body: text })
    }

    return data
}

async function translateViaResponses (
    config: TranslationConfig,
    req: TranslationRequest,
    signal?: AbortSignal,
): Promise<TranslationResult> {
    const systemPrompt = buildSystemPrompt(config.targetLanguage, req.sourceType)
    const data = await requestJson(
        buildEndpointUrl(config.apiBaseUrl, '/responses'),
        {
            model: config.model,
            input: [
                {
                    role: 'system',
                    content: [
                        { type: 'input_text', text: systemPrompt },
                    ],
                },
                {
                    role: 'user',
                    content: [
                        { type: 'input_text', text: req.text },
                    ],
                },
            ],
            text: {
                format: {
                    type: 'text',
                },
            },
        },
        config.apiKey,
        signal,
    )

    const text = extractTextFromResponses(data)
    if (!text) {
        throw new TranslationError('Responses API returned no translation text')
    }

    return {
        text,
        endpointUsed: 'responses',
    }
}

async function translateViaChatCompletions (
    config: TranslationConfig,
    req: TranslationRequest,
    signal?: AbortSignal,
): Promise<TranslationResult> {
    const systemPrompt = buildSystemPrompt(config.targetLanguage, req.sourceType)
    const data = await requestJson(
        buildEndpointUrl(config.apiBaseUrl, '/chat/completions'),
        {
            model: config.model,
            messages: [
                {
                    role: 'developer',
                    content: systemPrompt,
                },
                {
                    role: 'user',
                    content: req.text,
                },
            ],
        },
        config.apiKey,
        signal,
    )

    const text = extractTextFromChatCompletions(data)
    if (!text) {
        throw new TranslationError('Chat Completions API returned no translation text')
    }

    return {
        text,
        endpointUsed: 'chat_completions',
    }
}

function shouldFallbackToChatCompletions (error: any): boolean {
    const status = error?.status
    if (!status) {
        return true
    }

    if (status === 401 || status === 403 || status === 408 || status === 429) {
        return false
    }

    if (status >= 500) {
        return true
    }

    return status === 400 || status === 404 || status === 405 || status === 415 || status === 422
}

export function getDefaultTranslationConfig (): TranslationConfig {
    return {
        apiBaseUrl: '',
        apiKey: '',
        model: 'gpt-5.4-nano',
        targetLanguage: 'Simplified Chinese',
        endpointMode: 'auto',
        timeoutMs: DEFAULT_TIMEOUT_MS,
    }
}

export async function translateSelection (
    config: TranslationConfig,
    req: TranslationRequest,
): Promise<TranslationResult> {
    if (!(config.apiBaseUrl ?? '').trim()) {
        throw new TranslationError('Translation API Base URL is not configured')
    }
    if (!(config.apiKey ?? '').trim()) {
        throw new TranslationError('Translation API key is not configured')
    }
    if (!(req.text ?? '').trim()) {
        throw new TranslationError('No text selected for translation')
    }

    const timeoutController = new AbortController()
    const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
        ? Math.round(config.timeoutMs)
        : DEFAULT_TIMEOUT_MS
    const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs)
    const signal = combineAbortSignals([req.signal, timeoutController.signal])

    try {
        if (config.endpointMode === 'responses') {
            return await translateViaResponses(config, req, signal)
        }
        if (config.endpointMode === 'chat_completions') {
            return await translateViaChatCompletions(config, req, signal)
        }

        try {
            return await translateViaResponses(config, req, signal)
        } catch (e: any) {
            if (!shouldFallbackToChatCompletions(e)) {
                throw e
            }
        }

        return await translateViaChatCompletions(config, req, signal)
    } catch (e: any) {
        if (timeoutController.signal.aborted && !(req.signal?.aborted)) {
            throw new TranslationError(`Translation request timed out after ${timeoutMs} ms`)
        }
        if (e instanceof TranslationError) {
            throw e
        }
        throw new TranslationError(e?.message ?? 'Translation request failed')
    } finally {
        clearTimeout(timeoutHandle)
    }
}
