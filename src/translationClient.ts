export type TranslationEndpointMode = 'auto' | 'responses' | 'chat_completions'
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface TranslationConfig {
    apiBaseUrl: string
    apiKey: string
    model: string
    askModel: string
    askReasoningEffort: ReasoningEffort
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

export interface AskAiRequest {
    selection: string
    question: string
    sourceType?: string
    signal?: AbortSignal
}

export interface AskAiResult extends TranslationResult {}

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
        throw new TranslationError('当前环境不支持 Fetch API')
    }
    return fn.bind(globalThis)
}

function normalizeBaseUrl (rawBaseUrl: string): string {
    return (rawBaseUrl ?? '').trim().replace(/\/+$/, '')
}

function buildEndpointUrl (baseUrl: string, endpointPath: string): string {
    const normalizedBase = normalizeBaseUrl(baseUrl)
    if (!normalizedBase) {
        throw new TranslationError('未配置翻译 API 基础地址')
    }
    const path = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
    return `${normalizedBase}${path}`
}

function buildSystemPrompt (targetLanguage: string, sourceType?: string): string {
    const safeLanguage = (targetLanguage ?? '').trim() || '简体中文'
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

function buildAskAiSystemPrompt (sourceType?: string): string {
    const safeSourceType = (sourceType ?? 'text').trim()

    return [
        'Answer the user\'s question about the selected content.',
        'Use the selected content as the primary context.',
        'Be accurate, direct, and concise.',
        'Preserve code, commands, file paths, URLs, identifiers, variable names, option flags, and configuration keys exactly as written.',
        'If the selection does not contain enough context to answer reliably, say so clearly.',
        'Answer in the same language as the user\'s question whenever reasonable.',
        `Source type: ${safeSourceType}.`,
    ].join(' ')
}

function buildAskAiUserPrompt (selection: string, question: string): string {
    return [
        'Selected content:',
        selection,
        '',
        'Question:',
        question,
    ].join('\n')
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

type TextGenerationRequest = {
    model: string
    systemPrompt: string
    userText: string
    reasoningEffort?: ReasoningEffort
}

async function requestTextViaResponses (
    config: TranslationConfig,
    req: TextGenerationRequest,
    signal?: AbortSignal,
): Promise<TranslationResult> {
    const body: any = {
        model: req.model,
        input: [
            {
                role: 'system',
                content: [
                    { type: 'input_text', text: req.systemPrompt },
                ],
            },
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: req.userText },
                ],
            },
        ],
        text: {
            format: {
                type: 'text',
            },
        },
    }

    if (req.reasoningEffort) {
        body.reasoning = {
            effort: req.reasoningEffort,
        }
    }

    const data = await requestJson(
        buildEndpointUrl(config.apiBaseUrl, '/responses'),
        body,
        config.apiKey,
        signal,
    )

    const text = extractTextFromResponses(data)
    if (!text) {
        throw new TranslationError('Responses 接口未返回任何文本')
    }

    return {
        text,
        endpointUsed: 'responses',
    }
}

async function requestTextViaChatCompletions (
    config: TranslationConfig,
    req: TextGenerationRequest,
    signal?: AbortSignal,
): Promise<TranslationResult> {
    const body: any = {
        model: req.model,
        messages: [
            {
                role: 'developer',
                content: req.systemPrompt,
            },
            {
                role: 'user',
                content: req.userText,
            },
        ],
    }

    if (req.reasoningEffort) {
        body.reasoning_effort = req.reasoningEffort
    }

    const data = await requestJson(
        buildEndpointUrl(config.apiBaseUrl, '/chat/completions'),
        body,
        config.apiKey,
        signal,
    )

    const text = extractTextFromChatCompletions(data)
    if (!text) {
        throw new TranslationError('对话补全接口未返回任何文本')
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

type RunTextGenerationOptions = {
    model: string
    systemPrompt: string
    userText: string
    reasoningEffort?: ReasoningEffort
    signal?: AbortSignal
    requestName: string
}

async function runTextGeneration (
    config: TranslationConfig,
    opts: RunTextGenerationOptions,
): Promise<TranslationResult> {
    if (!(config.apiBaseUrl ?? '').trim()) {
        throw new TranslationError('未配置翻译 API 基础地址')
    }
    if (!(config.apiKey ?? '').trim()) {
        throw new TranslationError('未配置翻译 API 密钥')
    }
    if (!(opts.model ?? '').trim()) {
        throw new TranslationError(`未配置${opts.requestName}模型`)
    }
    if (!(opts.userText ?? '').trim()) {
        throw new TranslationError(`${opts.requestName}未提供输入内容`)
    }

    const timeoutController = new AbortController()
    const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
        ? Math.round(config.timeoutMs)
        : DEFAULT_TIMEOUT_MS
    const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs)
    const signal = combineAbortSignals([opts.signal, timeoutController.signal])
    const request: TextGenerationRequest = {
        model: opts.model,
        systemPrompt: opts.systemPrompt,
        userText: opts.userText,
    }

    try {
        if (config.endpointMode === 'responses') {
            return await requestTextViaResponses(config, request, signal)
        }
        if (config.endpointMode === 'chat_completions') {
            return await requestTextViaChatCompletions(config, request, signal)
        }

        try {
            return await requestTextViaResponses(config, request, signal)
        } catch (e: any) {
            if (!shouldFallbackToChatCompletions(e)) {
                throw e
            }
        }

        return await requestTextViaChatCompletions(config, request, signal)
    } catch (e: any) {
        if (timeoutController.signal.aborted && !(opts.signal?.aborted)) {
            throw new TranslationError(`${opts.requestName}超时（${timeoutMs} 毫秒）`)
        }
        if (e instanceof TranslationError) {
            throw e
        }
        throw new TranslationError(e?.message ?? `${opts.requestName}失败`)
    } finally {
        clearTimeout(timeoutHandle)
    }
}

export function getDefaultTranslationConfig (): TranslationConfig {
    return {
        apiBaseUrl: '',
        apiKey: '',
        model: 'gpt-5.4-nano',
        askModel: 'gpt-5.4-nano',
        askReasoningEffort: 'medium',
        targetLanguage: '简体中文',
        endpointMode: 'auto',
        timeoutMs: DEFAULT_TIMEOUT_MS,
    }
}

export async function translateSelection (
    config: TranslationConfig,
    req: TranslationRequest,
): Promise<TranslationResult> {
    if (!(req.text ?? '').trim()) {
        throw new TranslationError('没有可供翻译的选中文本')
    }

    return await runTextGeneration(config, {
        model: config.model,
        systemPrompt: buildSystemPrompt(config.targetLanguage, req.sourceType),
        userText: req.text,
        signal: req.signal,
        requestName: '翻译请求',
    })
}

export async function askAiAboutSelection (
    config: TranslationConfig,
    req: AskAiRequest,
): Promise<AskAiResult> {
    if (!(req.selection ?? '').trim()) {
        throw new TranslationError('没有可供提问的选中文本')
    }
    if (!(req.question ?? '').trim()) {
        throw new TranslationError('请输入问题')
    }

    return await runTextGeneration(config, {
        model: config.askModel,
        systemPrompt: buildAskAiSystemPrompt(req.sourceType),
        userText: buildAskAiUserPrompt(req.selection, req.question),
        reasoningEffort: config.askReasoningEffort,
        signal: req.signal,
        requestName: '提问请求',
    })
}
