import { ChangeDetectorRef, Component, ElementRef, Injector, ViewChild } from '@angular/core'
import { AppService, BaseTabComponent, NotificationsService, PlatformService, ThemesService } from 'tabby-core'
import { SFTPSession } from 'tabby-ssh'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import {
    askAiAboutSelection,
    getDefaultTranslationConfig,
    ReasoningEffort,
    translateSelection,
    TranslationConfig,
    TranslationEndpointMode,
    TranslationError,
} from './translationClient'

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('github-markdown-css/github-markdown.css')

type Monaco = typeof import('monaco-editor/esm/vs/editor/editor.api')
type PdfJs = typeof import('pdfjs-dist/types/src/pdf')

type TranslationSelectionSource = 'monaco' | 'markdown' | 'pdf'
type TranslationPopoverTab = 'translate' | 'ask_ai'

type TranslationAnchor = {
    top: number
    left: number
}

type TranslationSelectionState = {
    text: string
    source: TranslationSelectionSource
    sourceType: string
    anchor: TranslationAnchor
}

export interface SFTPFileItem {
    name: string
    fullPath: string
    isDirectory: boolean
    isSymlink?: boolean
    mode: number
    size: number
    children?: SFTPFileItem[]
    loaded?: boolean
    loadError?: string|null
}

type PdfTextContentSource = Parameters<PdfJs['renderTextLayer']>[0]['textContentSource']
type PdfViewportLike = Parameters<PdfJs['renderTextLayer']>[0]['viewport']
type PdfSidebarMode = 'files' | 'outline'

interface PdfPageReference {
    num: number
    gen: number
}

type PdfOutlineExplicitDestination = unknown[]
type PdfOutlineDestination = string | PdfOutlineExplicitDestination | null

type PdfOutlineResolvedTarget = {
    explicitDestination: PdfOutlineExplicitDestination | null
    pageNumber: number | null
}

type PdfOutlineViewportOffset = {
    left: number
    top: number
}

interface PdfOutlineDestinationConfig {
    name?: string | null
}

interface PdfOutlineSourceItem {
    title?: string | null
    dest?: PdfOutlineDestination
    url?: string | null
    items?: PdfOutlineSourceItem[] | null
}

interface PdfOutlineItem {
    id: string
    title: string
    pageNumber: number | null
    explicitDestination: PdfOutlineExplicitDestination | null
    url: string | null
    items: PdfOutlineItem[]
    expanded: boolean
    clickable: boolean
}

type PdfLoadingTaskLike = {
    promise: Promise<PdfDocumentLike>
    destroy?: () => unknown
}

type PdfCancellableTaskLike = {
    promise: Promise<unknown>
    cancel?: () => unknown
}

interface PdfPageLike {
    getViewport (params: { scale: number }): PdfViewportLike
    render (params: {
        canvasContext: CanvasRenderingContext2D
        viewport: PdfViewportLike
        transform?: number[]
    }): PdfCancellableTaskLike
    streamTextContent (params: {
        includeMarkedContent: boolean
        disableNormalization: boolean
    }): PdfTextContentSource
}

interface PdfDocumentLike {
    numPages: number
    getPage (pageNumber: number): Promise<PdfPageLike>
    getOutline (): Promise<PdfOutlineSourceItem[] | null>
    getDestination (destinationId: string): Promise<PdfOutlineExplicitDestination | null>
    cachedPageNumber?: (ref: PdfPageReference) => number | null | undefined
    getPageIndex (ref: PdfPageReference): Promise<number>
    cleanup?: () => unknown
    destroy?: () => unknown
}

function getMonaco (): Monaco {
    // Lazy-load so publicPath is already set.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('monaco-editor/esm/vs/editor/editor.api')
}

function getDomPurify (): any {
    // Sanitize rendered HTML before binding it into the Angular template.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('monaco-editor/esm/vs/base/browser/dompurify/dompurify')
}

let pdfJsModule: PdfJs | null | undefined
function getPdfJs (): PdfJs {
    if (pdfJsModule) {
        return pdfJsModule
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    pdfJsModule = require('pdfjs-dist/webpack') as PdfJs
    return pdfJsModule
}

const markdownPreviewProcessor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })

function escapeHtml (value: string): string {
    return (value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function renderMarkdownPreview (text: string): string {
    try {
        const domPurifyModule = getDomPurify()
        const sanitize = domPurifyModule?.sanitize ?? domPurifyModule?.default?.sanitize ?? domPurifyModule?.default

        if (typeof sanitize !== 'function') {
            return `<pre>${escapeHtml(text)}</pre>`
        }
        const rawHtml = String(
            markdownPreviewProcessor.processSync(text ?? ''),
        )

        return sanitize(rawHtml, {
            USE_PROFILES: { html: true },
            ALLOW_UNKNOWN_PROTOCOLS: false,
        }) ?? ''
    } catch (e: any) {
        const detail = e?.message ?? 'Unknown error'
        return `
            <div class="markdown-preview-error">
                <strong>Markdown render failed</strong>
                <pre>${escapeHtml(detail)}</pre>
            </div>
        `
    }
}

let monacoLanguagesLoaded = false
function ensureMonacoLanguagesLoaded (): void {
    if (monacoLanguagesLoaded) {
        return
    }
    monacoLanguagesLoaded = true

    // Register syntax tokenizers we care about. (Most are "basic" languages.)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/python/python.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/shell/shell.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/go/go.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/ini/ini.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution')

    // Web development
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/html/html.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/css/css.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/scss/scss.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/less/less.contribution')

    // Databases
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/sql/sql.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/mysql/mysql.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/pgsql/pgsql.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/redis/redis.contribution')

    // Systems programming
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/rust/rust.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/java/java.contribution')

    // Other common formats / languages
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/php/php.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/perl/perl.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/lua/lua.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/xml/xml.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution')

    // JSON is provided by a dedicated language service.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/language/json/monaco.contribution')
}

let formattingProvidersRegistered = false
function registerFormattingProviders (notifications: { error: (msg: string) => void, notice: (msg: string) => void }): void {
    if (formattingProvidersRegistered) {
        return
    }
    formattingProvidersRegistered = true

    const monaco = getMonaco()

    monaco.languages.registerDocumentFormattingEditProvider('json', {
        displayName: 'Tabby JSON Formatter',
        provideDocumentFormattingEdits (model: any, options: any) {
            const text = model.getValue()
            try {
                const parsed = JSON.parse(text)
                const tabSize = options.tabSize ?? 2
                const insertSpaces = options.insertSpaces !== false
                const indent = insertSpaces ? ' '.repeat(tabSize) : '\t'
                const formatted = JSON.stringify(parsed, null, indent) + '\n'

                return [{
                    range: model.getFullModelRange(),
                    text: formatted,
                }]
            } catch (e: any) {
                const msg = e?.message ?? 'Invalid JSON'
                const posMatch = msg.match(/position\s+(\d+)/i)
                let detail = msg
                if (posMatch) {
                    const pos = parseInt(posMatch[1], 10)
                    let line = 1
                    for (let i = 0; i < pos && i < text.length; i++) {
                        if (text[i] === '\n') {
                            line++
                        }
                    }
                    detail = `Line ${line}: ${msg}`
                }
                notifications.error(`JSON format failed: ${detail}`)
                return []
            }
        },
    })

    const unsupported = ['yaml', 'python', 'shell', 'go', 'rust', 'ruby', 'perl', 'lua', 'ini', 'graphql', 'sql', 'mysql', 'pgsql', 'redis', 'dockerfile', 'markdown', 'plaintext']
    for (const lang of unsupported) {
        try {
            monaco.languages.registerDocumentFormattingEditProvider(lang, {
                provideDocumentFormattingEdits () {
                    notifications.notice(`Formatting is not available for ${lang}`)
                    return []
                },
            })
        } catch {
            // language may not exist
        }
    }
}

function getRussh (): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('russh')
}

function detectLanguageId (pathOrName: string): string {
    const base = (pathOrName ?? '').split(/[\\/]/).pop()?.toLowerCase() ?? ''

    if (base === 'dockerfile' || base.endsWith('.dockerfile')) {
        return 'dockerfile'
    }
    if (base.endsWith('.py')) {
        return 'python'
    }
    if (
        base.endsWith('.sh') ||
        base.endsWith('.bash') ||
        base.endsWith('.zsh') ||
        base === '.bashrc' ||
        base === '.zshrc'
    ) {
        return 'shell'
    }
    if (base.endsWith('.ts') || base.endsWith('.tsx')) {
        return 'typescript'
    }
    if (base.endsWith('.js') || base.endsWith('.jsx') || base.endsWith('.mjs') || base.endsWith('.cjs')) {
        return 'javascript'
    }
    if (base.endsWith('.html') || base.endsWith('.htm')) {
        return 'html'
    }
    if (base.endsWith('.css')) {
        return 'css'
    }
    if (base.endsWith('.scss')) {
        return 'scss'
    }
    if (base.endsWith('.less')) {
        return 'less'
    }
    if (base.endsWith('.go')) {
        return 'go'
    }
    if (base.endsWith('.sql')) {
        return 'sql'
    }
    if (base.endsWith('.mysql')) {
        return 'mysql'
    }
    if (base.endsWith('.pgsql')) {
        return 'pgsql'
    }
    if (base.endsWith('.redis')) {
        return 'redis'
    }
    if (base.endsWith('.rs')) {
        return 'rust'
    }
    if (base.endsWith('.cpp') || base.endsWith('.cc') || base.endsWith('.cxx') || base.endsWith('.hpp') || base.endsWith('.hh') || base.endsWith('.hxx')) {
        return 'cpp'
    }
    if (base.endsWith('.c') || base.endsWith('.h')) {
        return 'c'
    }
    if (base.endsWith('.java')) {
        return 'java'
    }
    if (base.endsWith('.rb')) {
        return 'ruby'
    }
    if (base.endsWith('.php')) {
        return 'php'
    }
    if (base.endsWith('.pl') || base.endsWith('.pm')) {
        return 'perl'
    }
    if (base.endsWith('.lua')) {
        return 'lua'
    }
    if (base.endsWith('.xml')) {
        return 'xml'
    }
    if (base.endsWith('.graphql') || base.endsWith('.gql')) {
        return 'graphql'
    }
    if (base.endsWith('.json')) {
        return 'json'
    }
    if (base.endsWith('.yml') || base.endsWith('.yaml')) {
        return 'yaml'
    }
    if (base.endsWith('.md') || base.endsWith('.markdown')) {
        return 'markdown'
    }

    // "config"-ish files: INI tokenization is a reasonable default.
    if (
        base.endsWith('.conf') ||
        base.endsWith('.cfg') ||
        base.endsWith('.ini') ||
        base.endsWith('.config') ||
        base.endsWith('.properties')
    ) {
        return 'ini'
    }

    return 'plaintext'
}

const LARGE_FILE_WARNING_SIZE = 1 * 1024 * 1024   // 1MB
const LARGE_FILE_READONLY_SIZE = 5 * 1024 * 1024  // 5MB
const LARGE_FILE_REJECT_SIZE = 20 * 1024 * 1024   // 20MB

const SIDEBAR_MIN_WIDTH = 150
const SIDEBAR_MAX_WIDTH = 400
const TRANSLATION_MAX_SELECTION_LENGTH = 4000
const TRANSLATION_POPOVER_MIN_WIDTH = 280
const TRANSLATION_POPOVER_MIN_HEIGHT = 220
const PDF_MIN_ZOOM = 0.5
const PDF_MAX_ZOOM = 3
const PDF_ZOOM_STEP = 0.25
const PDF_CSS_UNITS = 96 / 72
const ASK_REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh']

function clampNumber (value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min
    }
    return Math.max(min, Math.min(max, value))
}

function hasPdfMagicHeader (buffer: Buffer): boolean {
    return buffer.length >= 5 && buffer.slice(0, 5).toString('ascii') === '%PDF-'
}

function isPdfPreviewableFile (buffer: Buffer, pathOrName: string): boolean {
    const normalized = (pathOrName ?? '').trim().toLowerCase()
    return hasPdfMagicHeader(buffer) || (normalized.endsWith('.pdf') && isBinaryContent(buffer))
}

function formatBytes (size: number): string {
    if (!Number.isFinite(size) || size < 0) {
        return `${size}`
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let n = size
    let unit = 0
    while (n >= 1024 && unit < units.length - 1) {
        n /= 1024
        unit++
    }

    if (unit === 0) {
        return `${n} ${units[unit]}`
    }
    const digits = n >= 10 ? 1 : 2
    return `${n.toFixed(digits)} ${units[unit]}`
}

type EncodingOption = { id: string, label: string }

const ENCODINGS: EncodingOption[] = [
    { id: 'utf-8', label: 'UTF-8' },
    { id: 'gbk', label: 'GBK (Simplified Chinese)' },
    { id: 'gb18030', label: 'GB18030 (Simplified Chinese)' },
    { id: 'big5', label: 'Big5 (Traditional Chinese)' },
    { id: 'shift_jis', label: 'Shift_JIS (Japanese)' },
    { id: 'euc-kr', label: 'EUC-KR (Korean)' },
    { id: 'iso-8859-1', label: 'ISO-8859-1 (Latin-1)' },
    { id: 'windows-1252', label: 'Windows-1252' },
]

function isBinaryContent (buffer: Buffer): boolean {
    const sample = buffer.slice(0, 8192)

    if (sample.includes(0x00)) {
        return true
    }

    let nonText = 0
    for (const byte of sample) {
        if (byte < 0x09 || (byte > 0x0D && byte < 0x20 && byte !== 0x1B)) {
            nonText++
        }
    }
    return sample.length > 0 && nonText / sample.length > 0.1
}

function detectBOM (buffer: Buffer): { encoding: string, offset: number }|null {
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        return { encoding: 'utf-8', offset: 3 }
    }
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        return { encoding: 'utf-16le', offset: 2 }
    }
    if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
        return { encoding: 'utf-16be', offset: 2 }
    }
    return null
}

let iconvLite: any|null|undefined
function getIconvLite (): any|null {
    if (iconvLite !== undefined) {
        return iconvLite
    }
    try {
        // Optional runtime dependency (Tabby may already ship it via transitive deps)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        iconvLite = require('iconv-lite')
    } catch {
        iconvLite = null
    }
    return iconvLite
}

type RGB = { r: number, g: number, b: number }

function clamp255 (n: number): number {
    if (!Number.isFinite(n)) {
        return 0
    }
    return Math.max(0, Math.min(255, Math.round(n)))
}

function parseCssColor (value: string): RGB|null {
    const color = (value ?? '').trim().toLowerCase()
    if (!color || color === 'transparent') {
        return null
    }

    if (color.startsWith('#')) {
        const hex = color.slice(1)
        if (hex.length === 3) {
            const r = int(hex[0] + hex[0])
            const g = int(hex[1] + hex[1])
            const b = int(hex[2] + hex[2])
            if (r === null || g === null || b === null) {
                return null
            }
            return { r, g, b }
        }
        if (hex.length === 6 || hex.length === 8) {
            const r = int(hex.slice(0, 2))
            const g = int(hex.slice(2, 4))
            const b = int(hex.slice(4, 6))
            if (r === null || g === null || b === null) {
                return null
            }
            return { r, g, b }
        }
        return null
    }

    const m = color.match(/^rgba?\((.*)\)$/)
    if (m) {
        const body = m[1]
            .replace(/\s*\/\s*/g, ',')
            .replace(/\s+/g, ',')
        const parts = body.split(',').map(x => x.trim()).filter(Boolean)
        if (parts.length < 3) {
            return null
        }

        const r = parseChannel(parts[0])
        const g = parseChannel(parts[1])
        const b = parseChannel(parts[2])
        if (r === null || g === null || b === null) {
            return null
        }
        return { r, g, b }
    }

    return null

    function int (s: string): number|null {
        const v = Number.parseInt(s, 16)
        return Number.isFinite(v) ? clamp255(v) : null
    }

    function parseChannel (s: string): number|null {
        if (s.endsWith('%')) {
            const v = Number.parseFloat(s.slice(0, -1))
            return Number.isFinite(v) ? clamp255(255 * v / 100) : null
        }
        const v = Number.parseFloat(s)
        return Number.isFinite(v) ? clamp255(v) : null
    }
}

function srgbChannelToLinear (channel255: number): number {
    const c = clamp255(channel255) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance (rgb: RGB): number {
    const r = srgbChannelToLinear(rgb.r)
    const g = srgbChannelToLinear(rgb.g)
    const b = srgbChannelToLinear(rgb.b)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

@Component({
    selector: 'mingze-online-editor-tab',
    template: require('./remoteEditorTab.component.pug'),
    // Keep styles inline so we don't need a to-string loader for component CSS.
    styles: [`
        :host { display: block; height: 100%; width: 100%; }
        .min-vh-0 { min-height: 0; }
        .min-h-0 { min-height: 0; }
        .min-w-0 { min-width: 0; }
        .cursor-pointer { cursor: pointer; }

        .editor-shell {
            background: var(--theme-bg, var(--bs-body-bg));
        }

        .editor-toolbar {
            background: var(--theme-bg-less, rgba(0, 0, 0, 0.02));
            border-bottom-color: var(--theme-bg-more, var(--bs-border-color, rgba(0, 0, 0, 0.08))) !important;
        }

        .editor-toolbar-dark {
            background: rgba(255, 255, 255, 0.03);
            border-bottom-color: rgba(255, 255, 255, 0.08) !important;
        }

        .editor-toolbar-light {
            background: rgba(0, 0, 0, 0.02);
            border-bottom-color: rgba(0, 0, 0, 0.08) !important;
        }

        .editor-toolbar .btn {
            display: inline-flex;
            align-items: center;
        }

        .editor-toolbar button[disabled] {
            opacity: 0.6;
            cursor: not-allowed;
        }

        .status-badge {
            font-weight: 600;
        }

        .editor-overlay-card {
            max-width: 560px;
            width: 100%;
        }

        .sidebar {
            flex-shrink: 0;
            min-width: 150px;
            max-width: 400px;
            position: relative;
            background: var(--theme-bg, var(--bs-body-bg));
        }

        .sidebar-header {
            background: var(--theme-bg-less, rgba(0, 0, 0, 0.02));
            border-bottom-color: var(--theme-bg-more, var(--bs-border-color, rgba(0, 0, 0, 0.08))) !important;
        }

        .sidebar-resizer {
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            width: 4px;
            cursor: col-resize;
            background: transparent;
        }

        .sidebar-resizer:hover {
            background: var(--bs-primary);
            opacity: 0.6;
        }

        .tree-item:hover {
            background: var(--theme-bg-less, rgba(0, 0, 0, 0.02));
        }

        .tree-item.active {
            background: var(--bs-primary);
            color: white;
        }

        .tree-refresh-btn {
            opacity: 0;
            font-size: 0.7em;
            transition: opacity 0.15s;
        }

        .tree-item:hover .tree-refresh-btn {
            opacity: 0.5;
        }

        .tree-refresh-btn:hover {
            opacity: 1 !important;
        }

        .tree-edit-input {
            background: var(--bs-body-bg, #fff);
            color: var(--bs-body-color, #000);
            border: 1px solid var(--bs-primary, #0d6efd);
            border-radius: 2px;
            padding: 0 4px;
            font-size: inherit;
            line-height: inherit;
            outline: none;
            min-width: 0;
        }

        .markdown-preview-shell {
            overflow: auto;
            padding: 1rem 1.5rem 2rem;
            background: var(--theme-bg, var(--bs-body-bg));
            color: var(--bs-body-color, inherit);
            user-select: text;
            -webkit-user-select: text;
            cursor: text;
        }

        .markdown-preview.markdown-body {
            box-sizing: border-box;
            min-width: 200px;
            width: clamp(320px, 90%, 1440px);
            max-width: 100%;
            margin: 0 auto;
            padding: 40px 48px;
            border-radius: 10px;
            border: 1px solid var(--theme-bg-more, var(--bs-border-color, rgba(0, 0, 0, 0.08)));
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
        }

        .markdown-preview.markdown-body,
        .markdown-preview.markdown-body * {
            box-sizing: border-box;
            user-select: text;
            -webkit-user-select: text;
        }

        @media (max-width: 767px) {
            .markdown-preview.markdown-body {
                width: 100%;
                padding: 15px;
                border-radius: 0;
                border-left: 0;
                border-right: 0;
            }
        }

        .markdown-preview.markdown-body[data-theme='light'] {
            color-scheme: light;
            --fgColor-accent: #0969da;
            --bgColor-attention-muted: #fff8c5;
            --bgColor-default: #ffffff;
            --bgColor-muted: #f6f8fa;
            --bgColor-neutral-muted: #818b981f;
            --borderColor-accent-emphasis: #0969da;
            --borderColor-attention-emphasis: #9a6700;
            --borderColor-danger-emphasis: #cf222e;
            --borderColor-default: #d1d9e0;
            --borderColor-done-emphasis: #8250df;
            --borderColor-success-emphasis: #1a7f37;
            --borderColor-muted: #d1d9e0b3;
            --borderColor-neutral-muted: #d1d9e0b3;
            --color-prettylights-syntax-brackethighlighter-angle: #59636e;
            --color-prettylights-syntax-brackethighlighter-unmatched: #82071e;
            --color-prettylights-syntax-carriage-return-bg: #cf222e;
            --color-prettylights-syntax-carriage-return-text: #f6f8fa;
            --color-prettylights-syntax-comment: #59636e;
            --color-prettylights-syntax-constant: #0550ae;
            --color-prettylights-syntax-constant-other-reference-link: #0a3069;
            --color-prettylights-syntax-entity: #6639ba;
            --color-prettylights-syntax-entity-tag: #0550ae;
            --color-prettylights-syntax-invalid-illegal-bg: rgba(255, 235, 233, 0.9);
            --color-prettylights-syntax-invalid-illegal-text: #d1242f;
            --color-prettylights-syntax-keyword: #cf222e;
            --color-prettylights-syntax-markup-bold: #1f2328;
            --color-prettylights-syntax-markup-changed-bg: #ffd8b5;
            --color-prettylights-syntax-markup-changed-text: #953800;
            --color-prettylights-syntax-markup-deleted-bg: #ffebe9;
            --color-prettylights-syntax-markup-deleted-text: #82071e;
            --color-prettylights-syntax-markup-heading: #0550ae;
            --color-prettylights-syntax-markup-ignored-bg: #0550ae;
            --color-prettylights-syntax-markup-ignored-text: #d1d9e0;
            --color-prettylights-syntax-markup-inserted-bg: #dafbe1;
            --color-prettylights-syntax-markup-inserted-text: #116329;
            --color-prettylights-syntax-markup-italic: #1f2328;
            --color-prettylights-syntax-markup-list: #3b2300;
            --color-prettylights-syntax-meta-diff-range: #8250df;
            --color-prettylights-syntax-storage-modifier-import: #1f2328;
            --color-prettylights-syntax-string: #0a3069;
            --color-prettylights-syntax-string-regexp: #116329;
            --color-prettylights-syntax-sublimelinter-gutter-mark: #818b98;
            --color-prettylights-syntax-variable: #953800;
            --fgColor-attention: #9a6700;
            --fgColor-danger: #d1242f;
            --fgColor-default: #1f2328;
            --fgColor-done: #8250df;
            --fgColor-muted: #59636e;
            --fgColor-success: #1a7f37;
            --focus-outlineColor: #0969da;
        }

        .markdown-preview.markdown-body[data-theme='dark'] {
            color-scheme: dark;
            --fgColor-accent: #4493f8;
            --bgColor-attention-muted: #bb800926;
            --bgColor-default: #0d1117;
            --bgColor-muted: #151b23;
            --bgColor-neutral-muted: #656c7633;
            --borderColor-accent-emphasis: #1f6feb;
            --borderColor-attention-emphasis: #9e6a03;
            --borderColor-danger-emphasis: #da3633;
            --borderColor-default: #3d444d;
            --borderColor-done-emphasis: #8957e5;
            --borderColor-success-emphasis: #238636;
            --borderColor-muted: #3d444db3;
            --borderColor-neutral-muted: #3d444db3;
            --color-prettylights-syntax-brackethighlighter-angle: #9198a1;
            --color-prettylights-syntax-brackethighlighter-unmatched: #f85149;
            --color-prettylights-syntax-carriage-return-bg: #b62324;
            --color-prettylights-syntax-carriage-return-text: #f0f6fc;
            --color-prettylights-syntax-comment: #9198a1;
            --color-prettylights-syntax-constant: #79c0ff;
            --color-prettylights-syntax-constant-other-reference-link: #a5d6ff;
            --color-prettylights-syntax-entity: #d2a8ff;
            --color-prettylights-syntax-entity-tag: #7ee787;
            --color-prettylights-syntax-invalid-illegal-bg: rgba(248, 81, 73, 0.15);
            --color-prettylights-syntax-invalid-illegal-text: #f85149;
            --color-prettylights-syntax-keyword: #ff7b72;
            --color-prettylights-syntax-markup-bold: #f0f6fc;
            --color-prettylights-syntax-markup-changed-bg: #5a1e02;
            --color-prettylights-syntax-markup-changed-text: #ffdfb6;
            --color-prettylights-syntax-markup-deleted-bg: #67060c;
            --color-prettylights-syntax-markup-deleted-text: #ffdcd7;
            --color-prettylights-syntax-markup-heading: #1f6feb;
            --color-prettylights-syntax-markup-ignored-bg: #1158c7;
            --color-prettylights-syntax-markup-ignored-text: #f0f6fc;
            --color-prettylights-syntax-markup-inserted-bg: #033a16;
            --color-prettylights-syntax-markup-inserted-text: #aff5b4;
            --color-prettylights-syntax-markup-italic: #f0f6fc;
            --color-prettylights-syntax-markup-list: #f2cc60;
            --color-prettylights-syntax-meta-diff-range: #d2a8ff;
            --color-prettylights-syntax-storage-modifier-import: #f0f6fc;
            --color-prettylights-syntax-string: #a5d6ff;
            --color-prettylights-syntax-string-regexp: #7ee787;
            --color-prettylights-syntax-sublimelinter-gutter-mark: #3d444d;
            --color-prettylights-syntax-variable: #ffa657;
            --fgColor-attention: #d29922;
            --fgColor-danger: #f85149;
            --fgColor-default: #f0f6fc;
            --fgColor-done: #ab7df8;
            --fgColor-muted: #9198a1;
            --fgColor-success: #3fb950;
            --focus-outlineColor: #1f6feb;
        }

        .markdown-preview-error {
            padding: 1rem;
            border: 1px solid var(--bs-warning, #ffc107);
            border-radius: 0.75rem;
            background: rgba(255, 193, 7, 0.12);
        }

        .pdf-preview-shell {
            overflow: auto;
            padding: 1.25rem;
            background:
                linear-gradient(180deg, rgba(0, 0, 0, 0.04), transparent 120px),
                var(--theme-bg, var(--bs-body-bg));
            color: var(--bs-body-color, inherit);
        }

        .pdf-preview-stage {
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100%;
        }

        .pdf-preview-page {
            --scale-factor: 1;
            position: relative;
            background: #fff;
            box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.16);
            user-select: text;
            -webkit-user-select: text;
        }

        .pdf-preview-canvas {
            display: block;
        }

        .pdf-preview-loading,
        .pdf-preview-error {
            min-height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
        }

        .pdf-preview-error-card {
            max-width: 520px;
            padding: 1rem 1.25rem;
            border-radius: 0.85rem;
            border: 1px solid var(--bs-warning, #ffc107);
            background: rgba(255, 193, 7, 0.12);
        }

        .pdf-text-layer {
            position: absolute;
            text-align: initial;
            inset: 0;
            overflow: hidden;
            opacity: 0.25;
            line-height: 1;
            -webkit-text-size-adjust: none;
            -moz-text-size-adjust: none;
            text-size-adjust: none;
            forced-color-adjust: none;
            transform-origin: 0 0;
            z-index: 2;
            user-select: text;
            -webkit-user-select: text;
        }

        .pdf-text-layer :is(span, br) {
            color: transparent;
            position: absolute;
            white-space: pre;
            cursor: text;
            transform-origin: 0 0;
            user-select: text;
            -webkit-user-select: text;
        }

        .pdf-text-layer span.markedContent {
            top: 0;
            height: 0;
        }

        .pdf-text-layer ::selection {
            background: AccentColor;
        }

        .pdf-text-layer ::-moz-selection {
            background: AccentColor;
        }

        .pdf-text-layer br::selection {
            background: transparent;
        }

        .pdf-text-layer br::-moz-selection {
            background: transparent;
        }

        .pdf-text-layer .endOfContent {
            display: block;
            position: absolute;
            inset: 100% 0 0;
            z-index: -1;
            cursor: default;
            user-select: none;
            -webkit-user-select: none;
        }

        .pdf-text-layer .endOfContent.active {
            top: 0;
        }

        .translation-toolbar-btn {
            min-width: 0;
        }

        .translation-fab {
            position: absolute;
            z-index: 30;
            transform: translate(-50%, calc(-100% - 10px));
            white-space: nowrap;
            box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.18);
        }

        .translation-popover {
            position: absolute;
            z-index: 31;
            display: flex;
            flex-direction: column;
            min-width: 280px;
            min-height: 220px;
            max-width: calc(100% - 24px);
            max-height: calc(100% - 24px);
            overflow: hidden;
            padding: 0.9rem;
            border-radius: 0.85rem;
            border: 1px solid var(--theme-bg-more, var(--bs-border-color, rgba(0, 0, 0, 0.08)));
            background: var(--theme-bg, var(--bs-body-bg, #fff));
            color: var(--bs-body-color, inherit);
            box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.2);
        }

        .translation-popover-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.5rem;
            margin-bottom: 0.75rem;
            user-select: none;
        }

        .translation-popover-actions {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
        }

        .translation-popover-drag-area {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            min-width: 0;
            flex: 1;
            cursor: move;
        }

        .translation-popover-drag-hint {
            font-size: 11px;
            color: var(--bs-secondary-color, rgba(0, 0, 0, 0.6));
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }

        .translation-popover-tabs {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 0.75rem;
        }

        .translation-popover-main {
            min-height: 0;
            flex: 1;
            overflow: auto;
            padding-right: 0.15rem;
        }

        .translation-popover-source {
            margin-bottom: 0.75rem;
            padding: 0.75rem;
            border-radius: 0.65rem;
            background: var(--theme-bg-less, rgba(0, 0, 0, 0.03));
            border: 1px solid var(--theme-bg-more, var(--bs-border-color, rgba(0, 0, 0, 0.06)));
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
            font-size: 12px;
            line-height: 1.55;
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 140px;
            overflow: auto;
        }

        .translation-popover-body {
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.6;
            font-size: 13px;
        }

        .translation-popover-error {
            color: var(--bs-danger, #dc3545);
        }

        .translation-ask-form {
            display: grid;
            gap: 0.5rem;
            margin-bottom: 0.75rem;
        }

        .translation-ask-config {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.75rem;
            flex-wrap: wrap;
        }

        .translation-ask-select {
            min-width: 120px;
            padding: 0.35rem 0.55rem;
            border-radius: 0.55rem;
            border: 1px solid var(--theme-bg-more, var(--bs-border-color, rgba(0, 0, 0, 0.08)));
            background: var(--bs-body-bg, #fff);
            color: inherit;
        }

        .translation-ask-select:focus {
            outline: 0;
            border-color: var(--bs-primary, #0d6efd);
            box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.15);
        }

        .translation-ask-input {
            width: 100%;
            min-height: 88px;
            padding: 0.65rem 0.75rem;
            resize: vertical;
            border-radius: 0.65rem;
            border: 1px solid var(--theme-bg-more, var(--bs-border-color, rgba(0, 0, 0, 0.08)));
            background: var(--bs-body-bg, #fff);
            color: inherit;
            line-height: 1.5;
        }

        .translation-ask-input:focus {
            outline: 0;
            border-color: var(--bs-primary, #0d6efd);
            box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.15);
        }

        .translation-ask-footnote {
            font-size: 12px;
            color: var(--bs-secondary-color, rgba(0, 0, 0, 0.6));
        }

        .translation-popover-resize-handle {
            position: absolute;
            right: 0;
            bottom: 0;
            width: 18px;
            height: 18px;
            cursor: nwse-resize;
        }

        .translation-popover-resize-handle::before {
            content: '';
            position: absolute;
            right: 4px;
            bottom: 4px;
            width: 9px;
            height: 9px;
            border-right: 2px solid var(--bs-secondary-color, rgba(0, 0, 0, 0.45));
            border-bottom: 2px solid var(--bs-secondary-color, rgba(0, 0, 0, 0.45));
            border-radius: 0 0 4px 0;
        }

        .translation-settings-backdrop {
            position: absolute;
            inset: 0;
            z-index: 40;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
            background: rgba(0, 0, 0, 0.28);
        }

        .translation-settings-card {
            width: min(520px, 100%);
            max-height: min(80vh, 720px);
            overflow: auto;
            border-radius: 1rem;
            border: 1px solid var(--theme-bg-more, var(--bs-border-color, rgba(0, 0, 0, 0.08)));
            background: var(--theme-bg, var(--bs-body-bg, #fff));
            color: var(--bs-body-color, inherit);
            box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.26);
        }

        .translation-settings-grid {
            display: grid;
            gap: 0.85rem;
        }

        .translation-settings-field {
            display: grid;
            gap: 0.35rem;
        }

        .translation-settings-field input,
        .translation-settings-field select {
            width: 100%;
            min-width: 0;
            padding: 0.55rem 0.7rem;
            border-radius: 0.55rem;
            border: 1px solid var(--theme-bg-more, var(--bs-border-color, rgba(0, 0, 0, 0.08)));
            background: var(--bs-body-bg, #fff);
            color: inherit;
        }

        .translation-settings-footnote {
            font-size: 12px;
            color: var(--bs-secondary-color, rgba(0, 0, 0, 0.6));
        }

        .pdf-page-input {
            width: 4.75rem;
            text-align: center;
        }

        :host ::ng-deep .monaco-editor,
        :host ::ng-deep .monaco-diff-editor {
            border-radius: 0 0 0.25rem 0.25rem;
        }
    `],
})
export class RemoteEditorTabComponent extends BaseTabComponent {
    // Inputs (assigned via AppService.openNewTabRaw(..., inputs))
    sshSession: any
    path: string
    name?: string
    mode?: number
    size?: number

    loading = true
    saving = false
    dirty = false
    status = 'Loading...'

    encoding = 'utf-8'
    encodings = ENCODINGS

    readOnlyLargeFile = false
    isBinary = false
    forceOpenBinary = false
    openError: string|null = null

    // When followTabbyTheme is on, darkMode is derived from Tabby's current UI colors.
    followTabbyTheme = true
    darkMode = false

    // Conflict resolution / diff view
    diffMode = false

    markdownPreview = false
    markdownPreviewHtml = ''

    translationSettings = getDefaultTranslationConfig()
    translationSettingsDraft = getDefaultTranslationConfig()
    translationSettingsVisible = false
    translationConfigError = ''

    translationButtonVisible = false
    translationButtonLabel = 'AI'
    translationButtonTop = 0
    translationButtonLeft = 0

    translationPopoverVisible = false
    translationActiveTab: TranslationPopoverTab = 'translate'
    translationPopoverTop = 0
    translationPopoverLeft = 0
    translationPopoverWidth = 360
    translationPopoverHeight = 320
    translationSelectedText = ''
    translationResult = ''
    translationError = ''
    translationLoading = false
    translationEndpointUsed = ''
    askAiQuestion = ''
    askAiResult = ''
    askAiError = ''
    askAiLoading = false
    askAiEndpointUsed = ''
    isPdf = false
    pdfLoading = false
    pdfPageLoading = false
    pdfError = ''
    pdfPageCount = 0
    pdfCurrentPage = 1
    pdfPageInput = '1'
    pdfZoom = 1
    pdfSidebarMode: PdfSidebarMode = 'files'
    pdfOutlineLoading = false
    pdfOutlineError = ''
    pdfOutlineItems: PdfOutlineItem[] = []
    pdfActiveOutlineItemId: string | null = null

    // Sidebar file tree
    sidebarVisible = true
    sidebarWidth = 200 // px
    currentDir = ''
    dirContents: SFTPFileItem[] = []
    expandedDirs: Set<string> = new Set()
    refreshingDirs: Set<string> = new Set()
    loadingDir = false
    dirLoadError: string|null = null
    editingTreeItem: SFTPFileItem | null = null
    editingTreeName = ''
    editingParentDir: string | null = null
    editingNewType: 'file' | 'folder' | null = null

    @ViewChild('editorHost', { static: true }) editorHost?: ElementRef<HTMLElement>
    @ViewChild('contentArea', { static: true }) contentArea?: ElementRef<HTMLElement>
    @ViewChild('pdfPreviewShell') pdfPreviewShell?: ElementRef<HTMLElement>
    @ViewChild('pdfCanvas') pdfCanvas?: ElementRef<HTMLCanvasElement>
    @ViewChild('pdfTextLayer') pdfTextLayer?: ElementRef<HTMLElement>
    @ViewChild('pdfPreviewPage') pdfPreviewPage?: ElementRef<HTMLElement>

    private sftp?: SFTPSession
    private editor?: import('monaco-editor').editor.IStandaloneCodeEditor
    private diffEditor?: import('monaco-editor').editor.IStandaloneDiffEditor
    private diffOriginalModel?: import('monaco-editor').editor.ITextModel
    private diffModifiedModel?: import('monaco-editor').editor.ITextModel

    private settingValue = false
    private languageId = 'plaintext'
    private themeSubscription?: { unsubscribe?: () => void }

    private loadedBuffer: Buffer|null = null
    private bomOffset = 0
    private bomBytes: Buffer|null = null
    private bomEncoding: string|null = null
    private encodingAuto = true

    // Recorded remote mtime (seconds) for conflict detection
    private remoteMtime: number|null = null

    private treeClickTimer: number|null = null
    private resizing = false
    private resizeStartX = 0
    private resizeStartWidth = 0
    private resizeMoveListener: ((e: MouseEvent) => void)|null = null
    private resizeUpListener: (() => void)|null = null
    // Avoid clashing with Tabby BaseTabComponent internals (some versions use `destroyed`/`destroyed$`).
    private componentDestroyed = false
    private editorClipboardCleanup: (() => void)|null = null
    private translationSelectionState: TranslationSelectionState | null = null
    private translationRequestAbort: AbortController | null = null
    private askAiRequestAbort: AbortController | null = null
    private translationSelectionTimer: number | null = null
    private translationUiCleanup: (() => void) | null = null
    private translationCache = new Map<string, string>()
    private askAiCache = new Map<string, string>()
    private translationPopoverManualPosition = false
    private translationPopoverDragMoveListener: ((event: MouseEvent) => void) | null = null
    private translationPopoverDragUpListener: (() => void) | null = null
    private translationPopoverResizeMoveListener: ((event: MouseEvent) => void) | null = null
    private translationPopoverResizeUpListener: (() => void) | null = null
    private translationPopoverDragStartX = 0
    private translationPopoverDragStartY = 0
    private translationPopoverDragStartLeft = 0
    private translationPopoverDragStartTop = 0
    private translationPopoverResizeStartX = 0
    private translationPopoverResizeStartY = 0
    private translationPopoverResizeStartWidth = 0
    private translationPopoverResizeStartHeight = 0
    private pdfLoadingTask: PdfLoadingTaskLike | null = null
    private pdfDocument: PdfDocumentLike | null = null
    private pdfRenderTask: PdfCancellableTaskLike | null = null
    private pdfTextLayerRenderTask: PdfCancellableTaskLike | null = null
    private pdfRenderTimer: number | null = null
    private pdfRenderToken = 0
    private pdfOutlineLoadToken = 0
    private pdfPendingDestination: PdfOutlineExplicitDestination | null = null

    constructor (
        injector: Injector,
        private app: AppService,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private themes: ThemesService,
        private cdr: ChangeDetectorRef,
    ) {
        super(injector)
        this.setTitle('Editor')
        this.icon = 'fas fa-pen-to-square'
    }

    async ngOnInit (): Promise<void> {
        this.setTitle(this.name ?? this.path ?? 'Editor')
        this.languageId = detectLanguageId(this.name ?? this.path ?? '')
        this.translationSettings = this.getStoredTranslationSettings()
        this.translationSettingsDraft = { ...this.translationSettings }

        this.followTabbyTheme = this.getStoredFollowTheme()
        if (this.followTabbyTheme) {
            this.darkMode = this.detectDarkModeFromTabby()
        } else {
            this.darkMode = this.getStoredDarkMode()
        }
        this.startFollowingTheme()

        this.sidebarVisible = this.getStoredSidebarVisible()
        this.sidebarWidth = this.clampSidebarWidth(this.getStoredSidebarWidth())
        this.currentDir = this.dirname(this.path)
        void this.loadDirectoryRoot(this.currentDir)
        this.setupTranslationUiListeners()

        await this.loadCurrentFile({ onCancel: 'close' })
    }

    ngOnDestroy (): void {
        this.componentDestroyed = true
        if (this.treeClickTimer !== null) {
            clearTimeout(this.treeClickTimer)
            this.treeClickTimer = null
        }
        if (this.resizeMoveListener) {
            document.removeEventListener('mousemove', this.resizeMoveListener)
        }
        if (this.resizeUpListener) {
            document.removeEventListener('mouseup', this.resizeUpListener)
        }
        this.resizing = false
        this.resizeMoveListener = null
        this.resizeUpListener = null

        this.themeSubscription?.unsubscribe?.()
        this.editorClipboardCleanup?.()
        this.editorClipboardCleanup = null
        this.translationUiCleanup?.()
        this.translationUiCleanup = null
        this.translationRequestAbort?.abort()
        this.translationRequestAbort = null
        this.askAiRequestAbort?.abort()
        this.askAiRequestAbort = null
        if (this.translationPopoverDragMoveListener) {
            document.removeEventListener('mousemove', this.translationPopoverDragMoveListener)
        }
        if (this.translationPopoverDragUpListener) {
            document.removeEventListener('mouseup', this.translationPopoverDragUpListener)
        }
        if (this.translationPopoverResizeMoveListener) {
            document.removeEventListener('mousemove', this.translationPopoverResizeMoveListener)
        }
        if (this.translationPopoverResizeUpListener) {
            document.removeEventListener('mouseup', this.translationPopoverResizeUpListener)
        }
        this.translationPopoverDragMoveListener = null
        this.translationPopoverDragUpListener = null
        this.translationPopoverResizeMoveListener = null
        this.translationPopoverResizeUpListener = null
        if (this.translationSelectionTimer !== null) {
            clearTimeout(this.translationSelectionTimer)
            this.translationSelectionTimer = null
        }
        this.disposePdfPreview()
        this.disposeDiffEditor()
        this.disposeEditor()
        this.sftp = undefined
        this.sshSession?.unref?.()
        super.ngOnDestroy()
    }

    toggleFollowTheme (): void {
        this.followTabbyTheme = !this.followTabbyTheme
        this.storeFollowTheme(this.followTabbyTheme)

        if (this.followTabbyTheme) {
            this.darkMode = this.detectDarkModeFromTabby()
        } else {
            this.darkMode = this.getStoredDarkMode()
        }
        this.applyTheme()
    }

    toggleDarkMode (): void {
        // Switching manually disables follow mode.
        if (this.followTabbyTheme) {
            this.followTabbyTheme = false
            this.storeFollowTheme(false)
        }

        this.darkMode = !this.darkMode
        this.storeDarkMode(this.darkMode)
        this.applyTheme()
    }

    toggleSidebar (): void {
        this.sidebarVisible = !this.sidebarVisible
        this.storeSidebarVisible(this.sidebarVisible)
    }

    showFileSidebarTree (): boolean {
        return !this.showPdfPreview() || this.pdfSidebarMode === 'files'
    }

    showPdfOutlineTree (): boolean {
        return this.showPdfPreview() && this.pdfSidebarMode === 'outline'
    }

    setPdfSidebarMode (mode: PdfSidebarMode): void {
        if (this.pdfSidebarMode === mode) {
            return
        }

        this.pdfSidebarMode = mode
        this.safeDetectChanges()
    }

    togglePdfOutlineItem (item: PdfOutlineItem): void {
        if (!item.items.length) {
            return
        }

        item.expanded = !item.expanded
        this.safeDetectChanges()
    }

    onPdfOutlineItemClick (item: PdfOutlineItem): void {
        if (item.pageNumber !== null) {
            this.goToPdfPage(item.pageNumber, item.explicitDestination)
            return
        }

        if (item.url) {
            this.openSupportedExternalLink(item.url, 'Unsupported PDF outline link')
            return
        }

        this.togglePdfOutlineItem(item)
    }

    isPdfOutlineItemActive (item: PdfOutlineItem): boolean {
        return this.pdfActiveOutlineItemId === item.id
    }

    canGoUpDirectory (): boolean {
        return this.normalizeRemotePath(this.currentDir) !== '/'
    }

    goUpDirectory (): void {
        if (!this.canGoUpDirectory() || this.loadingDir) {
            return
        }
        void this.loadDirectoryRoot(this.parentDir(this.currentDir))
    }

    refreshDirectory (): void {
        void this.refreshRootDirectory()
    }

    uploadToCurrentDirectory (): void {
        void this.uploadFilesToDirectory(this.currentDir)
    }

    downloadCurrentFile (): void {
        if (!this.path) {
            return
        }
        void this.downloadRemoteFile(this.path, this.name ?? this.path.split(/[\\/]/).pop() ?? 'download')
    }

    async refreshNode (item: SFTPFileItem): Promise<void> {
        if (!item.isDirectory) {
            return
        }

        const key = this.normalizeRemotePath(item.fullPath)
        this.refreshingDirs.add(key)
        this.safeDetectChanges()

        try {
            const newChildren = await this.loadDirectory(key)
            if (item.loaded && item.children) {
                item.children = this.mergeChildren(item.children, newChildren)
            } else {
                item.children = newChildren
            }
            item.loaded = true
            item.loadError = null
            if (!this.expandedDirs.has(key)) {
                this.expandedDirs.add(key)
            }
        } catch (e: any) {
            item.loadError = e?.message ?? 'Failed to refresh'
            this.notifications.error(item.loadError!)
        } finally {
            this.refreshingDirs.delete(key)
            this.safeDetectChanges()
        }
    }

    startResize (event: MouseEvent): void {
        if (!this.sidebarVisible) {
            return
        }

        // Prevent text selection while dragging.
        event.preventDefault()
        event.stopPropagation()

        this.resizing = true
        this.resizeStartX = event.clientX
        this.resizeStartWidth = this.sidebarWidth

        this.resizeMoveListener = (e: MouseEvent) => {
            if (!this.resizing) {
                return
            }
            const delta = e.clientX - this.resizeStartX
            this.sidebarWidth = this.clampSidebarWidth(this.resizeStartWidth + delta)
        }

        this.resizeUpListener = () => {
            if (!this.resizing) {
                return
            }
            this.resizing = false
            this.storeSidebarWidth(this.sidebarWidth)

            if (this.resizeMoveListener) {
                document.removeEventListener('mousemove', this.resizeMoveListener)
            }
            if (this.resizeUpListener) {
                document.removeEventListener('mouseup', this.resizeUpListener)
            }
            this.resizeMoveListener = null
            this.resizeUpListener = null
        }

        document.addEventListener('mousemove', this.resizeMoveListener)
        document.addEventListener('mouseup', this.resizeUpListener)
    }

    onTreeItemClick (item: SFTPFileItem): void {
        if (item.isDirectory) {
            void this.onFileClick(item, false)
            return
        }

        if (this.treeClickTimer !== null) {
            clearTimeout(this.treeClickTimer)
            this.treeClickTimer = null
        }

        this.treeClickTimer = window.setTimeout(() => {
            this.treeClickTimer = null
            void this.onFileClick(item, false)
        }, 250)
    }

    onTreeItemDoubleClick (item: SFTPFileItem): void {
        if (item.isDirectory) {
            return
        }
        if (this.treeClickTimer !== null) {
            clearTimeout(this.treeClickTimer)
            this.treeClickTimer = null
        }
        void this.onFileClick(item, true)
    }

    onTreeItemContextMenu (event: MouseEvent, item: SFTPFileItem): void {
        event.preventDefault()
        event.stopPropagation()
        this.cancelEdit()

        const menu: any[] = []

        if (item.isDirectory) {
            const expanded = this.expandedDirs.has(item.fullPath)
            menu.push({
                label: expanded ? 'Collapse' : 'Expand',
                click: () => this.toggleDirectory(item),
            })
            menu.push({
                label: 'Refresh',
                click: () => this.refreshNode(item),
            })
            menu.push({ type: 'separator' })
            menu.push({
                label: 'Upload Files Here',
                click: () => this.uploadFilesToDirectory(item.fullPath),
            })
            menu.push({ type: 'separator' })
            menu.push({
                label: 'New File',
                click: () => this.startCreate(item, 'file'),
            })
            menu.push({
                label: 'New Folder',
                click: () => this.startCreate(item, 'folder'),
            })
            menu.push({ type: 'separator' })
        } else {
            menu.push({
                label: 'Open',
                click: () => this.onFileClick(item, false),
            })
            menu.push({
                label: 'Open in New Tab',
                click: () => this.onFileClick(item, true),
            })
            menu.push({
                label: 'Reload from Remote',
                click: () => this.reloadFile(item),
                enabled: item.fullPath === this.path,
            })
            menu.push({
                label: 'Download',
                click: () => this.downloadRemoteFile(item.fullPath, item.name),
            })
            menu.push({ type: 'separator' })
        }

        menu.push({
            label: 'Copy Path',
            click: () => this.copyItemPath(item),
        })
        menu.push({ type: 'separator' })
        menu.push({
            label: 'Rename',
            click: () => this.startRename(item),
        })
        menu.push({
            label: 'Delete',
            click: () => this.deleteItem(item),
        })

        this.platform.popupContextMenu(menu, event)
    }

    onSidebarContextMenu (event: MouseEvent): void {
        event.preventDefault()
        event.stopPropagation()
        this.cancelEdit()

        this.platform.popupContextMenu([
            {
                label: 'Upload Files Here',
                click: () => this.uploadToCurrentDirectory(),
            },
            {
                label: 'Download Current File',
                click: () => this.downloadCurrentFile(),
                enabled: !!this.path,
            },
            { type: 'separator' },
            {
                label: 'New File',
                click: () => this.startCreateInCurrentDir('file'),
            },
            {
                label: 'New Folder',
                click: () => this.startCreateInCurrentDir('folder'),
            },
        ], event)
    }

    startRename (item: SFTPFileItem): void {
        this.clearEdit()
        this.editingTreeItem = item
        this.editingTreeName = item.name
        this.safeDetectChanges()
        this.focusEditInput()
    }

    startCreate (dirItem: SFTPFileItem, type: 'file' | 'folder'): void {
        this.clearEdit()
        const doCreate = (): void => {
            this.editingParentDir = dirItem.fullPath
            this.editingNewType = type
            this.editingTreeName = ''
            this.safeDetectChanges()
            this.focusEditInput()
        }

        if (!this.expandedDirs.has(dirItem.fullPath)) {
            this.toggleDirectory(dirItem).then(() => doCreate())
        } else {
            doCreate()
        }
    }

    startCreateInCurrentDir (type: 'file' | 'folder'): void {
        this.clearEdit()
        this.editingParentDir = this.currentDir
        this.editingNewType = type
        this.editingTreeName = ''
        this.safeDetectChanges()
        this.focusEditInput()
    }

    async commitEdit (): Promise<void> {
        const name = this.editingTreeName.trim()

        if (this.editingTreeItem) {
            const item = this.editingTreeItem
            this.clearEdit()
            this.safeDetectChanges()

            if (!name || name === item.name) {
                return
            }
            if (name.includes('/') || name.includes('\\')) {
                this.notifications.error('Invalid file name')
                return
            }

            const parentDir = this.parentDir(item.fullPath)
            const newPath = this.joinRemotePath(parentDir, name)

            try {
                const sftp = await this.getSftp()
                await sftp.rename(item.fullPath, newPath)

                const oldPath = item.fullPath
                item.name = name
                item.fullPath = newPath

                if (oldPath === this.path) {
                    this.path = newPath
                    this.name = name
                    this.setTitle(name)
                    this.languageId = detectLanguageId(name)
                    this.applyLanguageToEditor()
                }

                if (item.isDirectory) {
                    this.updateExpandedPathsAfterRename(oldPath, newPath)
                    if (item.children) {
                        this.updateChildPaths(item.children, oldPath, newPath)
                    }
                }

                this.safeDetectChanges()
            } catch (e: any) {
                this.notifications.error(e?.message ?? 'Rename failed')
            }
        } else if (this.editingParentDir) {
            const parentDir = this.editingParentDir
            const type = this.editingNewType
            this.clearEdit()
            this.safeDetectChanges()

            if (!name) {
                return
            }
            if (name.includes('/') || name.includes('\\')) {
                this.notifications.error('Invalid file name')
                return
            }

            const newPath = this.joinRemotePath(parentDir, name)

            try {
                const sftp: any = await this.getSftp()

                if (type === 'folder') {
                    await sftp.mkdir(newPath)
                } else {
                    const russh = getRussh()
                    const handle = await sftp.open(newPath, russh.OPEN_WRITE | russh.OPEN_CREATE)
                    await handle.close()
                }

                if (parentDir === this.currentDir) {
                    await this.refreshRootDirectory()
                } else {
                    const parentItem = this.findTreeItem(this.dirContents, parentDir)
                    if (parentItem) {
                        await this.refreshNode(parentItem)
                    }
                }

                this.safeDetectChanges()
            } catch (e: any) {
                this.notifications.error(e?.message ?? `Failed to create ${type}`)
            }
        }
    }

    cancelEdit (): void {
        this.clearEdit()
        this.safeDetectChanges()
    }

    onEditBlur (): void {
        setTimeout(() => this.commitEdit(), 100)
    }

    async deleteItem (item: SFTPFileItem): Promise<void> {
        const msg = item.isDirectory
            ? `Delete folder "${item.name}" and all its contents?`
            : `Delete "${item.name}"?`

        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: msg,
            buttons: ['Delete', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
        })

        if (result.response !== 0) {
            return
        }

        try {
            const sftp: any = await this.getSftp()
            if (item.isDirectory) {
                await this.deleteRecursive(sftp, item.fullPath)
            } else {
                await sftp.unlink(item.fullPath)
            }

            this.removeTreeItem(this.dirContents, item.fullPath)
            if (item.isDirectory) {
                this.removeExpandedRecursive(item)
            }

            if (item.fullPath === this.path) {
                this.closeTranslationPopover()
                this.openError = 'File has been deleted'
                this.status = 'Deleted'
                this.dirty = false
                this.diffMode = false
                this.disposeDiffEditor()
                this.disposeEditor()
                if (this.editorHost?.nativeElement) {
                    this.editorHost.nativeElement.innerHTML = ''
                }
            }

            this.safeDetectChanges()
        } catch (e: any) {
            this.notifications.error(e?.message ?? 'Delete failed')
        }
    }

    async reloadFile (item: SFTPFileItem): Promise<void> {
        if (item.fullPath !== this.path) {
            return
        }
        if (this.diffMode) {
            this.notifications.notice('Resolve the conflict first')
            return
        }
        if (this.loading || this.saving) {
            return
        }

        if (this.dirty) {
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: 'Discard local changes and reload from remote?',
                buttons: ['Reload', 'Cancel'],
                defaultId: 0,
                cancelId: 1,
            })
            if (result.response !== 0) {
                return
            }
        }

        this.closeTranslationPopover()
        this.loading = true
        this.status = 'Reloading...'
        this.safeDetectChanges()
        try {
            const st = await this.getRemoteStat().catch(() => ({ mtime: null, size: null }))
            this.remoteMtime = st.mtime
            if (st.size !== null) {
                this.size = st.size
            }

            const buffer = await this.readRemoteFileBuffer()
            await this.applyLoadedBuffer(buffer)
            this.dirty = false
        } catch (e: any) {
            this.status = 'Reload failed'
            this.notifications.error(e?.message ?? 'Failed to reload file')
        } finally {
            this.loading = false
            this.safeDetectChanges()
        }
    }

    copyItemPath (item: SFTPFileItem): void {
        const text = item.fullPath
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { clipboard } = require('electron')
            clipboard.writeText(text)
            this.notifications.notice('Path copied')
        } catch {
            navigator.clipboard?.writeText(text)?.then(
                () => this.notifications.notice('Path copied'),
                () => this.notifications.error('Failed to copy path'),
            )
        }
    }

    getStatusBadgeClass (): string {
        const s = (this.status ?? '').toLowerCase()

        if (s.includes('conflict')) {
            return 'bg-warning text-dark'
        }
        if (s.includes('binary')) {
            return 'bg-warning text-dark'
        }
        if (s.includes('read-only') || s.includes('readonly')) {
            return 'bg-warning text-dark'
        }
        if (s.includes('modified')) {
            return 'bg-warning text-dark'
        }
        if (s.includes('too large')) {
            return 'bg-danger'
        }
        if (s.includes('failed') || s.includes('error')) {
            return 'bg-danger'
        }
        if (s.includes('saved') || s === 'ready') {
            return 'bg-success'
        }
        if (s.includes('saving') || s.includes('checking') || s.includes('loading') || s.includes('reloading')) {
            return 'bg-info text-dark'
        }
        return 'bg-secondary'
    }

    getEncodingLabel (): string {
        const found = this.encodings.find(x => x.id === this.encoding)
        return found?.label ?? this.encoding.toUpperCase()
    }

    openTranslationSettings (): void {
        this.translationSettingsDraft = { ...this.translationSettings }
        this.translationConfigError = ''
        this.translationSettingsVisible = true
        this.safeDetectChanges()
    }

    closeTranslationSettings (): void {
        this.translationSettingsVisible = false
        this.translationConfigError = ''
        this.safeDetectChanges()
    }

    saveTranslationSettings (): void {
        const timeoutValue = Number.parseInt(`${this.translationSettingsDraft.timeoutMs ?? ''}`, 10)
        const normalized: TranslationConfig = {
            apiBaseUrl: (this.translationSettingsDraft.apiBaseUrl ?? '').trim(),
            apiKey: (this.translationSettingsDraft.apiKey ?? '').trim(),
            model: (this.translationSettingsDraft.model ?? '').trim(),
            askModel: (this.translationSettingsDraft.askModel ?? '').trim(),
            askReasoningEffort: this.normalizeAskReasoningEffort(this.translationSettingsDraft.askReasoningEffort),
            targetLanguage: (this.translationSettingsDraft.targetLanguage ?? '').trim(),
            endpointMode: (this.translationSettingsDraft.endpointMode ?? 'auto') as TranslationEndpointMode,
            timeoutMs: Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 30000,
        }

        if (!normalized.apiBaseUrl) {
            this.translationConfigError = 'API Base URL is required'
            return
        }
        if (!normalized.model) {
            this.translationConfigError = 'Translation model is required'
            return
        }
        if (!normalized.askModel) {
            this.translationConfigError = 'Ask model is required'
            return
        }
        if (!normalized.targetLanguage) {
            this.translationConfigError = 'Target language is required'
            return
        }
        if (!normalized.apiKey) {
            this.translationConfigError = 'API key is required'
            return
        }

        this.translationSettings = normalized
        this.translationSettingsDraft = { ...normalized }
        this.storeTranslationSettings(normalized)
        this.translationConfigError = ''
        this.translationSettingsVisible = false
        this.notifications.notice('AI settings saved')
        this.safeDetectChanges()
    }

    setAskReasoningEffort (value: string): void {
        const next = this.normalizeAskReasoningEffort(value, this.translationSettings.askReasoningEffort)
        if (next === this.translationSettings.askReasoningEffort) {
            return
        }

        this.translationSettings = {
            ...this.translationSettings,
            askReasoningEffort: next,
        }
        this.translationSettingsDraft = {
            ...this.translationSettingsDraft,
            askReasoningEffort: next,
        }
        this.askAiResult = ''
        this.askAiError = ''
        this.askAiEndpointUsed = ''
        this.storeTranslationSettings(this.translationSettings)
        this.safeDetectChanges()
    }

    hasConfiguredAiConnection (): boolean {
        return !!this.translationSettings.apiBaseUrl.trim() && !!this.translationSettings.apiKey.trim()
    }

    isTranslateTabActive (): boolean {
        return this.translationActiveTab === 'translate'
    }

    isAskAiTabActive (): boolean {
        return this.translationActiveTab === 'ask_ai'
    }

    setTranslationPopoverTab (tab: TranslationPopoverTab): void {
        this.translationActiveTab = tab
        this.safeDetectChanges()
    }

    getActivePopoverEndpointUsed (): string {
        const endpoint = this.translationActiveTab === 'translate'
            ? this.translationEndpointUsed
            : this.askAiEndpointUsed

        switch (endpoint) {
            case 'cache':
                return 'cache'
            case 'responses':
                return 'Responses API'
            case 'chat_completions':
                return 'Chat Completions'
            default:
                return endpoint
        }
    }

    copyActivePopoverResult (): void {
        const text = this.translationActiveTab === 'translate'
            ? this.translationResult
            : this.askAiResult
        if (!text) {
            return
        }

        this.writeClipboardText(text)
        this.notifications.notice(this.translationActiveTab === 'translate' ? 'Translation copied' : 'Answer copied')
    }

    startTranslationFromSelection (): void {
        if (!this.translationSelectionState) {
            return
        }
        this.translationActiveTab = 'translate'
        if (!this.hasConfiguredAiConnection()) {
            this.openTranslationSettings()
            return
        }

        this.openTranslationPopover()
        void this.runTranslationForCurrentSelection()
    }

    startAskAiFromSelection (): void {
        if (!this.translationSelectionState) {
            return
        }
        this.translationActiveTab = 'ask_ai'
        this.openTranslationPopover()
        if (!this.hasConfiguredAiConnection()) {
            this.openTranslationSettings()
        }
    }

    retryTranslation (): void {
        if (!this.translationSelectionState) {
            return
        }
        void this.runTranslationForCurrentSelection()
    }

    retryAskAi (): void {
        if (!this.translationSelectionState) {
            return
        }
        void this.runAskAiForCurrentSelection()
    }

    async submitAskAiQuestion (): Promise<void> {
        if (!this.translationSelectionState) {
            return
        }
        if (!this.askAiQuestion.trim()) {
            this.askAiError = 'Please enter a question'
            this.safeDetectChanges()
            return
        }
        if (!this.hasConfiguredAiConnection()) {
            this.openTranslationSettings()
            return
        }

        this.translationActiveTab = 'ask_ai'
        this.openTranslationPopover()
        await this.runAskAiForCurrentSelection()
    }

    onAskAiQuestionKeyDown (event: KeyboardEvent): void {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === 'Enter') {
            event.preventDefault()
            void this.submitAskAiQuestion()
        }
    }

    closeTranslationPopover (): void {
        this.translationPopoverVisible = false
        this.translationButtonVisible = false
        this.translationActiveTab = 'translate'
        this.translationSelectedText = ''
        this.translationResult = ''
        this.translationEndpointUsed = ''
        this.translationError = ''
        this.translationLoading = false
        this.askAiQuestion = ''
        this.askAiResult = ''
        this.askAiError = ''
        this.askAiLoading = false
        this.askAiEndpointUsed = ''
        this.translationRequestAbort?.abort()
        this.translationRequestAbort = null
        this.askAiRequestAbort?.abort()
        this.askAiRequestAbort = null
        this.translationSelectionState = null
        this.safeDetectChanges()
    }

    showMarkdownToolbar (): boolean {
        return this.languageId === 'markdown' && !this.diffMode && !this.openError && !(this.isBinary && !this.forceOpenBinary)
    }

    showMarkdownPreview (): boolean {
        return this.languageId === 'markdown' && this.markdownPreview && !this.diffMode && !this.openError && !(this.isBinary && !this.forceOpenBinary)
    }

    showPdfPreview (): boolean {
        return this.isPdf && !this.diffMode && !this.openError
    }

    showPdfToolbar (): boolean {
        return this.showPdfPreview()
    }

    shouldHideEditorHost (): boolean {
        return !!this.openError || (this.isBinary && !this.forceOpenBinary && !this.showPdfPreview()) || this.showMarkdownPreview() || this.showPdfPreview()
    }

    hasTranslationSelection (): boolean {
        return !!this.translationSelectionState?.text
    }

    getPdfZoomLabel (): string {
        return `${Math.round(this.pdfZoom * 100)}%`
    }

    isPdfBusy (): boolean {
        return this.pdfLoading || this.pdfPageLoading
    }

    setMarkdownPreview (preview: boolean): void {
        if (this.languageId !== 'markdown' || this.diffMode) {
            return
        }

        if (preview) {
            this.refreshMarkdownPreview()
        }

        if (this.markdownPreview === preview) {
            return
        }

        this.markdownPreview = preview
        this.safeDetectChanges()
        this.relayoutEditors()

        if (preview) {
            this.clearTranslationSelection('monaco')
            this.scheduleMarkdownSelectionUpdate()
        } else {
            this.clearTranslationSelection('markdown')
            this.ensureCodeEditorFocus(this.editor)
        }
    }

    onMarkdownPreviewClick (event: MouseEvent): void {
        const selectedText = window.getSelection?.()?.toString?.().trim() ?? ''
        if (selectedText) {
            return
        }

        const target = event.target as Element | null
        const anchor = target?.closest?.('a') as HTMLAnchorElement | null
        const href = (anchor?.getAttribute('href') ?? '').trim()

        if (!anchor || !href) {
            return
        }
        if (href.startsWith('#')) {
            return
        }

        event.preventDefault()
        event.stopPropagation()

        this.openSupportedExternalLink(href, 'Relative Markdown links are not supported yet')
    }

    onMarkdownPreviewMouseUp (): void {
        this.scheduleMarkdownSelectionUpdate()
    }

    onMarkdownPreviewKeyUp (): void {
        this.scheduleMarkdownSelectionUpdate()
    }

    onPdfPreviewMouseUp (): void {
        this.schedulePdfSelectionUpdate()
        this.resetPdfTextLayerSelectionHandle()
    }

    onPdfPreviewKeyUp (): void {
        this.schedulePdfSelectionUpdate()
    }

    onPdfPreviewMouseDown (event: MouseEvent): void {
        this.updatePdfTextLayerSelectionHandle(event)
    }

    onPdfPreviewCopy (event: ClipboardEvent): void {
        const selection = window.getSelection?.()
        const text = this.normalizeRawSelectionText(selection?.toString?.() ?? '')
        if (!text || !event.clipboardData) {
            return
        }

        const pdfjs = getPdfJs()
        const normalizedText = pdfjs.normalizeUnicode(text.replace(/\u0000/g, ''))
        event.clipboardData.setData('text/plain', normalizedText)
        event.preventDefault()
        event.stopPropagation()
    }

    goToPreviousPdfPage (): void {
        this.goToPdfPage(this.pdfCurrentPage - 1)
    }

    goToNextPdfPage (): void {
        this.goToPdfPage(this.pdfCurrentPage + 1)
    }

    onPdfPageInputChange (value: string): void {
        this.pdfPageInput = (value ?? '').replace(/[^\d]/g, '')
    }

    onPdfPageInputKeyDown (event: KeyboardEvent): void {
        if (event.key !== 'Enter') {
            return
        }

        event.preventDefault()
        this.goToPdfPageInput()
    }

    onPdfPageInputBlur (): void {
        if (!this.pdfPageInput.trim()) {
            this.pdfPageInput = `${this.pdfCurrentPage}`
            this.safeDetectChanges()
        }
    }

    goToPdfPageInput (): void {
        if (!this.pdfPageCount || this.isPdfBusy()) {
            return
        }

        const nextPage = Number.parseInt(this.pdfPageInput.trim(), 10)
        if (!Number.isFinite(nextPage)) {
            this.pdfPageInput = `${this.pdfCurrentPage}`
            this.safeDetectChanges()
            return
        }

        this.goToPdfPage(nextPage)
    }

    zoomOutPdf (): void {
        this.setPdfZoom(this.pdfZoom - PDF_ZOOM_STEP)
    }

    zoomInPdf (): void {
        this.setPdfZoom(this.pdfZoom + PDF_ZOOM_STEP)
    }

    resetPdfZoom (): void {
        this.setPdfZoom(1)
    }

    private buildReopenEncodingMenuItems (): any[] {
        return this.encodings.map(enc => ({
            type: 'radio',
            label: enc.label,
            checked: this.encoding === enc.id,
            click: () => this.changeEncoding(enc.id),
        }))
    }

    private buildSaveWithEncodingMenuItems (): any[] {
        return this.encodings.map(enc => ({
            type: 'radio',
            label: enc.label,
            checked: this.encoding === enc.id,
            click: () => this.saveWithEncoding(enc.id),
        }))
    }

    openEncodingMenu (event?: MouseEvent): void {
        if (this.openError || this.loading || this.saving || this.diffMode || this.showPdfPreview() || (this.isBinary && !this.forceOpenBinary)) {
            return
        }

        this.platform.popupContextMenu(this.buildReopenEncodingMenuItems(), event)
    }

    async changeEncoding (encoding: string): Promise<void> {
        if (this.diffMode || this.loading || this.saving) {
            return
        }
        if (encoding === this.encoding) {
            return
        }

        if (this.dirty) {
            const label = this.encodings.find(x => x.id === encoding)?.label ?? encoding
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: `Discard local changes and reload using ${label}?`,
                buttons: ['Reload', 'Cancel'],
                defaultId: 0,
                cancelId: 1,
            })
            if (result.response !== 0) {
                return
            }
        }

        this.encoding = encoding
        this.encodingAuto = false

        if (!this.loadedBuffer) {
            try {
                this.loadedBuffer = await this.readRemoteFileBuffer()
                this.detectAndApplyEncoding(this.loadedBuffer)
            } catch (e: any) {
                this.notifications.error(e?.message ?? 'Failed to reload file for encoding change')
                return
            }
        }

        if (this.isBinary && !this.forceOpenBinary) {
            this.status = 'Binary file'
            return
        }

        try {
            const text = this.decodeBuffer(this.loadedBuffer, this.encoding)
            this.initEditorIfNeeded()
            this.setEditorValue(text)
            this.dirty = false
            this.status = this.readOnlyLargeFile ? 'Read-only: Large file' : 'Ready'
        } catch (e: any) {
            this.notifications.error(e?.message ?? 'Failed to decode using selected encoding')
        }
    }

    async saveWithEncoding (encoding: string): Promise<boolean> {
        if (!encoding) {
            return false
        }

        const prevEncoding = this.encoding
        const prevEncodingAuto = this.encodingAuto

        this.encoding = encoding
        this.encodingAuto = false

        const saved = await this.save()
        if (!saved) {
            this.encoding = prevEncoding
            this.encodingAuto = prevEncodingAuto
        }
        return saved
    }

    closeTab (): void {
        this.destroy()
    }

    async forceOpenBinaryFile (): Promise<void> {
        if (!this.isBinary || this.forceOpenBinary) {
            return
        }

        this.closeTranslationPopover()
        this.forceOpenBinary = true
        if (!this.loadedBuffer) {
            this.loadedBuffer = await this.readRemoteFileBuffer()
            this.detectAndApplyEncoding(this.loadedBuffer)
        }

        const text = this.decodeBuffer(this.loadedBuffer, this.encoding)
        this.initEditorIfNeeded()
        this.setEditorValue(text)
        this.dirty = false
        this.status = this.readOnlyLargeFile ? 'Read-only: Large file' : 'Ready'
    }

    private clampSidebarWidth (width: number): number {
        if (!Number.isFinite(width)) {
            return 200
        }
        return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)))
    }

    private getStoredSidebarVisible (): boolean {
        try {
            const v = localStorage.getItem('tabby-mingze-online-editor.sidebarVisible')
            return v === null ? true : v === '1'
        } catch {
            return true
        }
    }

    private storeSidebarVisible (visible: boolean): void {
        try {
            localStorage.setItem('tabby-mingze-online-editor.sidebarVisible', visible ? '1' : '0')
        } catch {
            // ignore
        }
    }

    private getStoredSidebarWidth (): number {
        try {
            const v = localStorage.getItem('tabby-mingze-online-editor.sidebarWidth')
            const n = v === null ? NaN : Number.parseInt(v, 10)
            return Number.isFinite(n) ? n : 200
        } catch {
            return 200
        }
    }

    private storeSidebarWidth (width: number): void {
        try {
            localStorage.setItem('tabby-mingze-online-editor.sidebarWidth', `${this.clampSidebarWidth(width)}`)
        } catch {
            // ignore
        }
    }

    private getStoredLocalTransferDir (): string {
        try {
            return localStorage.getItem('tabby-mingze-online-editor.localTransferDir') ?? ''
        } catch {
            return ''
        }
    }

    private storeLocalTransferDir (filePath: string): void {
        const localPath = `${filePath ?? ''}`.trim()
        if (!localPath) {
            return
        }

        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const path = require('path')
            localStorage.setItem('tabby-mingze-online-editor.localTransferDir', path.dirname(localPath))
        } catch {
            // ignore
        }
    }

    private getStoredTranslationSettings (): TranslationConfig {
        const fallback = getDefaultTranslationConfig()

        try {
            const raw = localStorage.getItem('tabby-mingze-online-editor.translationSettings')
            if (!raw) {
                return fallback
            }

            const parsed = JSON.parse(raw)
            const endpointMode = ['auto', 'responses', 'chat_completions'].includes(parsed?.endpointMode)
                ? parsed.endpointMode as TranslationEndpointMode
                : fallback.endpointMode
            const timeoutMs = Number.parseInt(`${parsed?.timeoutMs ?? ''}`, 10)

            return {
                apiBaseUrl: typeof parsed?.apiBaseUrl === 'string' && parsed.apiBaseUrl.trim()
                    ? parsed.apiBaseUrl.trim()
                    : fallback.apiBaseUrl,
                apiKey: typeof parsed?.apiKey === 'string' ? parsed.apiKey : fallback.apiKey,
                model: typeof parsed?.model === 'string' && parsed.model.trim()
                    ? parsed.model.trim()
                    : fallback.model,
                askModel: typeof parsed?.askModel === 'string' && parsed.askModel.trim()
                    ? parsed.askModel.trim()
                    : fallback.askModel,
                askReasoningEffort: this.normalizeAskReasoningEffort(parsed?.askReasoningEffort, fallback.askReasoningEffort),
                targetLanguage: typeof parsed?.targetLanguage === 'string' && parsed.targetLanguage.trim()
                    ? parsed.targetLanguage.trim()
                    : fallback.targetLanguage,
                endpointMode,
                timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : fallback.timeoutMs,
            }
        } catch {
            return fallback
        }
    }

    private storeTranslationSettings (config: TranslationConfig): void {
        try {
            localStorage.setItem('tabby-mingze-online-editor.translationSettings', JSON.stringify(config))
        } catch {
            // ignore
        }
    }

    private normalizeAskReasoningEffort (value: unknown, fallback: ReasoningEffort = 'medium'): ReasoningEffort {
        const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
        return (ASK_REASONING_EFFORT_OPTIONS as string[]).includes(normalized)
            ? normalized as ReasoningEffort
            : fallback
    }

    private normalizeRemotePath (path: string): string {
        const raw = (path ?? '').toString().replace(/\\/g, '/').trim()
        if (!raw) {
            return '/'
        }
        let p = raw.replace(/\/+/g, '/')
        if (p.length > 1 && p.endsWith('/')) {
            p = p.slice(0, -1)
        }
        return p || '/'
    }

    private joinRemotePath (dirPath: string, name: string): string {
        const dir = this.normalizeRemotePath(dirPath)
        const base = (name ?? '').toString().replace(/\\/g, '/').split('/').pop() ?? ''
        if (!base) {
            return dir
        }
        if (dir === '/' || dir === '') {
            return `/${base}`.replace(/\/+/g, '/')
        }
        return `${dir}/${base}`.replace(/\/+/g, '/')
    }

    private parentDir (dirPath: string): string {
        const p = this.normalizeRemotePath(dirPath)
        if (p === '/' || !p.includes('/')) {
            return '/'
        }

        const idx = p.lastIndexOf('/')
        if (idx <= 0) {
            return '/'
        }
        return p.slice(0, idx) || '/'
    }

    private dirname (filePath: string): string {
        return this.parentDir(filePath)
    }

    private async loadDirectoryRoot (dirPath: string): Promise<void> {
        const dir = this.normalizeRemotePath(dirPath)
        this.currentDir = dir
        this.loadingDir = true
        this.dirLoadError = null
        this.safeDetectChanges()
        try {
            this.dirContents = await this.loadDirectory(dir)
            this.expandedDirs.clear()
            this.safeDetectChanges()
        } catch (e: any) {
            this.dirContents = []
            this.expandedDirs.clear()
            this.dirLoadError = e?.message ?? 'Failed to load directory'
            this.notifications.error(this.dirLoadError)
            this.safeDetectChanges()
        } finally {
            this.loadingDir = false
            this.safeDetectChanges()
        }
    }

    private async refreshRootDirectory (): Promise<void> {
        this.loadingDir = true
        this.dirLoadError = null
        this.safeDetectChanges()
        try {
            const newChildren = await this.loadDirectory(this.currentDir)
            this.dirContents = this.mergeChildren(this.dirContents, newChildren)
        } catch (e: any) {
            this.dirLoadError = e?.message ?? 'Failed to refresh'
            this.notifications.error(this.dirLoadError!)
        } finally {
            this.loadingDir = false
            this.safeDetectChanges()
        }
    }

    private mergeChildren (oldChildren: SFTPFileItem[], newChildren: SFTPFileItem[]): SFTPFileItem[] {
        const oldByPath = new Map<string, SFTPFileItem>()
        for (const child of oldChildren) {
            oldByPath.set(child.fullPath, child)
        }

        const newPaths = new Set(newChildren.filter(c => c.isDirectory).map(c => c.fullPath))
        for (const old of oldChildren) {
            if (old.isDirectory && !newPaths.has(old.fullPath)) {
                this.removeExpandedRecursive(old)
            }
        }

        return newChildren.map(item => {
            if (!item.isDirectory) {
                return item
            }
            const old = oldByPath.get(item.fullPath)
            if (old?.loaded && this.expandedDirs.has(item.fullPath)) {
                item.children = old.children
                item.loaded = true
                item.loadError = old.loadError
            }
            return item
        })
    }

    private removeExpandedRecursive (item: SFTPFileItem): void {
        this.expandedDirs.delete(item.fullPath)
        if (item.children) {
            for (const child of item.children) {
                if (child.isDirectory) {
                    this.removeExpandedRecursive(child)
                }
            }
        }
    }

    private clearEdit (): void {
        this.editingTreeItem = null
        this.editingParentDir = null
        this.editingNewType = null
        this.editingTreeName = ''
    }

    private async deleteRecursive (sftp: any, dirPath: string): Promise<void> {
        const items: any[] = await sftp.readdir(dirPath)
        for (const raw of items) {
            const name = (raw?.name ?? raw?.filename ?? '').toString()
            if (!name || name === '.' || name === '..') {
                continue
            }

            const fullPath = this.joinRemotePath(dirPath, name)
            const mode = typeof raw?.mode === 'number' ? raw.mode : 0
            const isDir = typeof raw?.isDirectory === 'boolean'
                ? raw.isDirectory
                : ((mode & 0o170000) === 0o040000)

            if (isDir) {
                await this.deleteRecursive(sftp, fullPath)
            } else {
                await sftp.unlink(fullPath)
            }
        }
        await sftp.rmdir(dirPath)
    }

    private removeTreeItem (items: SFTPFileItem[], fullPath: string): boolean {
        for (let i = 0; i < items.length; i++) {
            if (items[i].fullPath === fullPath) {
                items.splice(i, 1)
                return true
            }
            if (items[i].children && this.removeTreeItem(items[i].children!, fullPath)) {
                return true
            }
        }
        return false
    }

    private findTreeItem (items: SFTPFileItem[], fullPath: string): SFTPFileItem | null {
        for (const item of items) {
            if (item.fullPath === fullPath) {
                return item
            }
            if (item.children) {
                const found = this.findTreeItem(item.children, fullPath)
                if (found) {
                    return found
                }
            }
        }
        return null
    }

    private updateExpandedPathsAfterRename (oldPath: string, newPath: string): void {
        const toAdd: string[] = []
        const toRemove: string[] = []
        for (const p of this.expandedDirs) {
            if (p === oldPath || p.startsWith(oldPath + '/')) {
                toRemove.push(p)
                toAdd.push(newPath + p.slice(oldPath.length))
            }
        }
        for (const p of toRemove) {
            this.expandedDirs.delete(p)
        }
        for (const p of toAdd) {
            this.expandedDirs.add(p)
        }
    }

    private updateChildPaths (children: SFTPFileItem[], oldParentPath: string, newParentPath: string): void {
        for (const child of children) {
            if (child.fullPath.startsWith(oldParentPath + '/')) {
                child.fullPath = newParentPath + child.fullPath.slice(oldParentPath.length)
            }
            if (child.children) {
                this.updateChildPaths(child.children, oldParentPath, newParentPath)
            }
        }
    }

    private focusEditInput (): void {
        setTimeout(() => {
            const el = document.querySelector('.tree-edit-input') as HTMLInputElement
            if (el) {
                el.focus()
                el.select()
            }
        }, 50)
    }

    private async toggleDirectory (item: SFTPFileItem): Promise<void> {
        if (!item.isDirectory) {
            return
        }

        const key = this.normalizeRemotePath(item.fullPath)
        if (this.expandedDirs.has(key)) {
            this.expandedDirs.delete(key)
            this.safeDetectChanges()
            return
        }

        this.expandedDirs.add(key)
        this.safeDetectChanges()

        if (item.loaded) {
            return
        }

        item.loadError = null
        try {
            item.children = await this.loadDirectory(key)
            item.loaded = true
            this.safeDetectChanges()
        } catch (e: any) {
            item.loaded = false
            item.children = []
            item.loadError = e?.message ?? 'Failed to load directory'
            this.notifications.error(item.loadError)
            this.safeDetectChanges()
        }
    }

    private safeDetectChanges (): void {
        if (this.componentDestroyed) {
            return
        }
        try {
            this.cdr?.detectChanges?.()
        } catch {
            // ignore
        }
    }

    private async onFileClick (item: SFTPFileItem, newTab: boolean): Promise<void> {
        if (item.isDirectory) {
            await this.toggleDirectory(item)
            return
        }

        if (!item.fullPath) {
            return
        }

        if (newTab) {
            const sshSession: any = this.sshSession
            if (!sshSession) {
                this.notifications.error('No SSH session available')
                return
            }

            try {
                sshSession.ref?.()
                this.app.openNewTabRaw({
                    type: RemoteEditorTabComponent,
                    inputs: {
                        sshSession,
                        path: item.fullPath,
                        name: item.name,
                        mode: item.mode,
                        size: item.size,
                    },
                })
            } catch (e: any) {
                sshSession.unref?.()
                this.notifications.error(e?.message ?? 'Failed to open editor tab')
            }
            return
        }

        if (item.fullPath === this.path) {
            return
        }

        if (this.diffMode) {
            this.notifications.notice('Resolve the conflict first')
            return
        }

        if (this.dirty) {
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: 'Save changes before switching?',
                buttons: ['Save', 'Discard', 'Cancel'],
                defaultId: 0,
                cancelId: 2,
            })

            if (result.response === 2) {
                return
            }
            if (result.response === 0) {
                const saved = await this.save()
                if (!saved) {
                    return
                }
            }
        }

        const prev = {
            path: this.path,
            name: this.name,
            mode: this.mode,
            size: this.size,
            title: this.title,
            languageId: this.languageId,
            encoding: this.encoding,
            encodingAuto: this.encodingAuto,
            loadedBuffer: this.loadedBuffer,
            remoteMtime: this.remoteMtime,
            readOnlyLargeFile: this.readOnlyLargeFile,
            isBinary: this.isBinary,
            forceOpenBinary: this.forceOpenBinary,
            openError: this.openError,
            status: this.status,
            dirty: this.dirty,
            bomOffset: this.bomOffset,
            bomBytes: this.bomBytes,
            bomEncoding: this.bomEncoding,
        }

        this.path = item.fullPath
        this.name = item.name
        this.mode = item.mode
        this.size = item.size
        this.setTitle(item.name ?? item.fullPath)

        this.languageId = detectLanguageId(item.name ?? item.fullPath)
        this.encodingAuto = true
        this.encoding = 'utf-8'
        this.loadedBuffer = null
        this.remoteMtime = null

        const ok = await this.loadCurrentFile({ onCancel: 'keep' })
        if (!ok) {
            // User cancelled opening (large file warning); revert to previous file.
            this.path = prev.path
            this.name = prev.name
            this.mode = prev.mode
            this.size = prev.size
            this.setTitle(prev.title ?? prev.name ?? prev.path)

            this.languageId = prev.languageId
            this.encoding = prev.encoding
            this.encodingAuto = prev.encodingAuto
            this.loadedBuffer = prev.loadedBuffer
            this.remoteMtime = prev.remoteMtime
            this.readOnlyLargeFile = prev.readOnlyLargeFile
            this.isBinary = prev.isBinary
            this.forceOpenBinary = prev.forceOpenBinary
            this.openError = prev.openError
            this.status = prev.status
            this.dirty = prev.dirty
            this.bomOffset = prev.bomOffset
            this.bomBytes = prev.bomBytes
            this.bomEncoding = prev.bomEncoding
        }
    }

    private async uploadFilesToDirectory (dirPath: string): Promise<void> {
        if (this.saving || this.loading) {
            this.notifications.notice('Wait for the current file action to finish')
            return
        }

        const targetDir = this.normalizeRemotePath(dirPath)

        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const fs = require('fs')
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const path = require('path')

            const localPaths = await this.pickLocalFilesForUpload(targetDir)
            if (!localPaths.length) {
                return
            }

            const uploads: Array<{
                localPath: string
                name: string
                remotePath: string
                existingMode: number|null
                wasExisting: boolean
            }> = []

            for (const localPath of localPaths) {
                const name = path.basename(localPath)
                const remotePath = this.joinRemotePath(targetDir, name)
                const remoteStat = await this.getRemotePathStat(remotePath)

                if (remoteStat?.isDirectory) {
                    throw new Error(`"${name}" already exists as a folder on the remote host`)
                }

                uploads.push({
                    localPath,
                    name,
                    remotePath,
                    existingMode: remoteStat?.mode ?? null,
                    wasExisting: !!remoteStat,
                })
            }

            const touchesCurrentFile = uploads.some(upload => upload.remotePath === this.path)
            if (touchesCurrentFile && this.diffMode) {
                this.notifications.notice('Resolve the conflict first')
                return
            }

            if (touchesCurrentFile && this.dirty) {
                const result = await this.platform.showMessageBox({
                    type: 'warning',
                    message: 'Uploading will overwrite the currently open file and discard unsaved changes.',
                    buttons: ['Upload', 'Cancel'],
                    defaultId: 1,
                    cancelId: 1,
                })

                if (result.response !== 0) {
                    return
                }
            }

            const existingNames = uploads.filter(upload => upload.wasExisting).map(upload => upload.name)
            if (existingNames.length) {
                const listedNames = existingNames.slice(0, 3).join(', ')
                const extraCount = existingNames.length - Math.min(existingNames.length, 3)
                const detail = extraCount > 0 ? `${listedNames} and ${extraCount} more` : listedNames
                const result = await this.platform.showMessageBox({
                    type: 'warning',
                    message: `Overwrite ${existingNames.length} existing remote file${existingNames.length === 1 ? '' : 's'}?`,
                    detail,
                    buttons: ['Overwrite', 'Cancel'],
                    defaultId: 1,
                    cancelId: 1,
                })

                if (result.response !== 0) {
                    return
                }
            }

            let currentFileBuffer: Buffer|null = null
            let successCount = 0
            const failures: string[] = []

            for (const upload of uploads) {
                try {
                    const buffer = Buffer.from(await fs.promises.readFile(upload.localPath))
                    await this.writeRemoteFileBufferAt(upload.remotePath, buffer, upload.existingMode)
                    successCount++
                    if (upload.remotePath === this.path) {
                        currentFileBuffer = buffer
                    }
                } catch (e: any) {
                    failures.push(`${upload.name}: ${e?.message ?? 'Upload failed'}`)
                }
            }

            if (successCount > 0) {
                await this.refreshDirectoryBranch(targetDir)
                if (currentFileBuffer) {
                    await this.reloadOpenFileAfterUpload(currentFileBuffer)
                }
            }

            if (!failures.length) {
                this.notifications.notice(`Uploaded ${successCount} file${successCount === 1 ? '' : 's'}`)
                return
            }

            const preview = failures.slice(0, 2).join('; ')
            const suffix = failures.length > 2 ? `; +${failures.length - 2} more` : ''
            if (successCount > 0) {
                this.notifications.error(`Uploaded ${successCount} file${successCount === 1 ? '' : 's'}, but some uploads failed: ${preview}${suffix}`)
            } else {
                this.notifications.error(preview + suffix)
            }
        } catch (e: any) {
            this.notifications.error(e?.message ?? 'Upload failed')
        }
    }

    private async downloadRemoteFile (remotePath: string, suggestedName: string): Promise<void> {
        const normalizedPath = this.normalizeRemotePath(remotePath)

        try {
            const localPath = await this.pickLocalPathForDownload(normalizedPath, suggestedName)
            if (!localPath) {
                return
            }

            await this.copyRemoteFileToLocal(normalizedPath, localPath)
            this.notifications.notice(`Downloaded ${suggestedName}`)
        } catch (e: any) {
            this.notifications.error(e?.message ?? 'Download failed')
        }
    }

    private async refreshDirectoryBranch (dirPath: string): Promise<void> {
        const targetDir = this.normalizeRemotePath(dirPath)
        if (targetDir === this.currentDir) {
            await this.refreshRootDirectory()
            return
        }

        const item = this.findTreeItem(this.dirContents, targetDir)
        if (item) {
            await this.refreshNode(item)
        }
    }

    private async reloadOpenFileAfterUpload (buffer: Buffer): Promise<void> {
        this.closeTranslationPopover()
        this.loading = true
        this.openError = null
        this.diffMode = false
        this.disposeDiffEditor()

        try {
            const stat = await this.getRemoteStat().catch(() => ({ mtime: null, size: buffer.length }))
            const fileSize = stat.size ?? buffer.length

            this.remoteMtime = stat.mtime
            this.size = fileSize
            this.readOnlyLargeFile = fileSize > LARGE_FILE_READONLY_SIZE
            this.forceOpenBinary = false
            this.dirty = false

            if (fileSize > LARGE_FILE_REJECT_SIZE) {
                this.disposePdfPreview()
                this.openError = `This file is too large to open (${formatBytes(fileSize)})`
                this.status = 'Too large'
                this.loadedBuffer = buffer
                return
            }

            await this.applyLoadedBuffer(buffer)
            this.dirty = false
        } catch (e: any) {
            this.status = 'Reload failed'
            this.notifications.error(e?.message ?? 'Failed to reload uploaded file')
        } finally {
            this.loading = false
            this.safeDetectChanges()
        }
    }

    private async copyRemoteFileToLocal (remotePath: string, localPath: string): Promise<void> {
        const sftp: any = await this.getSftp()
        const russh = getRussh()
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs')

        const tempPath = `${localPath}.tabby-online-editor-download`
        const handle = await sftp.open(remotePath, russh.OPEN_READ)
        let localHandle: any = null

        try {
            localHandle = await fs.promises.open(tempPath, 'w')

            while (true) {
                const chunk = await handle.read()
                if (!chunk.length) {
                    break
                }

                const buffer = Buffer.from(chunk)
                await localHandle.write(buffer, 0, buffer.length, null)
            }

            await localHandle.close()
            localHandle = null
            await fs.promises.unlink(localPath).catch(() => null)
            await fs.promises.rename(tempPath, localPath)
        } catch (e) {
            await localHandle?.close?.().catch(() => null)
            await fs.promises.unlink(tempPath).catch(() => null)
            throw e
        } finally {
            await handle.close().catch(() => null)
        }
    }

    private async loadDirectory (dirPath: string): Promise<SFTPFileItem[]> {
        const sftp: any = await this.getSftp()
        if (!sftp?.readdir) {
            throw new Error('SFTP directory listing is not available')
        }

        const dir = this.normalizeRemotePath(dirPath)
        const items: any[] = await sftp.readdir(dir)

        return (items ?? [])
            .map((item: any) => {
                const name = (item?.name ?? item?.filename ?? '').toString()
                if (!name || name === '.' || name === '..') {
                    return null
                }

                const mode = typeof item?.mode === 'number' ? item.mode : 0
                const isSymlink = ((mode & 0o170000) === 0o120000) // POSIX S_IFLNK
                const isDirectory =
                    typeof item?.isDirectory === 'boolean'
                        ? item.isDirectory
                        : ((mode & 0o170000) === 0o040000) // POSIX S_IFDIR

                const size = typeof item?.size === 'number' ? item.size : 0

                const fullPath = this.joinRemotePath(dir, name)
                const out: SFTPFileItem = { name, fullPath, isDirectory, isSymlink, mode, size }
                if (isDirectory) {
                    out.loaded = false
                    out.loadError = null
                }
                return out
            })
            .filter(Boolean)
            .sort((a: any, b: any) => {
                if (a.isDirectory !== b.isDirectory) {
                    return a.isDirectory ? -1 : 1
                }
                return a.name.localeCompare(b.name)
            }) as SFTPFileItem[]
    }

    private async applyLoadedBuffer (buffer: Buffer): Promise<void> {
        this.loadedBuffer = buffer
        this.isPdf = isPdfPreviewableFile(buffer, this.name ?? this.path ?? '')
        this.isBinary = isBinaryContent(buffer)

        if (this.isPdf) {
            await this.loadPdfPreview(buffer)
            return
        }

        this.disposePdfPreview()

        if (this.isBinary && !this.forceOpenBinary) {
            this.status = 'Binary file'
            return
        }

        this.detectAndApplyEncoding(buffer)
        const text = this.decodeBuffer(buffer, this.encoding)
        this.initEditorIfNeeded()
        this.applyLanguageToEditor()
        this.setEditorValue(text)
        this.status = this.readOnlyLargeFile ? 'Read-only: Large file' : 'Ready'
    }

    private async loadPdfPreview (buffer: Buffer): Promise<void> {
        this.disposePdfPreview()
        this.isPdf = true
        this.pdfLoading = true
        this.pdfPageLoading = false
        this.pdfError = ''
        this.pdfPageCount = 0
        this.pdfCurrentPage = 1
        this.pdfPageInput = '1'
        this.pdfZoom = 1
        this.resetPdfOutlineState()
        this.status = 'Loading PDF...'
        this.safeDetectChanges()

        let loadingTask: PdfLoadingTaskLike | null = null
        try {
            const pdfjs = getPdfJs()
            loadingTask = pdfjs.getDocument({
                data: new Uint8Array(buffer),
                useWorkerFetch: false,
            })

            this.pdfLoadingTask = loadingTask
            const documentProxy = await loadingTask.promise
            if (this.pdfLoadingTask !== loadingTask) {
                return
            }

            this.pdfDocument = documentProxy
            this.pdfPageCount = documentProxy?.numPages ?? 0
            if (!this.pdfPageCount) {
                this.pdfError = 'PDF has no pages to preview'
                this.status = 'PDF preview failed'
                return
            }

            const outlineLoadToken = ++this.pdfOutlineLoadToken
            this.pdfOutlineLoading = true
            this.updatePdfStatus()
            this.safeDetectChanges()
            this.schedulePdfRender()
            void this.loadPdfOutline(documentProxy, outlineLoadToken)
        } catch (error: any) {
            if (!this.isPdf || this.pdfLoadingTask !== loadingTask) {
                return
            }
            this.pdfError = error?.message ?? 'Failed to load PDF preview'
            this.status = 'PDF preview failed'
        } finally {
            if (this.isPdf && this.pdfLoadingTask === loadingTask) {
                this.pdfLoading = false
                this.safeDetectChanges()
            }
        }
    }

    private schedulePdfRender (): void {
        if (this.pdfRenderTimer !== null) {
            clearTimeout(this.pdfRenderTimer)
        }

        this.pdfRenderTimer = window.setTimeout(() => {
            this.pdfRenderTimer = null
            void this.renderCurrentPdfPage()
        }, 0)
    }

    private resetPdfOutlineState (): void {
        this.pdfSidebarMode = 'files'
        this.pdfOutlineLoading = false
        this.pdfOutlineError = ''
        this.pdfOutlineItems = []
        this.pdfActiveOutlineItemId = null
    }

    private isPdfOutlineLoadActive (documentProxy: PdfDocumentLike, loadToken: number): boolean {
        return this.isPdf && this.pdfDocument === documentProxy && this.pdfOutlineLoadToken === loadToken
    }

    private async loadPdfOutline (documentProxy: PdfDocumentLike, loadToken: number): Promise<void> {
        this.pdfOutlineError = ''
        this.pdfOutlineItems = []
        this.pdfActiveOutlineItemId = null
        this.safeDetectChanges()

        try {
            const outline = await documentProxy.getOutline()
            if (!this.isPdfOutlineLoadActive(documentProxy, loadToken)) {
                return
            }

            const items = Array.isArray(outline)
                ? await this.buildPdfOutlineItems(documentProxy, outline, 'outline')
                : []
            if (!this.isPdfOutlineLoadActive(documentProxy, loadToken)) {
                return
            }

            this.pdfOutlineItems = items
            this.updateActivePdfOutlineItem()
        } catch (error) {
            if (!this.isPdfOutlineLoadActive(documentProxy, loadToken)) {
                return
            }

            this.pdfOutlineItems = []
            this.pdfActiveOutlineItemId = null
            this.pdfOutlineError =
                typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
                    ? error.message
                    : 'Failed to load PDF outline'
        } finally {
            if (!this.isPdfOutlineLoadActive(documentProxy, loadToken)) {
                return
            }

            this.pdfOutlineLoading = false
            this.safeDetectChanges()
        }
    }

    private async buildPdfOutlineItems (
        documentProxy: PdfDocumentLike,
        sourceItems: PdfOutlineSourceItem[],
        idPrefix: string,
    ): Promise<PdfOutlineItem[]> {
        return Promise.all(sourceItems.map(async (sourceItem, index) => {
            const itemId = `${idPrefix}-${index}`
            const items = Array.isArray(sourceItem.items)
                ? await this.buildPdfOutlineItems(documentProxy, sourceItem.items, itemId)
                : []
            const target = await this.resolvePdfOutlineTarget(documentProxy, sourceItem.dest)
            const url = typeof sourceItem.url === 'string' && sourceItem.url.trim() ? sourceItem.url.trim() : null

            return {
                id: itemId,
                title: this.normalizePdfOutlineTitle(sourceItem.title),
                pageNumber: target.pageNumber,
                explicitDestination: target.explicitDestination,
                url,
                items,
                expanded: items.length > 0,
                clickable: target.pageNumber !== null || !!url,
            }
        }))
    }

    private async resolvePdfOutlineTarget (
        documentProxy: PdfDocumentLike,
        destination: PdfOutlineDestination | undefined,
    ): Promise<PdfOutlineResolvedTarget> {
        try {
            let explicitDestination: PdfOutlineExplicitDestination | null = null
            if (typeof destination === 'string') {
                explicitDestination = await documentProxy.getDestination(destination)
            } else if (Array.isArray(destination) && destination.length > 0) {
                explicitDestination = destination
            }

            if (!explicitDestination?.length) {
                return {
                    explicitDestination: null,
                    pageNumber: null,
                }
            }

            const target = explicitDestination[0]
            if (typeof target === 'number') {
                return {
                    explicitDestination,
                    pageNumber: this.normalizePdfOutlinePageNumber(target + 1),
                }
            }
            if (!this.isPdfPageReference(target)) {
                return {
                    explicitDestination,
                    pageNumber: null,
                }
            }

            const cachedPageNumber = documentProxy.cachedPageNumber?.(target)
            if (typeof cachedPageNumber === 'number' && Number.isFinite(cachedPageNumber)) {
                return {
                    explicitDestination,
                    pageNumber: this.normalizePdfOutlinePageNumber(cachedPageNumber),
                }
            }

            const pageIndex = await documentProxy.getPageIndex(target)
            return {
                explicitDestination,
                pageNumber: this.normalizePdfOutlinePageNumber(pageIndex + 1),
            }
        } catch {
            return {
                explicitDestination: null,
                pageNumber: null,
            }
        }
    }

    private isPdfPageReference (value: unknown): value is PdfPageReference {
        if (!value || typeof value !== 'object') {
            return false
        }

        const candidate = value as { num?: unknown, gen?: unknown }
        return typeof candidate.num === 'number' && typeof candidate.gen === 'number'
    }

    private normalizePdfOutlinePageNumber (pageNumber: number): number | null {
        if (!Number.isFinite(pageNumber)) {
            return null
        }

        const normalized = Math.round(pageNumber)
        if (normalized < 1 || (this.pdfPageCount > 0 && normalized > this.pdfPageCount)) {
            return null
        }
        return normalized
    }

    private normalizePdfOutlineTitle (title: string | null | undefined): string {
        const normalized = `${title ?? ''}`.replace(/\s+/g, ' ').trim()
        return normalized || 'Untitled'
    }

    private updateActivePdfOutlineItem (): void {
        let activeItemId: string | null = null
        this.walkPdfOutlineItems(this.pdfOutlineItems, item => {
            if (item.pageNumber !== null && item.pageNumber <= this.pdfCurrentPage) {
                activeItemId = item.id
            }
        })
        this.pdfActiveOutlineItemId = activeItemId
    }

    private walkPdfOutlineItems (items: PdfOutlineItem[], visit: (item: PdfOutlineItem) => void): void {
        for (const item of items) {
            visit(item)
            if (item.items.length) {
                this.walkPdfOutlineItems(item.items, visit)
            }
        }
    }

    private applyPendingPdfDestinationScroll (viewport: PdfViewportLike): void {
        const destination = this.pdfPendingDestination
        if (!destination) {
            return
        }

        if (this.scrollPdfPreviewToDestination(destination, viewport)) {
            this.pdfPendingDestination = null
        }
    }

    private async scrollToPendingPdfDestination (): Promise<void> {
        const destination = this.pdfPendingDestination
        if (!destination || !this.pdfDocument || !this.showPdfPreview()) {
            return
        }

        try {
            const page = await this.pdfDocument.getPage(this.pdfCurrentPage)
            if (!this.showPdfPreview() || !this.pdfDocument || destination !== this.pdfPendingDestination) {
                return
            }

            const viewport = page.getViewport({
                scale: this.pdfZoom * PDF_CSS_UNITS,
            })
            if (this.scrollPdfPreviewToDestination(destination, viewport)) {
                this.pdfPendingDestination = null
            }
        } catch {
            if (destination === this.pdfPendingDestination) {
                this.pdfPendingDestination = null
            }
        }
    }

    private scrollPdfPreviewToDestination (destination: PdfOutlineExplicitDestination, viewport: PdfViewportLike): boolean {
        const shell = this.pdfPreviewShell?.nativeElement
        const pageHost = this.pdfPreviewPage?.nativeElement
        if (!shell || !pageHost) {
            return false
        }

        const offset = this.getPdfDestinationViewportOffset(destination, viewport)
        if (!offset) {
            return true
        }

        const left = Math.max(0, pageHost.offsetLeft + offset.left)
        const top = Math.max(0, pageHost.offsetTop + offset.top)
        if (typeof shell.scrollTo === 'function') {
            shell.scrollTo({ left, top, behavior: 'auto' })
        } else {
            shell.scrollLeft = left
            shell.scrollTop = top
        }
        return true
    }

    private getPdfDestinationViewportOffset (
        destination: PdfOutlineExplicitDestination,
        viewport: PdfViewportLike,
    ): PdfOutlineViewportOffset | null {
        if (destination.length < 2 || typeof destination[1] !== 'object' || destination[1] === null) {
            return { left: 0, top: 0 }
        }

        const destinationConfig = destination[1] as PdfOutlineDestinationConfig
        const pageWidth = viewport.width / viewport.scale / PDF_CSS_UNITS
        const pageHeight = viewport.height / viewport.scale / PDF_CSS_UNITS
        const destinationName = destinationConfig.name ?? ''
        let x = 0
        let y = 0
        let width = 0
        let height = 0

        switch (destinationName) {
            case 'XYZ':
                x = typeof destination[2] === 'number' ? destination[2] : 0
                y = typeof destination[3] === 'number' ? destination[3] : pageHeight
                break
            case 'Fit':
            case 'FitB':
                break
            case 'FitH':
            case 'FitBH':
                y = typeof destination[2] === 'number' && destination[2] >= 0 ? destination[2] : pageHeight
                break
            case 'FitV':
            case 'FitBV':
                x = typeof destination[2] === 'number' ? destination[2] : 0
                width = pageWidth
                height = pageHeight
                break
            case 'FitR': {
                const left = typeof destination[2] === 'number' ? destination[2] : 0
                const top = typeof destination[3] === 'number' ? destination[3] : pageHeight
                const right = typeof destination[4] === 'number' ? destination[4] : left
                const bottom = typeof destination[5] === 'number' ? destination[5] : top
                x = left
                y = top
                width = right - left
                height = bottom - top
                break
            }
            default:
                return { left: 0, top: 0 }
        }

        const topLeft = viewport.convertToViewportPoint(x, y)
        const bottomRight = viewport.convertToViewportPoint(x + width, y + height)
        return {
            left: Math.max(0, Math.min(topLeft[0], bottomRight[0])),
            top: Math.max(0, Math.min(topLeft[1], bottomRight[1])),
        }
    }

    private async renderCurrentPdfPage (): Promise<void> {
        if (!this.showPdfPreview() || !this.pdfDocument) {
            return
        }

        const canvas = this.pdfCanvas?.nativeElement
        const textLayer = this.pdfTextLayer?.nativeElement
        const pageHost = this.pdfPreviewPage?.nativeElement
        if (!canvas || !textLayer || !pageHost) {
            this.schedulePdfRender()
            return
        }

        this.cancelPdfRender()
        const renderToken = ++this.pdfRenderToken
        this.pdfError = ''
        this.pdfPageLoading = true
        this.safeDetectChanges()

        try {
            const pdfjs = getPdfJs()
            const page = await this.pdfDocument.getPage(this.pdfCurrentPage)
            if (renderToken !== this.pdfRenderToken) {
                return
            }

            const viewport = page.getViewport({
                scale: this.pdfZoom * PDF_CSS_UNITS,
            })
            const outputScale = window.devicePixelRatio || 1
            const context = canvas.getContext('2d', { alpha: false })
            if (!context) {
                throw new Error('Canvas context is not available for PDF preview')
            }

            canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
            canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
            canvas.style.width = `${viewport.width}px`
            canvas.style.height = `${viewport.height}px`
            textLayer.innerHTML = ''
            textLayer.style.width = `${viewport.width}px`
            textLayer.style.height = `${viewport.height}px`
            textLayer.style.setProperty('--scale-factor', `${viewport.scale}`)
            pageHost.style.width = `${viewport.width}px`
            pageHost.style.height = `${viewport.height}px`
            pageHost.style.setProperty('--scale-factor', `${viewport.scale}`)

            const renderTask = page.render({
                canvasContext: context,
                viewport,
                transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
            })
            this.pdfRenderTask = renderTask
            await renderTask.promise
            if (renderToken !== this.pdfRenderToken) {
                return
            }

            const textDivs: HTMLElement[] = []
            const textDivProperties = new WeakMap<HTMLElement, object>()
            const textLayerTask = pdfjs.renderTextLayer({
                textContentSource: page.streamTextContent({
                    includeMarkedContent: true,
                    disableNormalization: true,
                }),
                container: textLayer,
                viewport,
                textDivs,
                textDivProperties,
                textContentItemsStr: [],
                isOffscreenCanvasSupported: true,
            })
            this.pdfTextLayerRenderTask = textLayerTask
            await textLayerTask.promise
            if (renderToken !== this.pdfRenderToken) {
                return
            }

            this.applyPdfTextLayerInlineStyles(textLayer, textDivs)
            this.ensurePdfTextLayerSelectionTail(textLayer)
            this.applyPendingPdfDestinationScroll(viewport)
        } catch (error: any) {
            const message = `${error?.message ?? ''}`.toLowerCase()
            const cancelled = renderToken !== this.pdfRenderToken || message.includes('cancel')
            if (!cancelled) {
                this.pdfError = error?.message ?? 'Failed to render PDF page'
                this.status = 'PDF preview failed'
            }
        } finally {
            if (renderToken === this.pdfRenderToken) {
                this.pdfPageLoading = false
                this.safeDetectChanges()
            }
        }
    }

    private cancelPdfRender (): void {
        this.pdfRenderTask?.cancel?.()
        this.pdfTextLayerRenderTask?.cancel?.()
        this.pdfRenderTask = null
        this.pdfTextLayerRenderTask = null
        this.resetPdfTextLayerSelectionHandle()
    }

    private ensurePdfTextLayerSelectionTail (textLayer: HTMLElement): void {
        if (textLayer.querySelector('.endOfContent')) {
            return
        }

        const endOfContent = document.createElement('div')
        endOfContent.className = 'endOfContent'
        textLayer.append(endOfContent)
    }

    private applyPdfTextLayerInlineStyles (textLayer: HTMLElement, textDivs: HTMLElement[]): void {
        textLayer.style.position = 'absolute'
        textLayer.style.inset = '0'
        textLayer.style.overflow = 'hidden'
        textLayer.style.opacity = '0.25'
        textLayer.style.lineHeight = '1'
        textLayer.style.transformOrigin = '0 0'
        textLayer.style.zIndex = '2'
        textLayer.style.userSelect = 'text'
        ;(textLayer.style as any).webkitUserSelect = 'text'

        for (const textDiv of textDivs) {
            textDiv.style.color = 'transparent'
            textDiv.style.position = 'absolute'
            textDiv.style.whiteSpace = 'pre'
            textDiv.style.cursor = 'text'
            textDiv.style.transformOrigin = '0 0'
            textDiv.style.userSelect = 'text'
            ;(textDiv.style as any).webkitUserSelect = 'text'
        }

        const markedContentDivs = textLayer.querySelectorAll('span.markedContent')
        for (const markedContentDiv of Array.from(markedContentDivs)) {
            const el = markedContentDiv as HTMLElement
            el.style.top = '0'
            el.style.height = '0'
        }

        const lineBreaks = textLayer.querySelectorAll('br')
        for (const lineBreak of Array.from(lineBreaks)) {
            const el = lineBreak as HTMLElement
            el.style.position = 'absolute'
            el.style.whiteSpace = 'pre'
            el.style.cursor = 'text'
            el.style.transformOrigin = '0 0'
        }
    }

    private updatePdfTextLayerSelectionHandle (event: MouseEvent): void {
        const textLayer = this.pdfTextLayer?.nativeElement
        const endOfContent = textLayer?.querySelector('.endOfContent') as HTMLElement | null
        if (!textLayer || !endOfContent) {
            return
        }

        let adjustTop = event.target !== textLayer
        if (adjustTop) {
            const userSelect = getComputedStyle(endOfContent).getPropertyValue('-moz-user-select')
            adjustTop = userSelect !== 'none'
        }

        if (adjustTop) {
            const bounds = textLayer.getBoundingClientRect()
            const ratio = bounds.height ? Math.max(0, (event.clientY - bounds.top) / bounds.height) : 0
            endOfContent.style.top = `${(ratio * 100).toFixed(2)}%`
        }

        endOfContent.classList.add('active')
    }

    private resetPdfTextLayerSelectionHandle (): void {
        const textLayer = this.pdfTextLayer?.nativeElement
        const endOfContent = textLayer?.querySelector('.endOfContent') as HTMLElement | null
        if (!endOfContent) {
            return
        }

        endOfContent.style.top = ''
        endOfContent.classList.remove('active')
    }

    private disposePdfPreview (): void {
        if (this.pdfRenderTimer !== null) {
            clearTimeout(this.pdfRenderTimer)
            this.pdfRenderTimer = null
        }

        this.cancelPdfRender()
        this.pdfRenderToken++
        this.pdfOutlineLoadToken++
        this.pdfPendingDestination = null
        this.resetPdfOutlineState()

        try {
            this.pdfLoadingTask?.destroy?.()
        } catch {
            // ignore
        }
        try {
            this.pdfDocument?.cleanup?.()
        } catch {
            // ignore
        }
        try {
            this.pdfDocument?.destroy?.()
        } catch {
            // ignore
        }

        this.pdfLoadingTask = null
        this.pdfDocument = null
        this.pdfLoading = false
        this.pdfPageLoading = false
        this.pdfError = ''
        this.pdfPageCount = 0
        this.pdfCurrentPage = 1
        this.pdfPageInput = '1'
        this.pdfZoom = 1
        this.isPdf = false
    }

    private setPdfZoom (nextZoom: number): void {
        const normalized = Math.round(clampNumber(nextZoom, PDF_MIN_ZOOM, PDF_MAX_ZOOM) * 100) / 100
        if (normalized === this.pdfZoom || this.isPdfBusy()) {
            return
        }

        this.clearTranslationSelection('pdf')
        this.pdfZoom = normalized
        this.safeDetectChanges()
        this.schedulePdfRender()
    }

    private updatePdfStatus (): void {
        if (!this.isPdf) {
            return
        }

        if (this.pdfError) {
            this.status = 'PDF preview failed'
            return
        }

        if (!this.pdfPageCount) {
            this.status = 'Loading PDF...'
            this.pdfPageInput = '1'
            return
        }

        this.pdfPageInput = `${this.pdfCurrentPage}`
        this.status = `PDF ${this.pdfCurrentPage}/${this.pdfPageCount}`
    }

    private goToPdfPage (page: number, destination: PdfOutlineExplicitDestination | null = null): void {
        if (!this.pdfPageCount || this.isPdfBusy() || !Number.isFinite(page)) {
            return
        }

        this.pdfPendingDestination = destination?.length ? destination : null
        const nextPage = Math.round(clampNumber(page, 1, this.pdfPageCount))
        this.pdfPageInput = `${nextPage}`
        if (nextPage === this.pdfCurrentPage) {
            this.updateActivePdfOutlineItem()
            this.updatePdfStatus()
            this.safeDetectChanges()
            void this.scrollToPendingPdfDestination()
            return
        }

        this.clearTranslationSelection('pdf')
        this.pdfCurrentPage = nextPage
        this.updateActivePdfOutlineItem()
        this.updatePdfStatus()
        this.safeDetectChanges()
        this.schedulePdfRender()
    }

    private async loadCurrentFile (opts: { onCancel: 'close'|'keep' }): Promise<boolean> {
        this.status = 'Loading...'
        try {
            this.loading = true
            this.closeTranslationPopover()
            this.openError = null
            this.isBinary = false
            this.forceOpenBinary = false
            this.readOnlyLargeFile = false
            this.dirty = false

            const st = await this.getRemoteStat().catch(() => ({ mtime: null, size: null }))
            this.remoteMtime = st.mtime

            const fileSize = (typeof this.size === 'number' ? this.size : st.size) ?? null
            if (typeof this.size !== 'number' && st.size !== null) {
                this.size = st.size
            }

            if (fileSize !== null) {
                if (fileSize > LARGE_FILE_REJECT_SIZE) {
                    this.openError = `This file is too large to open (${formatBytes(fileSize)})`
                    this.status = 'Too large'
                    return true
                }

                if (fileSize > LARGE_FILE_WARNING_SIZE) {
                    const result = await this.platform.showMessageBox({
                        type: 'warning',
                        message: `This file is ${formatBytes(fileSize)}. Opening it may be slow.`,
                        detail: 'Do you want to continue?',
                        buttons: ['Open', 'Cancel'],
                        defaultId: 0,
                        cancelId: 1,
                    })
                    if (result.response !== 0) {
                        if (opts.onCancel === 'close') {
                            this.destroy()
                        }
                        return false
                    }
                }

                if (fileSize > LARGE_FILE_READONLY_SIZE) {
                    this.readOnlyLargeFile = true
                }
            }

            const buffer = await this.readRemoteFileBuffer()
            await this.applyLoadedBuffer(buffer)
            return true
        } catch (e: any) {
            const errMsg = e?.message ?? e?.toString?.() ?? ''
            if (/no.?such.?file|NoSuchFile/i.test(errMsg)) {
                this.disposePdfPreview()
                this.loadedBuffer = Buffer.alloc(0)
                this.isBinary = false
                this.isPdf = false
                this.encoding = 'utf-8'
                this.remoteMtime = null
                this.initEditorIfNeeded()
                this.applyLanguageToEditor()
                this.setEditorValue('')
                this.dirty = false
                this.status = 'New file'
                return true
            }
            this.status = 'Failed to load'
            this.openError = e?.message ?? 'Failed to load file'
            this.notifications.error(this.openError)
            return true
        } finally {
            this.loading = false
        }
    }

    private applyLanguageToEditor (): void {
        try {
            const monaco = getMonaco()
            const model = this.editor?.getModel?.()
            if (model) {
                monaco.editor.setModelLanguage(model as any, this.languageId)
            }
        } catch {
            // ignore
        }
    }

    async canClose (): Promise<boolean> {
        if (!this.dirty) {
            return true
        }

        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: `Save changes to ${this.name ?? this.path}?`,
            buttons: ['Save', 'Discard', 'Cancel'],
            defaultId: 0,
            cancelId: 2,
        })

        if (result.response === 0) {
            return await this.save()
        }
        if (result.response === 1) {
            return true
        }
        return false
    }

    async save (): Promise<boolean> {
        if (this.diffMode) {
            this.notifications.notice('Resolve the conflict first')
            return false
        }
        if (this.saving || this.loading) {
            return false
        }
        if (this.showPdfPreview()) {
            this.notifications.notice('PDF preview is read-only')
            return false
        }
        if (!this.editor) {
            return false
        }
        if (this.readOnlyLargeFile) {
            this.notifications.notice('This file is read-only due to its size')
            return false
        }
        if (this.isBinary && !this.forceOpenBinary) {
            this.notifications.notice('This file appears to be binary')
            return false
        }

        const localText = this.editor.getValue()

        this.saving = true
        this.status = 'Checking...'
        try {
            const currentRemoteMtime = await this.getRemoteMtime().catch(() => null)
            if (
                this.remoteMtime !== null &&
                currentRemoteMtime !== null &&
                currentRemoteMtime !== this.remoteMtime
            ) {
                this.status = 'Conflict detected'
                const remoteBuffer = await this.readRemoteFileBuffer()
                const remoteText = this.decodeBufferForDisplay(remoteBuffer)
                this.showConflictDiff(remoteText, localText)
                return false
            }

            this.status = 'Saving...'
            const payload = this.buildWriteBuffer(localText)
            await this.writeRemoteFileBuffer(payload)
            this.remoteMtime = await this.getRemoteMtime().catch(() => null)
            this.loadedBuffer = payload
            this.isBinary = isBinaryContent(payload)
            this.detectAndApplyEncoding(payload)
            this.dirty = false
            this.status = 'Saved'
            return true
        } catch (e: any) {
            this.status = 'Save failed'
            this.notifications.error(e?.message ?? 'Failed to save file')
            return false
        } finally {
            this.saving = false
        }
    }

    async resolveConflictUseLocal (): Promise<void> {
        if (!this.diffMode || this.saving || this.loading) {
            return
        }

        const text = this.getDiffModifiedText()
        this.saving = true
        this.status = 'Saving (force)...'
        try {
            const payload = this.buildWriteBuffer(text)
            await this.writeRemoteFileBuffer(payload)
            this.remoteMtime = await this.getRemoteMtime().catch(() => null)
            this.loadedBuffer = payload
            this.isBinary = isBinaryContent(payload)
            this.detectAndApplyEncoding(payload)
            this.exitDiffToEditor(text)
            this.dirty = false
            this.status = 'Saved'
        } catch (e: any) {
            this.status = 'Save failed'
            this.notifications.error(e?.message ?? 'Failed to save file')
        } finally {
            this.saving = false
        }
    }

    async resolveConflictUseRemote (): Promise<void> {
        if (!this.diffMode || this.saving || this.loading) {
            return
        }

        this.saving = true
        this.status = 'Reloading...'
        try {
            const st = await this.getRemoteStat().catch(() => ({ mtime: null, size: null }))
            this.remoteMtime = st.mtime

            if (st.size !== null) {
                this.size = st.size
                if (st.size > LARGE_FILE_REJECT_SIZE) {
                    this.openError = `This file is too large to open (${formatBytes(st.size)})`
                    this.status = 'Too large'
                    this.disposeDiffEditor()
                    this.editorHost?.nativeElement && (this.editorHost.nativeElement.innerHTML = '')
                    this.diffMode = false
                    this.dirty = false
                    return
                }
                this.readOnlyLargeFile = st.size > LARGE_FILE_READONLY_SIZE
            }

            const buffer = await this.readRemoteFileBuffer()
            this.forceOpenBinary = false
            this.disposeDiffEditor()
            this.editorHost?.nativeElement && (this.editorHost.nativeElement.innerHTML = '')
            this.diffMode = false
            await this.applyLoadedBuffer(buffer)
            this.dirty = false
        } catch (e: any) {
            this.status = 'Reload failed'
            this.notifications.error(e?.message ?? 'Failed to reload remote file')
        } finally {
            this.saving = false
        }
    }

    resolveConflictCancel (): void {
        if (!this.diffMode) {
            return
        }

        const text = this.getDiffModifiedText()
        this.exitDiffToEditor(text)
        this.dirty = true
        this.status = 'Modified'
    }

    private startFollowingTheme (): void {
        try {
            this.themeSubscription?.unsubscribe?.()
            this.themeSubscription = (this.themes as any)?.themeChanged$?.subscribe?.(() => {
                if (!this.followTabbyTheme) {
                    return
                }
                // themeChanged$ fires before applyThemeVariables(); delay one tick so CSS vars are updated.
                setTimeout(() => {
                    if (!this.followTabbyTheme) {
                        return
                    }
                    const dark = this.detectDarkModeFromTabby()
                    if (dark !== this.darkMode) {
                        this.darkMode = dark
                        this.applyTheme()
                    }
                }, 0)
            })
        } catch {
            // ignore
        }
    }

    private initEditorIfNeeded (): void {
        if (this.editor) {
            return
        }
        if (!this.editorHost?.nativeElement) {
            throw new Error('Editor host element not ready')
        }

        const monaco = getMonaco()
        ensureMonacoLanguagesLoaded()
        registerFormattingProviders(this.notifications)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('monaco-editor/min/vs/editor/editor.main.css')

        this.applyTheme()
        this.editor = monaco.editor.create(this.editorHost.nativeElement, {
            value: '',
            language: this.languageId,
            automaticLayout: true,
            readOnly: true,
            contextmenu: false,
            wordWrap: 'on',
            wrappingIndent: 'same',
        })

        this.editor.onDidChangeModelContent(() => {
            if (this.settingValue) {
                return
            }
            this.refreshMarkdownPreview()
            this.dirty = true
            this.status = 'Modified'
        })

        this.editor.onDidChangeCursorSelection(() => {
            this.updateMonacoSelectionOverlay(this.editor)
        })

        this.editor.onDidScrollChange(() => {
            if (this.translationSelectionState?.source === 'monaco') {
                this.updateMonacoSelectionOverlay(this.editor)
            }
        })

        this.editor.onDidLayoutChange(() => {
            if (this.translationSelectionState?.source === 'monaco') {
                this.updateMonacoSelectionOverlay(this.editor)
            }
        })

        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            this.save()
        })

        this.setupEditorClipboard()
        this.ensureCodeEditorFocus(this.editor)
    }

    private setEditorValue (text: string): void {
        if (!this.editor) {
            return
        }
        this.settingValue = true
        try {
            this.editor.setValue(text)
            this.dirty = false
            this.refreshMarkdownPreview(text)
            this.editor.updateOptions({
                readOnly: this.readOnlyLargeFile,
                wordWrap: 'on',
                wrappingIndent: 'same',
            })
        } finally {
            this.settingValue = false
        }
    }

    private showConflictDiff (remoteText: string, localText: string): void {
        if (!this.editorHost?.nativeElement) {
            throw new Error('Editor host element not ready')
        }

        this.closeTranslationPopover()
        const monaco = getMonaco()
        ensureMonacoLanguagesLoaded()
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('monaco-editor/min/vs/editor/editor.main.css')

        this.diffMode = true
        this.markdownPreview = false
        this.status = 'Conflict detected'

        this.disposeEditor()
        this.disposeDiffEditor()
        this.editorHost.nativeElement.innerHTML = ''

        this.applyTheme()

        this.diffOriginalModel = monaco.editor.createModel(remoteText, this.languageId)
        this.diffModifiedModel = monaco.editor.createModel(localText, this.languageId)

        this.diffEditor = monaco.editor.createDiffEditor(this.editorHost.nativeElement, {
            automaticLayout: true,
            renderSideBySide: true,
            contextmenu: false,
            wordWrap: 'on',
            wrappingIndent: 'same',
        })

        this.diffEditor.setModel({
            original: this.diffOriginalModel,
            modified: this.diffModifiedModel,
        })

        this.diffEditor.getOriginalEditor().updateOptions({
            readOnly: true,
            wordWrap: 'on',
            wrappingIndent: 'same',
        })
        const modifiedEditor = this.diffEditor.getModifiedEditor()
        modifiedEditor.updateOptions({
            readOnly: false,
            wordWrap: 'on',
            wrappingIndent: 'same',
        })

        modifiedEditor.onDidChangeModelContent(() => {
            // Keep dirty state; conflict is still unresolved.
            this.dirty = true
            this.status = 'Conflict detected'
        })

        modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            this.notifications.notice('Resolve the conflict first')
        })

        this.ensureCodeEditorFocus(modifiedEditor)
    }

    private exitDiffToEditor (text: string): void {
        if (!this.editorHost?.nativeElement) {
            return
        }

        this.closeTranslationPopover()
        this.disposeDiffEditor()
        this.editorHost.nativeElement.innerHTML = ''
        this.diffMode = false

        this.initEditorIfNeeded()
        this.setEditorValue(text)
        this.ensureCodeEditorFocus(this.editor)
    }

    private refreshMarkdownPreview (text?: string): void {
        if (this.languageId !== 'markdown') {
            this.markdownPreviewHtml = ''
            return
        }

        let source = text
        if (source === undefined) {
            source = this.editor?.getValue?.()
        }
        if (source === undefined && this.loadedBuffer) {
            try {
                source = this.decodeBuffer(this.loadedBuffer, this.encoding)
            } catch {
                source = ''
            }
        }

        this.markdownPreviewHtml = renderMarkdownPreview(source ?? '')
    }

    private setupTranslationUiListeners (): void {
        if (this.translationUiCleanup) {
            return
        }

        const onDocumentMouseDown = (event: MouseEvent): void => {
            const target = event.target as HTMLElement | null
            if (target?.closest('.translation-fab, .translation-popover, .translation-settings-card')) {
                return
            }
            if (this.translationSettingsVisible) {
                return
            }
            this.closeTranslationPopover()
        }

        const onDocumentKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') {
                return
            }
            if (this.translationSettingsVisible) {
                this.closeTranslationSettings()
                return
            }
            this.closeTranslationPopover()
        }

        const onWindowResize = (): void => {
            if (!this.translationSelectionState) {
                return
            }
            if (this.translationPopoverVisible) {
                if (this.translationPopoverManualPosition) {
                    this.clampTranslationPopoverIntoView()
                } else {
                    this.positionTranslationPopover(this.translationSelectionState.anchor)
                }
            }

            switch (this.translationSelectionState.source) {
                case 'monaco':
                    this.updateMonacoSelectionOverlay()
                    break
                case 'markdown':
                    this.scheduleMarkdownSelectionUpdate()
                    break
                case 'pdf':
                    this.schedulePdfSelectionUpdate()
                    break
            }
        }

        document.addEventListener('mousedown', onDocumentMouseDown, true)
        document.addEventListener('keydown', onDocumentKeyDown, true)
        window.addEventListener('resize', onWindowResize)

        this.translationUiCleanup = () => {
            document.removeEventListener('mousedown', onDocumentMouseDown, true)
            document.removeEventListener('keydown', onDocumentKeyDown, true)
            window.removeEventListener('resize', onWindowResize)
        }
    }

    private updateMonacoSelectionOverlay (editor = this.editor): void {
        if (!editor || this.diffMode || this.showMarkdownPreview() || this.openError || (this.isBinary && !this.forceOpenBinary)) {
            this.clearTranslationSelection('monaco')
            return
        }

        const state = this.getMonacoSelectionState(editor)
        if (!state) {
            this.clearTranslationSelection('monaco')
            return
        }

        this.setTranslationSelectionState(state)
    }

    private getMonacoSelectionState (editor: any): TranslationSelectionState | null {
        const selection = editor?.getSelection?.()
        const model = editor?.getModel?.()
        if (!selection || !model || selection.isEmpty?.()) {
            return null
        }

        const text = this.normalizeTranslationSelectionText(model.getValueInRange(selection), 'monaco')
        if (!text) {
            return null
        }

        const anchor = this.getMonacoSelectionAnchor(editor, selection)
        if (!anchor) {
            return null
        }

        return {
            text,
            source: 'monaco',
            sourceType: this.languageId || 'plaintext',
            anchor,
        }
    }

    private getMonacoSelectionAnchor (editor: any, selection: any): TranslationAnchor | null {
        const hostRect = this.contentArea?.nativeElement.getBoundingClientRect()
        const editorRect = editor?.getDomNode?.()?.getBoundingClientRect?.()
        if (!hostRect || !editorRect) {
            return null
        }

        const activePosition = selection?.getPosition?.() ?? {
            lineNumber: selection?.positionLineNumber ?? selection?.endLineNumber,
            column: selection?.positionColumn ?? selection?.endColumn,
        }
        if (!activePosition?.lineNumber || !activePosition?.column) {
            return null
        }

        const visiblePosition = editor?.getScrolledVisiblePosition?.(activePosition)
        if (!visiblePosition) {
            return null
        }

        return {
            top: editorRect.top - hostRect.top + visiblePosition.top + 2,
            left: editorRect.left - hostRect.left + visiblePosition.left,
        }
    }

    private scheduleMarkdownSelectionUpdate (): void {
        if (this.translationSelectionTimer !== null) {
            clearTimeout(this.translationSelectionTimer)
        }
        this.translationSelectionTimer = window.setTimeout(() => {
            this.translationSelectionTimer = null
            this.updateMarkdownSelectionOverlay()
        }, 0)
    }

    private schedulePdfSelectionUpdate (): void {
        if (this.translationSelectionTimer !== null) {
            clearTimeout(this.translationSelectionTimer)
        }
        this.translationSelectionTimer = window.setTimeout(() => {
            this.translationSelectionTimer = null
            this.updatePdfSelectionOverlay()
        }, 0)
    }

    private updateMarkdownSelectionOverlay (): void {
        if (!this.showMarkdownPreview()) {
            this.clearTranslationSelection('markdown')
            return
        }

        const preview = this.contentArea?.nativeElement.querySelector('.markdown-preview') as HTMLElement | null
        this.updateDomSelectionOverlay(preview, 'markdown', 'markdown')
    }

    private updatePdfSelectionOverlay (): void {
        if (!this.showPdfPreview()) {
            this.clearTranslationSelection('pdf')
            return
        }

        this.updateDomSelectionOverlay(this.pdfPreviewPage?.nativeElement ?? null, 'pdf', 'pdf')
    }

    private updateDomSelectionOverlay (
        container: HTMLElement | null,
        source: TranslationSelectionSource,
        sourceType: string,
    ): void {
        const range = this.getContainedSelectionRange(container)
        if (!container || !range) {
            this.clearTranslationSelection(source)
            return
        }

        const text = this.normalizeTranslationSelectionText(window.getSelection?.()?.toString?.() ?? '', source)
        if (!text) {
            this.clearTranslationSelection(source)
            return
        }

        const rect = range.getBoundingClientRect()
        if (!rect || (!rect.width && !rect.height)) {
            this.clearTranslationSelection(source)
            return
        }

        const containerRect = this.contentArea?.nativeElement.getBoundingClientRect()
        if (!containerRect) {
            this.clearTranslationSelection(source)
            return
        }

        this.setTranslationSelectionState({
            text,
            source,
            sourceType,
            anchor: {
                top: rect.top - containerRect.top + 4,
                left: rect.left - containerRect.left + rect.width / 2,
            },
        })
    }

    private getContainedSelectionRange (container: HTMLElement | null): Range | null {
        if (!container) {
            return null
        }

        const selection = window.getSelection?.()
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
            return null
        }

        const range = selection.getRangeAt(0)
        const commonAncestor = range.commonAncestorContainer
        const anchorNode = commonAncestor.nodeType === Node.ELEMENT_NODE ? commonAncestor : commonAncestor.parentNode
        if (!anchorNode || !container.contains(anchorNode)) {
            return null
        }

        return range
    }

    private normalizeTranslationSelectionText (
        text: string,
        source: TranslationSelectionSource,
    ): string {
        const normalized = this.normalizeRawSelectionText(text)
        if (!normalized) {
            return ''
        }

        if (source !== 'pdf') {
            return normalized
        }

        return this.normalizePdfSelectionTextForAi(normalized)
    }

    private normalizeRawSelectionText (text: string): string {
        return (text ?? '').replace(/\r\n?/g, '\n').trim()
    }

    private normalizePdfSelectionTextForAi (text: string): string {
        const paragraphs = text
            .split(/\n\s*\n+/)
            .map(paragraph => this.mergePdfSelectionParagraph(paragraph))
            .filter(Boolean)

        return paragraphs.join('\n\n').trim()
    }

    private mergePdfSelectionParagraph (paragraph: string): string {
        const lines = paragraph
            .split('\n')
            .map(line => line.replace(/[ \t]+/g, ' ').trim())
            .filter(Boolean)

        if (!lines.length) {
            return ''
        }

        let merged = lines[0]
        for (const line of lines.slice(1)) {
            merged = this.joinPdfSelectionLines(merged, line)
        }

        return merged
    }

    private joinPdfSelectionLines (current: string, nextLine: string): string {
        if (!current) {
            return nextLine
        }
        if (!nextLine) {
            return current
        }

        const previousChar = current.slice(-1)
        const nextChar = nextLine[0]
        if (
            previousChar === '-' &&
            /[A-Za-z]$/.test(current.slice(0, -1)) &&
            /^[A-Za-z]/.test(nextLine)
        ) {
            return `${current.slice(0, -1)}${nextLine}`
        }

        return this.shouldInsertSpaceBetweenPdfLines(previousChar, nextChar)
            ? `${current} ${nextLine}`
            : `${current}${nextLine}`
    }

    private shouldInsertSpaceBetweenPdfLines (previousChar: string, nextChar: string): boolean {
        if (!previousChar || !nextChar) {
            return false
        }
        if (/\s/.test(previousChar) || /\s/.test(nextChar)) {
            return false
        }
        if (this.isCjkSelectionChar(previousChar) || this.isCjkSelectionChar(nextChar)) {
            return false
        }
        if (/[\u3001\u3002\uff0c\uff1b\uff1a\uff01\uff1f，。；：！？、)\\]\\}'"”’%]/.test(nextChar)) {
            return false
        }
        if (/[(\\[{'"“‘]/.test(previousChar)) {
            return false
        }

        return true
    }

    private isCjkSelectionChar (char: string): boolean {
        return /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char)
    }

    private setTranslationSelectionState (state: TranslationSelectionState): void {
        const previous = this.translationSelectionState
        const sameSelection = !!previous &&
            previous.source === state.source &&
            previous.sourceType === state.sourceType &&
            previous.text === state.text

        this.translationSelectionState = state
        this.translationSelectedText = state.text
        this.translationButtonLabel = 'AI'
        this.translationButtonTop = state.anchor.top
        this.translationButtonLeft = state.anchor.left

        if (!sameSelection) {
            this.translationRequestAbort?.abort()
            this.translationRequestAbort = null
            this.askAiRequestAbort?.abort()
            this.askAiRequestAbort = null
            this.translationLoading = false
            this.translationResult = ''
            this.translationError = ''
            this.translationEndpointUsed = ''
            this.askAiQuestion = ''
            this.askAiResult = ''
            this.askAiError = ''
            this.askAiLoading = false
            this.askAiEndpointUsed = ''
            this.translationPopoverVisible = false
            this.translationPopoverManualPosition = false
        }

        this.translationButtonVisible = !this.translationPopoverVisible
        if (this.translationPopoverVisible) {
            if (this.translationPopoverManualPosition) {
                this.clampTranslationPopoverIntoView()
            } else {
                this.positionTranslationPopover(state.anchor)
            }
        }

        this.safeDetectChanges()
    }

    private clearTranslationSelection (source?: TranslationSelectionSource): void {
        if (source && this.translationSelectionState?.source !== source) {
            return
        }
        this.closeTranslationPopover()
    }

    private positionTranslationPopover (anchor: TranslationAnchor): void {
        const width = this.clampTranslationPopoverWidth(this.translationPopoverWidth || 360)
        const height = this.clampTranslationPopoverHeight(this.translationPopoverHeight || 320)
        const left = anchor.left - width / 2
        const top = anchor.top + 12

        this.translationPopoverWidth = width
        this.translationPopoverHeight = height
        this.setTranslationPopoverPosition(left, top, width, height)
    }

    private openTranslationPopover (): void {
        if (!this.translationSelectionState) {
            return
        }

        this.translationSelectedText = this.translationSelectionState.text
        this.translationPopoverVisible = true
        this.translationButtonVisible = false
        if (this.translationPopoverManualPosition) {
            this.clampTranslationPopoverIntoView()
        } else {
            this.positionTranslationPopover(this.translationSelectionState.anchor)
        }
        this.safeDetectChanges()
    }

    private clampTranslationPopoverWidth (width: number): number {
        const hostWidth = this.contentArea?.nativeElement.getBoundingClientRect()?.width ?? 420
        return Math.round(clampNumber(width, TRANSLATION_POPOVER_MIN_WIDTH, Math.max(TRANSLATION_POPOVER_MIN_WIDTH, hostWidth - 24)))
    }

    private clampTranslationPopoverHeight (height: number): number {
        const hostHeight = this.contentArea?.nativeElement.getBoundingClientRect()?.height ?? 420
        return Math.round(clampNumber(height, TRANSLATION_POPOVER_MIN_HEIGHT, Math.max(TRANSLATION_POPOVER_MIN_HEIGHT, hostHeight - 24)))
    }

    private setTranslationPopoverPosition (left: number, top: number, width = this.translationPopoverWidth, height = this.translationPopoverHeight): void {
        const hostRect = this.contentArea?.nativeElement.getBoundingClientRect()
        const maxLeft = Math.max(12, (hostRect?.width ?? width + 24) - width - 12)
        const maxTop = Math.max(12, (hostRect?.height ?? height + 24) - height - 12)

        this.translationPopoverLeft = Math.round(clampNumber(left, 12, maxLeft))
        this.translationPopoverTop = Math.round(clampNumber(top, 12, maxTop))
    }

    private clampTranslationPopoverIntoView (): void {
        this.translationPopoverWidth = this.clampTranslationPopoverWidth(this.translationPopoverWidth)
        this.translationPopoverHeight = this.clampTranslationPopoverHeight(this.translationPopoverHeight)
        this.setTranslationPopoverPosition(this.translationPopoverLeft, this.translationPopoverTop)
        this.safeDetectChanges()
    }

    startTranslationPopoverDrag (event: MouseEvent): void {
        if (!this.translationPopoverVisible) {
            return
        }

        event.preventDefault()
        event.stopPropagation()

        if (this.translationPopoverDragMoveListener) {
            document.removeEventListener('mousemove', this.translationPopoverDragMoveListener)
        }
        if (this.translationPopoverDragUpListener) {
            document.removeEventListener('mouseup', this.translationPopoverDragUpListener)
        }

        this.translationPopoverManualPosition = true
        this.translationPopoverDragStartX = event.clientX
        this.translationPopoverDragStartY = event.clientY
        this.translationPopoverDragStartLeft = this.translationPopoverLeft
        this.translationPopoverDragStartTop = this.translationPopoverTop

        this.translationPopoverDragMoveListener = (moveEvent: MouseEvent): void => {
            const nextLeft = this.translationPopoverDragStartLeft + (moveEvent.clientX - this.translationPopoverDragStartX)
            const nextTop = this.translationPopoverDragStartTop + (moveEvent.clientY - this.translationPopoverDragStartY)
            this.setTranslationPopoverPosition(nextLeft, nextTop)
            this.safeDetectChanges()
        }

        this.translationPopoverDragUpListener = (): void => {
            if (this.translationPopoverDragMoveListener) {
                document.removeEventListener('mousemove', this.translationPopoverDragMoveListener)
            }
            if (this.translationPopoverDragUpListener) {
                document.removeEventListener('mouseup', this.translationPopoverDragUpListener)
            }
            this.translationPopoverDragMoveListener = null
            this.translationPopoverDragUpListener = null
        }

        document.addEventListener('mousemove', this.translationPopoverDragMoveListener)
        document.addEventListener('mouseup', this.translationPopoverDragUpListener, { once: true })
    }

    startTranslationPopoverResize (event: MouseEvent): void {
        if (!this.translationPopoverVisible) {
            return
        }

        event.preventDefault()
        event.stopPropagation()

        if (this.translationPopoverResizeMoveListener) {
            document.removeEventListener('mousemove', this.translationPopoverResizeMoveListener)
        }
        if (this.translationPopoverResizeUpListener) {
            document.removeEventListener('mouseup', this.translationPopoverResizeUpListener)
        }

        this.translationPopoverManualPosition = true
        this.translationPopoverResizeStartX = event.clientX
        this.translationPopoverResizeStartY = event.clientY
        this.translationPopoverResizeStartWidth = this.translationPopoverWidth
        this.translationPopoverResizeStartHeight = this.translationPopoverHeight

        this.translationPopoverResizeMoveListener = (moveEvent: MouseEvent): void => {
            const nextWidth = this.translationPopoverResizeStartWidth + (moveEvent.clientX - this.translationPopoverResizeStartX)
            const nextHeight = this.translationPopoverResizeStartHeight + (moveEvent.clientY - this.translationPopoverResizeStartY)
            this.translationPopoverWidth = this.clampTranslationPopoverWidth(nextWidth)
            this.translationPopoverHeight = this.clampTranslationPopoverHeight(nextHeight)
            this.setTranslationPopoverPosition(this.translationPopoverLeft, this.translationPopoverTop)
            this.safeDetectChanges()
        }

        this.translationPopoverResizeUpListener = (): void => {
            if (this.translationPopoverResizeMoveListener) {
                document.removeEventListener('mousemove', this.translationPopoverResizeMoveListener)
            }
            if (this.translationPopoverResizeUpListener) {
                document.removeEventListener('mouseup', this.translationPopoverResizeUpListener)
            }
            this.translationPopoverResizeMoveListener = null
            this.translationPopoverResizeUpListener = null
        }

        document.addEventListener('mousemove', this.translationPopoverResizeMoveListener)
        document.addEventListener('mouseup', this.translationPopoverResizeUpListener, { once: true })
    }

    private buildTranslationCacheKey (state: TranslationSelectionState): string {
        const config = this.translationSettings
        return JSON.stringify({
            base: config.apiBaseUrl,
            endpointMode: config.endpointMode,
            model: config.model,
            targetLanguage: config.targetLanguage,
            sourceType: state.sourceType,
            text: state.text,
        })
    }

    private buildAskAiCacheKey (state: TranslationSelectionState, question: string): string {
        const config = this.translationSettings
        return JSON.stringify({
            base: config.apiBaseUrl,
            endpointMode: config.endpointMode,
            model: config.askModel,
            reasoningEffort: config.askReasoningEffort,
            sourceType: state.sourceType,
            text: state.text,
            question,
        })
    }

    private async runTranslationForCurrentSelection (): Promise<void> {
        const state = this.translationSelectionState
        if (!state) {
            return
        }

        this.openTranslationPopover()
        this.translationResult = ''
        this.translationError = ''

        if (state.text.length > TRANSLATION_MAX_SELECTION_LENGTH) {
            this.translationLoading = false
            this.translationError = `Selection is too long to translate (${state.text.length} characters, max ${TRANSLATION_MAX_SELECTION_LENGTH})`
            this.safeDetectChanges()
            return
        }

        const cacheKey = this.buildTranslationCacheKey(state)
        const cached = this.translationCache.get(cacheKey)
        if (cached) {
            this.translationLoading = false
            this.translationResult = cached
            this.translationEndpointUsed = 'cache'
            this.safeDetectChanges()
            return
        }

        this.translationRequestAbort?.abort()
        this.translationRequestAbort = new AbortController()
        this.translationLoading = true
        this.translationEndpointUsed = ''
        this.safeDetectChanges()

        try {
            const result = await translateSelection(this.translationSettings, {
                text: state.text,
                sourceType: state.sourceType,
                signal: this.translationRequestAbort.signal,
            })

            if (this.translationSelectionState?.text !== state.text) {
                return
            }

            this.translationResult = result.text
            this.translationEndpointUsed = result.endpointUsed
            this.translationCache.set(cacheKey, result.text)
            this.translationError = ''
        } catch (e: any) {
            if (this.translationRequestAbort?.signal.aborted) {
                return
            }

            const err = e instanceof TranslationError
                ? e
                : new TranslationError(e?.message ?? 'Translation request failed')
            this.translationResult = ''
            this.translationEndpointUsed = ''
            this.translationError = err.message
        } finally {
            this.translationLoading = false
            this.translationRequestAbort = null
            this.safeDetectChanges()
        }
    }

    private async runAskAiForCurrentSelection (): Promise<void> {
        const state = this.translationSelectionState
        const question = this.askAiQuestion.trim()
        if (!state) {
            return
        }

        this.openTranslationPopover()
        this.askAiError = ''
        this.askAiResult = ''

        if (!question) {
            this.askAiLoading = false
            this.askAiError = 'Please enter a question'
            this.safeDetectChanges()
            return
        }

        if (state.text.length > TRANSLATION_MAX_SELECTION_LENGTH) {
            this.askAiLoading = false
            this.askAiError = `Selection is too long to ask about (${state.text.length} characters, max ${TRANSLATION_MAX_SELECTION_LENGTH})`
            this.safeDetectChanges()
            return
        }

        const cacheKey = this.buildAskAiCacheKey(state, question)
        const cached = this.askAiCache.get(cacheKey)
        if (cached) {
            this.askAiLoading = false
            this.askAiResult = cached
            this.askAiEndpointUsed = 'cache'
            this.safeDetectChanges()
            return
        }

        this.askAiRequestAbort?.abort()
        this.askAiRequestAbort = new AbortController()
        this.askAiLoading = true
        this.askAiEndpointUsed = ''
        this.safeDetectChanges()

        try {
            const result = await askAiAboutSelection(this.translationSettings, {
                selection: state.text,
                question,
                sourceType: state.sourceType,
                signal: this.askAiRequestAbort.signal,
            })

            if (this.translationSelectionState?.text !== state.text || this.askAiQuestion.trim() !== question) {
                return
            }

            this.askAiResult = result.text
            this.askAiEndpointUsed = result.endpointUsed
            this.askAiCache.set(cacheKey, result.text)
            this.askAiError = ''
        } catch (e: any) {
            if (this.askAiRequestAbort?.signal.aborted) {
                return
            }

            const err = e instanceof TranslationError
                ? e
                : new TranslationError(e?.message ?? 'Ask request failed')
            this.askAiResult = ''
            this.askAiEndpointUsed = ''
            this.askAiError = err.message
        } finally {
            this.askAiLoading = false
            this.askAiRequestAbort = null
            this.safeDetectChanges()
        }
    }

    private getDiffModifiedText (): string {
        const model = this.diffModifiedModel
        if (!model) {
            return ''
        }
        return model.getValue()
    }

    private disposeEditor (): void {
        if (!this.editor) {
            return
        }
        try {
            this.editor.getModel()?.dispose?.()
        } catch {
            // ignore
        }
        try {
            this.editor.dispose()
        } catch {
            // ignore
        }
        this.editor = undefined
    }

    private disposeDiffEditor (): void {
        try {
            this.diffEditor?.dispose()
        } catch {
            // ignore
        }
        this.diffEditor = undefined

        try {
            this.diffOriginalModel?.dispose()
        } catch {
            // ignore
        }
        this.diffOriginalModel = undefined

        try {
            this.diffModifiedModel?.dispose()
        } catch {
            // ignore
        }
        this.diffModifiedModel = undefined
    }

    private applyTheme (): void {
        const monaco = getMonaco()
        monaco.editor.setTheme(this.darkMode ? 'vs-dark' : 'vs')
    }

    private relayoutEditors (): void {
        setTimeout(() => {
            try {
                this.editor?.layout?.()
            } catch {
                // ignore
            }
            try {
                this.diffEditor?.layout?.()
            } catch {
                // ignore
            }
        }, 0)
    }

    private openExternalLink (url: string): void {
        try {
            const { shell } = require('electron')
            Promise.resolve(shell?.openExternal?.(url)).catch(() => {
                this.notifications.error('Failed to open link')
            })
            return
        } catch {
            // electron shell not available
        }

        try {
            window.open(url, '_blank', 'noopener')
        } catch {
            this.notifications.error('Failed to open link')
        }
    }

    private openSupportedExternalLink (url: string, unsupportedMessage: string): void {
        const href = `${url ?? ''}`.trim()
        if (!href) {
            return
        }

        if (/^\/\//.test(href)) {
            this.openExternalLink(`https:${href}`)
            return
        }
        if (/^(https?:|mailto:|tel:)/i.test(href)) {
            this.openExternalLink(href)
            return
        }

        this.notifications.notice(unsupportedMessage)
    }

    private readClipboardText (): string {
        try {
            const { clipboard } = require('electron')
            return clipboard.readText() ?? ''
        } catch {
            // electron clipboard not available
        }
        try {
            const remote = require('@electron/remote')
            return remote?.clipboard?.readText?.() ?? ''
        } catch {
            // @electron/remote not available
        }
        return ''
    }

    private writeClipboardText (text: string): void {
        try {
            const { clipboard } = require('electron')
            clipboard.writeText(text)
            return
        } catch {
            // electron clipboard not available
        }
        try {
            const remote = require('@electron/remote')
            remote?.clipboard?.writeText?.(text)
            return
        } catch {
            // @electron/remote not available
        }
        navigator.clipboard?.writeText(text)?.catch(() => {})
    }

    private getActiveCodeEditor (): any {
        if (this.diffMode && this.diffEditor) {
            return this.diffEditor.getModifiedEditor()
        }
        return this.editor ?? null
    }

    private isEditorReadOnly (editor: any): boolean {
        if (!editor) {
            return true
        }

        const monaco = getMonaco()
        try {
            return !!editor.getOption(monaco.editor.EditorOption.readOnly)
        } catch {
            return true
        }
    }

    private insertPlainText (editor: any, text: string): boolean {
        if (!editor || !text || this.isEditorReadOnly(editor)) {
            return false
        }

        this.focusCodeEditor(editor)

        try {
            editor.trigger('clipboard', 'type', { text })
            return true
        } catch {
            // ignore and fallback to raw edit insertion
        }

        try {
            const selection = editor.getSelection?.()
            if (!selection) {
                return false
            }
            editor.executeEdits('clipboard', [{
                range: selection,
                text,
                forceMoveMarkers: true,
            }])
            return true
        } catch {
            return false
        }
    }

    private copySelectionToClipboard (editor: any): boolean {
        const selection = editor?.getSelection?.()
        const model = editor?.getModel?.()
        if (!selection || !model || selection.isEmpty()) {
            return false
        }

        const text = model.getValueInRange(selection)
        if (!text) {
            return false
        }

        this.writeClipboardText(text)
        return true
    }

    private cutSelectionToClipboard (editor: any): boolean {
        if (!editor || this.isEditorReadOnly(editor)) {
            return false
        }

        const selection = editor.getSelection?.()
        const model = editor.getModel?.()
        if (!selection || !model || selection.isEmpty()) {
            return false
        }

        const text = model.getValueInRange(selection)
        if (!text) {
            return false
        }

        this.writeClipboardText(text)

        try {
            editor.executeEdits('cut', [{
                range: selection,
                text: '',
                forceMoveMarkers: true,
            }])
            return true
        } catch {
            return false
        }
    }

    private selectAllInEditor (editor: any): void {
        if (!editor) {
            return
        }

        this.focusCodeEditor(editor)

        try {
            editor.trigger('keyboard', 'editor.action.selectAll', null)
            return
        } catch {
            // ignore and fallback to explicit range selection
        }

        try {
            const model = editor.getModel?.()
            if (!model) {
                return
            }
            const monaco = getMonaco()
            const lineCount = Math.max(1, model.getLineCount?.() ?? 1)
            const endColumn = model.getLineMaxColumn?.(lineCount) ?? 1
            editor.setSelection?.(new monaco.Range(1, 1, lineCount, endColumn))
        } catch {
            // ignore
        }
    }

    private runEditorAction (editor: any, actionId: string): void {
        if (!editor || !actionId) {
            return
        }

        this.focusCodeEditor(editor)

        try {
            const action = editor.getAction?.(actionId)
            if (action?.run) {
                void Promise.resolve(action.run())
                return
            }
        } catch {
            // ignore and fallback to trigger
        }

        try {
            editor.trigger('keyboard', actionId, null)
        } catch {
            // ignore
        }
    }

    private reloadCurrentFileFromContextMenu (): void {
        if (!this.path) {
            return
        }
        this.reloadFile({ fullPath: this.path } as SFTPFileItem)
    }

    private showEditorContextMenu (editor: any, event: MouseEvent): void {
        event.preventDefault()
        event.stopPropagation()

        this.ensureCodeEditorFocus(editor)

        const selection = editor?.getSelection?.()
        const hasSelection = !!selection && !selection.isEmpty()
        const readOnly = this.isEditorReadOnly(editor)
        const canTranslate =
            hasSelection &&
            !this.diffMode &&
            !this.openError &&
            !this.loading &&
            !this.saving &&
            !(this.isBinary && !this.forceOpenBinary)

        const canReload = !this.openError && !this.loading && !this.saving && !this.diffMode
        const canSaveBase =
            canReload &&
            !readOnly &&
            !this.readOnlyLargeFile &&
            !(this.isBinary && !this.forceOpenBinary)
        const canSave = canSaveBase && this.dirty
        const canReopenWithEncoding = canReload && !(this.isBinary && !this.forceOpenBinary)
        const canSaveWithEncoding = canSaveBase
        const canFormat = !readOnly && !this.openError && !this.loading && !this.saving && !(this.isBinary && !this.forceOpenBinary)
        const canFind = !this.openError && !(this.isBinary && !this.forceOpenBinary)
        const canReplace = canFind && !readOnly

        const menu: any[] = [
            {
                label: 'Save',
                enabled: canSave,
                click: () => this.save(),
            },
            {
                label: 'Reload from Remote',
                enabled: canReload,
                click: () => this.reloadCurrentFileFromContextMenu(),
            },
            { type: 'separator' },
            {
                label: 'Format Document',
                enabled: canFormat,
                click: () => this.runEditorAction(editor, 'editor.action.formatDocument'),
            },
            {
                label: 'Find / Replace',
                enabled: canFind,
                submenu: [
                    {
                        label: 'Find',
                        enabled: canFind,
                        click: () => this.runEditorAction(editor, 'actions.find'),
                    },
                    {
                        label: 'Replace',
                        enabled: canReplace,
                        click: () => this.runEditorAction(editor, 'editor.action.startFindReplaceAction'),
                    },
                ],
            },
            { type: 'separator' },
            {
                label: 'Translate Selection',
                enabled: canTranslate,
                click: () => {
                    const state = this.getMonacoSelectionState(editor)
                    if (!state) {
                        return
                    }
                    this.setTranslationSelectionState(state)
                    this.startTranslationFromSelection()
                },
            },
            {
                label: 'Ask',
                enabled: canTranslate,
                click: () => {
                    const state = this.getMonacoSelectionState(editor)
                    if (!state) {
                        return
                    }
                    this.setTranslationSelectionState(state)
                    this.startAskAiFromSelection()
                },
            },
            {
                label: 'AI Settings',
                click: () => this.openTranslationSettings(),
            },
            { type: 'separator' },
            {
                label: 'Reopen with Encoding',
                enabled: canReopenWithEncoding,
                submenu: this.buildReopenEncodingMenuItems(),
            },
            {
                label: 'Save with Encoding',
                enabled: canSaveWithEncoding,
                submenu: this.buildSaveWithEncodingMenuItems(),
            },
            { type: 'separator' },
            {
                label: 'Undo',
                enabled: !readOnly,
                click: () => editor.trigger('keyboard', 'undo', null),
            },
            {
                label: 'Redo',
                enabled: !readOnly,
                click: () => editor.trigger('keyboard', 'redo', null),
            },
            { type: 'separator' },
            {
                label: 'Cut',
                enabled: !readOnly && hasSelection,
                click: () => this.cutSelectionToClipboard(editor),
            },
            {
                label: 'Copy',
                enabled: hasSelection,
                click: () => this.copySelectionToClipboard(editor),
            },
            {
                label: 'Paste',
                enabled: !readOnly,
                click: () => {
                    const text = this.readClipboardText()
                    this.insertPlainText(editor, text)
                },
            },
            { type: 'separator' },
            {
                label: 'Select All',
                click: () => this.selectAllInEditor(editor),
            },
        ]

        this.platform.popupContextMenu(menu, event)
    }

    private isPasteShortcut (e: KeyboardEvent): boolean {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) {
            return false
        }

        const key = (e.key ?? '').toLowerCase()
        return key === 'v' || e.code === 'KeyV'
    }

    private isActiveElementInEditorHost (): boolean {
        const host = this.editorHost?.nativeElement
        const active = document.activeElement
        return !!host && !!active && host.contains(active)
    }

    private focusCodeEditor (editor: any): void {
        try {
            editor?.focus?.()
        } catch {
            // ignore
        }
    }

    private ensureCodeEditorFocus (editor: any): void {
        this.focusCodeEditor(editor)
        setTimeout(() => {
            if (this.componentDestroyed) {
                return
            }
            this.focusCodeEditor(editor)
        }, 0)
    }

    private setupEditorClipboard (): void {
        if (this.editorClipboardCleanup) {
            return
        }
        const el = this.editorHost?.nativeElement
        if (!el) {
            return
        }

        const onWindowPasteCapture = (e: KeyboardEvent): void => {
            if (!this.isPasteShortcut(e)) {
                return
            }
            if (!this.isActiveElementInEditorHost()) {
                return
            }

            const editor = this.getActiveCodeEditor()
            if (!editor) {
                return
            }

            const text = this.readClipboardText()
            if (!this.insertPlainText(editor, text)) {
                return
            }

            e.preventDefault()
            e.stopImmediatePropagation()
        }

        const onPasteKeydownCapture = (e: KeyboardEvent): void => {
            if (!this.isPasteShortcut(e)) {
                return
            }

            const editor = this.getActiveCodeEditor()
            if (!editor) {
                return
            }

            const text = this.readClipboardText()
            if (!this.insertPlainText(editor, text)) {
                return
            }

            e.preventDefault()
            e.stopImmediatePropagation()
        }

        const onPasteEventCapture = (e: ClipboardEvent): void => {
            const editor = this.getActiveCodeEditor()
            if (!editor) {
                return
            }

            const text = e.clipboardData?.getData('text/plain') ?? ''
            if (this.insertPlainText(editor, text)) {
                e.preventDefault()
                e.stopImmediatePropagation()
                return
            }

            const fallbackText = this.readClipboardText()
            if (!this.insertPlainText(editor, fallbackText)) {
                return
            }

            e.preventDefault()
            e.stopImmediatePropagation()
        }

        const onClipboardBubble = (e: KeyboardEvent): void => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) {
                return
            }
            const key = e.key.toLowerCase()
            if (key === 'c' || key === 'x' || key === 'a' || key === 'z' || key === 'y') {
                e.stopPropagation()
            }
        }

        const onCopyCapture = (e: KeyboardEvent): void => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) {
                return
            }
            const key = e.key.toLowerCase()
            if (key !== 'c' && key !== 'x') {
                return
            }

            const editor = this.getActiveCodeEditor()
            if (!editor) {
                return
            }

            const handled = key === 'x'
                ? this.cutSelectionToClipboard(editor)
                : this.copySelectionToClipboard(editor)
            if (!handled) {
                return
            }

            e.preventDefault()
            e.stopImmediatePropagation()
        }

        const onEditorContextMenu = (e: MouseEvent): void => {
            const editor = this.getActiveCodeEditor()
            if (!editor) {
                return
            }
            this.showEditorContextMenu(editor, e)
        }

        const onHostMouseDown = (): void => {
            this.ensureCodeEditorFocus(this.getActiveCodeEditor())
        }

        window.addEventListener('keydown', onWindowPasteCapture, true)
        el.addEventListener('keydown', onPasteKeydownCapture, true)
        el.addEventListener('paste', onPasteEventCapture, true)
        el.addEventListener('keydown', onCopyCapture, true)
        el.addEventListener('keydown', onClipboardBubble)
        el.addEventListener('contextmenu', onEditorContextMenu)
        el.addEventListener('mousedown', onHostMouseDown)

        this.editorClipboardCleanup = () => {
            window.removeEventListener('keydown', onWindowPasteCapture, true)
            el.removeEventListener('keydown', onPasteKeydownCapture, true)
            el.removeEventListener('paste', onPasteEventCapture, true)
            el.removeEventListener('keydown', onCopyCapture, true)
            el.removeEventListener('keydown', onClipboardBubble)
            el.removeEventListener('contextmenu', onEditorContextMenu)
            el.removeEventListener('mousedown', onHostMouseDown)
        }
    }

    private detectDarkModeFromTabby (): boolean {
        try {
            const rootStyle = getComputedStyle(document.documentElement)
            const bgVar =
                rootStyle.getPropertyValue('--theme-bg').trim() ||
                rootStyle.getPropertyValue('--bs-body-bg').trim()
            const fgVar =
                rootStyle.getPropertyValue('--theme-fg').trim() ||
                rootStyle.getPropertyValue('--bs-body-color').trim()

            const bodyStyle = getComputedStyle(document.body)
            const bg = parseCssColor(bgVar) ?? parseCssColor(bodyStyle.backgroundColor)
            const fg = parseCssColor(fgVar) ?? parseCssColor(bodyStyle.color)

            if (bg && fg) {
                return luminance(bg) < luminance(fg)
            }
        } catch {
            // ignore
        }

        try {
            const platformTheme = (this.platform as any)?.getTheme?.()
            if (platformTheme === 'light') {
                return false
            }
            if (platformTheme === 'dark') {
                return true
            }
        } catch {
            // ignore
        }

        // Tabby defaults to dark in most setups.
        return true
    }

    private getStoredFollowTheme (): boolean {
        try {
            const v = localStorage.getItem('tabby-mingze-online-editor.followTheme')
            return v === null ? true : v === '1'
        } catch {
            return true
        }
    }

    private storeFollowTheme (enabled: boolean): void {
        try {
            localStorage.setItem('tabby-mingze-online-editor.followTheme', enabled ? '1' : '0')
        } catch {
            // ignore
        }
    }

    private getStoredDarkMode (): boolean {
        try {
            return localStorage.getItem('tabby-mingze-online-editor.darkMode') === '1'
        } catch {
            return false
        }
    }

    private storeDarkMode (enabled: boolean): void {
        try {
            localStorage.setItem('tabby-mingze-online-editor.darkMode', enabled ? '1' : '0')
        } catch {
            // ignore
        }
    }

    private getElectronDialog (): any|null {
        try {
            const remote = require('@electron/remote')
            if (remote?.dialog) {
                return remote.dialog
            }
        } catch {
            // ignore
        }

        try {
            const electron = require('electron')
            if (electron?.remote?.dialog) {
                return electron.remote.dialog
            }
        } catch {
            // ignore
        }

        return null
    }

    private buildDefaultLocalTransferPath (name: string): string {
        const fileName = (name ?? '').trim() || 'download'
        const baseDir = this.getStoredLocalTransferDir()
        if (!baseDir) {
            return fileName
        }

        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const path = require('path')
            return path.join(baseDir, fileName)
        } catch {
            return fileName
        }
    }

    private async pickLocalFilesForUpload (targetDir: string): Promise<string[]> {
        const dialog = this.getElectronDialog()
        if (!dialog?.showOpenDialog) {
            throw new Error('Local file picker is not available in this Tabby build')
        }

        const result = await dialog.showOpenDialog({
            title: `Upload to ${this.normalizeRemotePath(targetDir)}`,
            defaultPath: this.getStoredLocalTransferDir() || undefined,
            properties: ['openFile', 'multiSelections'],
        })

        const filePaths = (result?.filePaths ?? []).filter((x: any) => typeof x === 'string' && x)
        if (!filePaths.length || result?.canceled) {
            return []
        }

        this.storeLocalTransferDir(filePaths[0])
        return filePaths
    }

    private async pickLocalPathForDownload (remotePath: string, suggestedName: string): Promise<string|null> {
        const dialog = this.getElectronDialog()
        if (!dialog?.showSaveDialog) {
            throw new Error('Local save dialog is not available in this Tabby build')
        }

        const result = await dialog.showSaveDialog({
            title: `Download ${this.normalizeRemotePath(remotePath)}`,
            defaultPath: this.buildDefaultLocalTransferPath(suggestedName),
        })

        if (result?.canceled || !result?.filePath) {
            return null
        }

        this.storeLocalTransferDir(result.filePath)
        return result.filePath
    }

    private async getSftp (): Promise<SFTPSession> {
        if (this.sftp) {
            return this.sftp
        }
        if (!this.sshSession?.openSFTP) {
            throw new Error('SSH session is not available')
        }
        this.sftp = await this.sshSession.openSFTP()
        return this.sftp
    }

    private detectAndApplyEncoding (buffer: Buffer): void {
        const bom = detectBOM(buffer)
        if (bom) {
            this.bomOffset = bom.offset
            this.bomBytes = buffer.slice(0, bom.offset)
            this.bomEncoding = bom.encoding
            if (this.encodingAuto) {
                this.encoding = bom.encoding
            }
            return
        }

        this.bomOffset = 0
        this.bomBytes = null
        this.bomEncoding = null
        if (!this.encodingAuto) {
            return
        }

        const utf8 = this.tryDecode(buffer, 'utf-8')
        if (utf8 !== null && !utf8.includes('\uFFFD')) {
            this.encoding = 'utf-8'
            return
        }

        const gbk = this.tryDecode(buffer, 'gbk')
        if (gbk !== null && !gbk.includes('\uFFFD')) {
            this.encoding = 'gbk'
            return
        }

        this.encoding = 'iso-8859-1'
    }

    private tryDecode (buffer: Buffer, encoding: string): string|null {
        const sample = buffer.slice(0, 64 * 1024)
        try {
            return new TextDecoder(encoding).decode(sample)
        } catch {
            return null
        }
    }

    private decodeBuffer (buffer: Buffer, encoding: string): string {
        try {
            return new TextDecoder(encoding).decode(buffer.slice(this.bomOffset))
        } catch {
            throw new Error(`Unsupported encoding: ${encoding}`)
        }
    }

    private decodeBufferForDisplay (buffer: Buffer): string {
        const bom = detectBOM(buffer)
        const offset = bom?.offset ?? 0
        const encoding = bom && this.encodingAuto ? bom.encoding : this.encoding

        try {
            return new TextDecoder(encoding).decode(buffer.slice(offset))
        } catch {
            return new TextDecoder('utf-8').decode(buffer.slice(offset))
        }
    }

    private normalizeEncodingId (encoding: string): string {
        return (encoding ?? '').toLowerCase().replace(/[_\s-]/g, '')
    }

    private buildWriteBuffer (text: string): Buffer {
        const body = this.encodeText(text, this.encoding)

        if (
            this.bomBytes &&
            this.bomEncoding &&
            this.normalizeEncodingId(this.bomEncoding) === this.normalizeEncodingId(this.encoding)
        ) {
            return Buffer.concat([this.bomBytes, body])
        }

        return body
    }

    private encodeText (text: string, encoding: string): Buffer {
        const enc = (encoding ?? 'utf-8').toLowerCase()

        if (enc === 'utf-8' || enc === 'utf8') {
            return Buffer.from(text, 'utf8')
        }
        if (enc === 'utf-16le' || enc === 'utf16le') {
            return Buffer.from(text, 'utf16le')
        }
        if (enc === 'iso-8859-1') {
            return Buffer.from(text, 'latin1')
        }

        const iconv = getIconvLite()
        if (!iconv) {
            throw new Error(`Saving in ${encoding} is not supported (iconv-lite not found)`)
        }

        for (const candidate of this.getIconvCandidates(enc)) {
            try {
                return Buffer.from(iconv.encode(text, candidate))
            } catch {
                // try next
            }
        }

        throw new Error(`Unsupported encoding for save: ${encoding}`)
    }

    private getIconvCandidates (encoding: string): string[] {
        if (encoding === 'shift_jis') {
            return ['shift_jis', 'shiftjis']
        }
        if (encoding === 'windows-1252') {
            return ['windows-1252', 'win1252']
        }
        if (encoding === 'utf-16be' || encoding === 'utf16be') {
            return ['utf-16be', 'utf16be', 'utf16-be']
        }
        return [encoding]
    }

    private async getRemotePathStat (remotePath: string): Promise<{ isDirectory: boolean, mode: number|null, size: number|null }|null> {
        const sftp: any = await this.getSftp()
        if (!sftp?.stat) {
            return null
        }

        try {
            const stat: any = await sftp.stat(remotePath)
            const mode = typeof stat?.mode === 'number' ? stat.mode : null
            const size = typeof stat?.size === 'number' ? stat.size : null
            const isDirectory = typeof stat?.isDirectory === 'boolean'
                ? stat.isDirectory
                : ((mode ?? 0) & 0o170000) === 0o040000

            return { isDirectory, mode, size }
        } catch {
            return null
        }
    }

    private async getRemoteStat (): Promise<{ mtime: number|null, size: number|null }> {
        const sftp: any = await this.getSftp()
        if (!sftp?.stat) {
            return { mtime: null, size: null }
        }

        const st: any = await sftp.stat(this.path)

        let mtime: number|null = null
        if (typeof st?.mtime === 'number') {
            mtime = st.mtime
        } else if (st?.modified instanceof Date) {
            mtime = Math.floor(st.modified.getTime() / 1000)
        }

        let size: number|null = null
        if (typeof st?.size === 'number') {
            size = st.size
        }

        return { mtime, size }
    }

    private async getRemoteMtime (): Promise<number|null> {
        return (await this.getRemoteStat()).mtime
    }

    private async readRemoteFileBuffer (): Promise<Buffer> {
        return this.readRemoteFileBufferAt(this.path, { maxBytes: LARGE_FILE_REJECT_SIZE })
    }

    private async readRemoteFileBufferAt (remotePath: string, options?: { maxBytes?: number }): Promise<Buffer> {
        const sftp = await this.getSftp()
        const russh = getRussh()

        const handle = await sftp.open(remotePath, russh.OPEN_READ)
        try {
            const chunks: Buffer[] = []
            let total = 0
            while (true) {
                const chunk = await handle.read()
                if (!chunk.length) {
                    break
                }
                const buf = Buffer.from(chunk)
                chunks.push(buf)
                total += buf.length
                if (options?.maxBytes && total > options.maxBytes) {
                    throw new Error('File is too large to open')
                }
            }
            return Buffer.concat(chunks)
        } finally {
            await handle.close().catch(() => null)
        }
    }

    private async writeRemoteFileBuffer (contents: Buffer): Promise<void> {
        await this.writeRemoteFileBufferAt(this.path, contents, this.mode ?? null)
    }

    private async writeRemoteFileBufferAt (remotePath: string, contents: Buffer, mode?: number|null): Promise<void> {
        const sftp = await this.getSftp()
        const russh = getRussh()

        const tempPath = `${remotePath}.tabby-online-edit`
        let handle: any = null
        try {
            handle = await sftp.open(tempPath, russh.OPEN_WRITE | russh.OPEN_CREATE)
            await handle.write(contents)
            await handle.close()
            handle = null

            await sftp.unlink(remotePath).catch(() => null)
            await sftp.rename(tempPath, remotePath)
            if (mode !== null && mode !== undefined) {
                await sftp.chmod(remotePath, mode)
            }
        } catch (e) {
            await sftp.unlink(tempPath).catch(() => null)
            throw e
        } finally {
            await handle?.close?.().catch(() => null)
        }
    }
}
