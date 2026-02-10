import { Injectable } from '@angular/core'
import { AppService, NotificationsService } from 'tabby-core'
import { BaseTerminalTabComponent, SessionMiddleware, TerminalDecorator } from 'tabby-terminal'

import { RemoteEditorTabComponent } from './remoteEditorTab.component'

const CWD_START = '__TABBY_EDIT_CWD__'
const CWD_END = '__TABBY_EDIT_CWD_END__'
const EDIT_CMD_RE = /^(mzedit)\s+(.+)$/i
const CWD_TIMEOUT_MS = 5000

class EditCommandMiddleware extends SessionMiddleware {
    private lineBuffer = ''
    private pendingPath: string | null = null
    private cwdProbing = false
    private outputBuffer = ''
    private cwdTimer: ReturnType<typeof setTimeout> | null = null

    constructor (
        private sshSession: any,
        private app: AppService,
        private notifications: NotificationsService,
    ) {
        super()
    }

    feedFromTerminal (data: Buffer): void {
        if (this.cwdProbing) {
            return
        }

        const str = data.toString('utf-8')

        if (str.length === 1) {
            const ch = str
            if (ch === '\r' || ch === '\n') {
                if (this.tryIntercept()) {
                    return
                }
                this.lineBuffer = ''
            } else if (ch === '\x7f' || ch === '\x08') {
                this.lineBuffer = this.lineBuffer.slice(0, -1)
            } else if (ch === '\x03' || ch === '\x15') {
                this.lineBuffer = ''
            } else if (ch >= ' ') {
                this.lineBuffer += ch
            }
            this.outputToSession.next(data)
            return
        }

        let intercepted = false
        for (const ch of str) {
            if (ch === '\r' || ch === '\n') {
                if (this.tryIntercept()) {
                    intercepted = true
                    break
                }
                this.lineBuffer = ''
            } else if (ch === '\x7f' || ch === '\x08') {
                this.lineBuffer = this.lineBuffer.slice(0, -1)
            } else if (ch === '\x03' || ch === '\x15') {
                this.lineBuffer = ''
            } else if (ch >= ' ') {
                this.lineBuffer += ch
            }
        }

        if (!intercepted) {
            this.outputToSession.next(data)
        }
    }

    feedFromSession (data: Buffer): void {
        if (!this.cwdProbing) {
            this.outputToTerminal.next(data)
            return
        }

        this.outputBuffer += data.toString('utf-8')

        const startIdx = this.outputBuffer.indexOf(CWD_START)
        const endIdx = this.outputBuffer.indexOf(CWD_END)

        if (startIdx >= 0 && endIdx > startIdx) {
            const cwd = this.outputBuffer
                .slice(startIdx + CWD_START.length, endIdx)
                .trim()

            const afterMarker = this.outputBuffer.slice(endIdx + CWD_END.length)

            this.finishCwdProbe()

            const resolved = this.resolvePath(cwd, this.pendingPath!)
            this.pendingPath = null
            this.openEditor(resolved)

            const trailing = afterMarker.replace(/^[\r\n]+/, '')
            if (trailing.length > 0) {
                this.outputToTerminal.next(Buffer.from(trailing))
            }
        }
    }

    private tryIntercept (): boolean {
        const line = this.lineBuffer.trim()
        this.lineBuffer = ''

        const match = EDIT_CMD_RE.exec(line)
        if (!match) {
            return false
        }

        const rawPath = match[2].trim()

        // Clear the typed command from the remote shell's readline.
        this.outputToSession.next(Buffer.from('\x15\n'))

        if (rawPath.startsWith('/')) {
            this.openEditor(rawPath)
            return true
        }

        if (rawPath.startsWith('~/') || rawPath === '~') {
            this.probeCwd(rawPath)
            return true
        }

        this.probeCwd(rawPath)
        return true
    }

    private probeCwd (rawPath: string): void {
        this.pendingPath = rawPath
        this.cwdProbing = true
        this.outputBuffer = ''

        // Split markers via a shell variable so the complete marker string never
        // appears in the echoed command text — only in the expanded output.
        const escaped = rawPath.replace(/'/g, "'\\''")
        const cmd = `_mze_p=__TABBY_EDIT; echo "\${_mze_p}_CWD__$(realpath -m '${escaped}' 2>/dev/null || readlink -f '${escaped}' 2>/dev/null || echo '${escaped}')\${_mze_p}_CWD_END__"\n`
        this.outputToSession.next(Buffer.from(cmd))

        this.cwdTimer = setTimeout(() => {
            if (!this.cwdProbing) {
                return
            }
            this.notifications.error('Failed to resolve working directory (timeout)')
            this.finishCwdProbe()
            this.pendingPath = null
        }, CWD_TIMEOUT_MS)
    }

    private finishCwdProbe (): void {
        this.cwdProbing = false
        this.outputBuffer = ''
        if (this.cwdTimer !== null) {
            clearTimeout(this.cwdTimer)
            this.cwdTimer = null
        }
    }

    private resolvePath (resolved: string, _rawPath: string): string {
        // The shell probe already resolved the path via realpath/readlink.
        return this.normalizePath(resolved)
    }

    private normalizePath (p: string): string {
        const parts = p.split('/')
        const result: string[] = []
        for (const part of parts) {
            if (part === '..') {
                if (result.length > 1) {
                    result.pop()
                }
            } else if (part !== '.' && part !== '') {
                result.push(part)
            }
        }
        return '/' + result.join('/')
    }

    private openEditor (fullPath: string): void {
        const name = fullPath.split('/').pop() ?? fullPath
        try {
            this.sshSession.ref?.()
            this.app.openNewTabRaw({
                type: RemoteEditorTabComponent,
                inputs: {
                    sshSession: this.sshSession,
                    path: fullPath,
                    name,
                },
            })
        } catch (e: any) {
            this.sshSession.unref?.()
            this.notifications.error(e?.message ?? 'Failed to open editor')
        }
    }
}

@Injectable()
export class EditCommandDecorator extends TerminalDecorator {
    constructor (
        private app: AppService,
        private notifications: NotificationsService,
    ) {
        super()
    }

    attach (tab: BaseTerminalTabComponent<any>): void {
        console.log('[mzedit] decorator.attach() called')
        setTimeout(() => {
            try {
                this.attachMiddleware(tab)
                const sub = tab.sessionChanged$.subscribe(() => {
                    console.log('[mzedit] sessionChanged$ fired')
                    try {
                        this.attachMiddleware(tab)
                    } catch (e: any) {
                        console.error('[mzedit] middleware attach failed:', e)
                    }
                })
                this.subscribeUntilDetached(tab, sub)
            } catch (e: any) {
                console.error('[mzedit] decorator attach failed:', e)
            }
        })
    }

    private attachMiddleware (tab: BaseTerminalTabComponent<any>): void {
        if (!tab.session) {
            console.log('[mzedit] attachMiddleware: no session')
            return
        }
        const sshSession: any = (tab as any).sshSession
        if (!sshSession?.openSFTP) {
            console.log('[mzedit] attachMiddleware: no sshSession or openSFTP', !!sshSession)
            return
        }
        const existing = (tab.session.middleware as any).stack?.some?.(
            (m: any) => m instanceof EditCommandMiddleware,
        )
        if (existing) {
            console.log('[mzedit] attachMiddleware: already attached')
            return
        }
        const mw = new EditCommandMiddleware(sshSession, this.app, this.notifications)
        tab.session.middleware.unshift(mw)
        console.log('[mzedit] middleware attached successfully')
    }
}
