import { Component, ElementRef, Injector, ViewChild } from '@angular/core'
import { BaseTabComponent, NotificationsService, PlatformService, ThemesService } from 'tabby-core'
import { SFTPSession } from 'tabby-ssh'

type Monaco = typeof import('monaco-editor/esm/vs/editor/editor.api')

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

    // JSON is provided by a dedicated language service.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('monaco-editor/esm/vs/language/json/monaco.contribution')
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
    if (base.endsWith('.go')) {
        return 'go'
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

    // When followTabbyTheme is on, darkMode is derived from Tabby's current UI colors.
    followTabbyTheme = true
    darkMode = false

    // Conflict resolution / diff view
    diffMode = false

    @ViewChild('editorHost', { static: true }) editorHost?: ElementRef<HTMLElement>

    private sftp?: SFTPSession
    private editor?: import('monaco-editor').editor.IStandaloneCodeEditor
    private diffEditor?: import('monaco-editor').editor.IStandaloneDiffEditor
    private diffOriginalModel?: import('monaco-editor').editor.ITextModel
    private diffModifiedModel?: import('monaco-editor').editor.ITextModel

    private settingValue = false
    private languageId = 'plaintext'
    private themeSubscription?: { unsubscribe?: () => void }

    // Recorded remote mtime (seconds) for conflict detection
    private remoteMtime: number|null = null

    constructor (
        injector: Injector,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private themes: ThemesService,
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

        this.status = 'Loading...'
        try {
            this.remoteMtime = await this.getRemoteMtime().catch(() => null)
            const text = await this.readRemoteFile()
            this.initEditorIfNeeded()
            this.setEditorValue(text)
            this.loading = false
            this.status = 'Ready'
        } catch (e: any) {
            this.loading = false
            this.status = 'Failed to load'
            this.notifications.error(e?.message ?? 'Failed to load file')
        }
    }

    ngOnDestroy (): void {
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

    getStatusBadgeClass (): string {
        const s = (this.status ?? '').toLowerCase()

        if (s.includes('conflict')) {
            return 'bg-warning text-dark'
        }
        if (s.includes('modified')) {
            return 'bg-warning text-dark'
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
                const remoteText = await this.readRemoteFile()
                this.showConflictDiff(remoteText, localText)
                return false
            }

            this.status = 'Saving...'
            await this.writeRemoteFile(localText)
            this.remoteMtime = await this.getRemoteMtime().catch(() => null)
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
            await this.writeRemoteFile(text)
            this.remoteMtime = await this.getRemoteMtime().catch(() => null)
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
            this.remoteMtime = await this.getRemoteMtime().catch(() => null)
            const remoteText = await this.readRemoteFile()
            this.exitDiffToEditor(remoteText)
            this.dirty = false
            this.status = 'Ready'
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
            this.editor.updateOptions({ readOnly: false })
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

    private async getRemoteMtime (): Promise<number|null> {
        const sftp: any = await this.getSftp()
        if (!sftp?.stat) {
            return null
        }

        const st: any = await sftp.stat(this.path)
        if (typeof st?.mtime === 'number') {
            return st.mtime
        }
        if (st?.modified instanceof Date) {
            return Math.floor(st.modified.getTime() / 1000)
        }
        return null
    }

    private async readRemoteFile (): Promise<string> {
        const sftp = await this.getSftp()
        const russh = getRussh()

        const handle = await sftp.open(this.path, russh.OPEN_READ)
        try {
            const chunks: Buffer[] = []
            while (true) {
                const chunk = await handle.read()
                if (!chunk.length) {
                    break
                }
                chunks.push(Buffer.from(chunk))
            }
            return Buffer.concat(chunks).toString('utf-8')
        } finally {
            await handle.close().catch(() => null)
        }
    }

    private async writeRemoteFile (contents: string): Promise<void> {
        const sftp = await this.getSftp()
        const russh = getRussh()

        const tempPath = `${this.path}.tabby-online-edit`
        let handle: any = null
        try {
            handle = await sftp.open(tempPath, russh.OPEN_WRITE | russh.OPEN_CREATE)
            await handle.write(Buffer.from(contents, 'utf-8'))
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
