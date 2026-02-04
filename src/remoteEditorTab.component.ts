import { Component, ElementRef, Injector, ViewChild } from '@angular/core'
import { BaseTabComponent, NotificationsService, PlatformService } from 'tabby-core'
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

@Component({
    selector: 'mingze-online-editor-tab',
    template: require('./remoteEditorTab.component.pug'),
    // Keep styles inline so we don't need a to-string loader for component CSS.
    styles: [`
        :host { display: block; height: 100%; width: 100%; }
        .min-vh-0 { min-height: 0; }
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

    darkMode = false

    @ViewChild('editorHost', { static: true }) editorHost?: ElementRef<HTMLElement>

    private sftp?: SFTPSession
    private editor?: import('monaco-editor').editor.IStandaloneCodeEditor
    private settingValue = false
    private languageId = 'plaintext'

    constructor (
        injector: Injector,
        private platform: PlatformService,
        private notifications: NotificationsService,
    ) {
        super(injector)
        this.setTitle('Editor')
        this.icon = 'fas fa-pen-to-square'
    }

    async ngOnInit (): Promise<void> {
        this.setTitle(this.name ?? this.path ?? 'Editor')
        this.darkMode = this.getStoredDarkMode()
        this.languageId = detectLanguageId(this.name ?? this.path ?? '')

        this.status = 'Loading...'
        try {
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
        this.editor?.dispose()
        this.editor = undefined
        this.sftp = undefined
        this.sshSession?.unref?.()
        super.ngOnDestroy()
    }

    toggleDarkMode (): void {
        this.darkMode = !this.darkMode
        this.storeDarkMode(this.darkMode)
        if (this.editor) {
            this.applyTheme()
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
        if (this.saving || this.loading) {
            return false
        }
        if (!this.editor) {
            return false
        }

        this.saving = true
        this.status = 'Saving...'
        try {
            await this.writeRemoteFile(this.editor.getValue())
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

    private applyTheme (): void {
        const monaco = getMonaco()
        monaco.editor.setTheme(this.darkMode ? 'vs-dark' : 'vs')
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
