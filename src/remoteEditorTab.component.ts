import { ChangeDetectorRef, Component, ElementRef, Injector, ViewChild } from '@angular/core'
import { AppService, BaseTabComponent, NotificationsService, PlatformService, ThemesService } from 'tabby-core'
import { SFTPSession } from 'tabby-ssh'

type Monaco = typeof import('monaco-editor/esm/vs/editor/editor.api')

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

function getMonaco (): Monaco {
    // Lazy-load so publicPath is already set.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('monaco-editor/esm/vs/editor/editor.api')
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

    // Advanced language services (formatting, completion, diagnostics).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/language/typescript/monaco.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/language/html/monaco.contribution')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/language/css/monaco.contribution')
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

    // Sidebar file tree
    sidebarVisible = true
    sidebarWidth = 200 // px
    currentDir = ''
    dirContents: SFTPFileItem[] = []
    expandedDirs: Set<string> = new Set()
    refreshingDirs: Set<string> = new Set()
    loadingDir = false
    dirLoadError: string|null = null

    @ViewChild('editorHost', { static: true }) editorHost?: ElementRef<HTMLElement>

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

    openEncodingMenu (event?: MouseEvent): void {
        if (this.openError || this.loading || this.saving || this.diffMode || (this.isBinary && !this.forceOpenBinary)) {
            return
        }

        const menu: any[] = this.encodings.map(enc => ({
            type: 'radio',
            label: enc.label,
            checked: this.encoding === enc.id,
            click: () => this.changeEncoding(enc.id),
        }))

        this.platform.popupContextMenu(menu, event)
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

    closeTab (): void {
        this.destroy()
    }

    async forceOpenBinaryFile (): Promise<void> {
        if (!this.isBinary || this.forceOpenBinary) {
            return
        }

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

    private async loadCurrentFile (opts: { onCancel: 'close'|'keep' }): Promise<boolean> {
        this.status = 'Loading...'
        try {
            this.loading = true
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
            this.loadedBuffer = buffer

            this.isBinary = isBinaryContent(buffer)
            if (this.isBinary && !this.forceOpenBinary) {
                this.status = 'Binary file'
                return true
            }

            this.detectAndApplyEncoding(buffer)
            const text = this.decodeBuffer(buffer, this.encoding)

            this.initEditorIfNeeded()
            this.applyLanguageToEditor()
            this.setEditorValue(text)
            this.status = this.readOnlyLargeFile ? 'Read-only: Large file' : 'Ready'
            return true
        } catch (e: any) {
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
            this.loadedBuffer = buffer
            this.isBinary = isBinaryContent(buffer)
            this.forceOpenBinary = false

            if (this.isBinary) {
                this.disposeDiffEditor()
                this.editorHost?.nativeElement && (this.editorHost.nativeElement.innerHTML = '')
                this.diffMode = false
                this.dirty = false
                this.status = 'Binary file'
                return
            }

            this.detectAndApplyEncoding(buffer)
            const remoteText = this.decodeBuffer(buffer, this.encoding)

            this.exitDiffToEditor(remoteText)
            this.dirty = false
            this.status = this.readOnlyLargeFile ? 'Read-only: Large file' : 'Ready'
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
        })

        this.editor.onDidChangeModelContent(() => {
            if (this.settingValue) {
                return
            }
            this.dirty = true
            this.status = 'Modified'
        })

        this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            this.save()
        })
    }

    private setEditorValue (text: string): void {
        if (!this.editor) {
            return
        }
        this.settingValue = true
        try {
            this.editor.setValue(text)
            this.dirty = false
            this.editor.updateOptions({ readOnly: this.readOnlyLargeFile })
        } finally {
            this.settingValue = false
        }
    }

    private showConflictDiff (remoteText: string, localText: string): void {
        if (!this.editorHost?.nativeElement) {
            throw new Error('Editor host element not ready')
        }

        const monaco = getMonaco()
        ensureMonacoLanguagesLoaded()
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('monaco-editor/min/vs/editor/editor.main.css')

        this.diffMode = true
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
        })

        this.diffEditor.setModel({
            original: this.diffOriginalModel,
            modified: this.diffModifiedModel,
        })

        this.diffEditor.getOriginalEditor().updateOptions({ readOnly: true })
        const modifiedEditor = this.diffEditor.getModifiedEditor()
        modifiedEditor.updateOptions({ readOnly: false })

        modifiedEditor.onDidChangeModelContent(() => {
            // Keep dirty state; conflict is still unresolved.
            this.dirty = true
            this.status = 'Conflict detected'
        })

        modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            this.notifications.notice('Resolve the conflict first')
        })
    }

    private exitDiffToEditor (text: string): void {
        if (!this.editorHost?.nativeElement) {
            return
        }

        this.disposeDiffEditor()
        this.editorHost.nativeElement.innerHTML = ''
        this.diffMode = false

        this.initEditorIfNeeded()
        this.setEditorValue(text)
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
        const sftp = await this.getSftp()
        const russh = getRussh()

        const handle = await sftp.open(this.path, russh.OPEN_READ)
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
                if (total > LARGE_FILE_REJECT_SIZE) {
                    throw new Error('File is too large to open')
                }
            }
            return Buffer.concat(chunks)
        } finally {
            await handle.close().catch(() => null)
        }
    }

    private async writeRemoteFileBuffer (contents: Buffer): Promise<void> {
        const sftp = await this.getSftp()
        const russh = getRussh()

        const tempPath = `${this.path}.tabby-online-edit`
        let handle: any = null
        try {
            handle = await sftp.open(tempPath, russh.OPEN_WRITE | russh.OPEN_CREATE)
            await handle.write(contents)
            await handle.close()
            handle = null

            await sftp.unlink(this.path).catch(() => null)
            await sftp.rename(tempPath, this.path)
            if (this.mode) {
                await sftp.chmod(this.path, this.mode)
            }
        } catch (e) {
            await sftp.unlink(tempPath).catch(() => null)
            throw e
        } finally {
            await handle?.close?.().catch(() => null)
        }
    }
}
