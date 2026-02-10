import { Injectable } from '@angular/core'
import { AppService, NotificationsService } from 'tabby-core'
import { BaseTerminalTabComponent, SessionMiddleware, TerminalDecorator } from 'tabby-terminal'

import { RemoteEditorTabComponent } from './remoteEditorTab.component'

const OSC_OPEN = '\x1b]7770;'
const OSC_READY = '\x1b]7771;'
const OSC_TERM = '\x07'

class EditCommandMiddleware extends SessionMiddleware {
    private outputBuffer = ''
    private settingUp = true
    private setupTimer: ReturnType<typeof setTimeout> | null = null

    constructor (
        private sshSession: any,
        private app: AppService,
        private notifications: NotificationsService,
    ) {
        super()
    }

    init (): void {
        const fn = [
            ' mzedit(){',
            ' _p="$(realpath -m "$1" 2>/dev/null||readlink -f "$1" 2>/dev/null||echo "$1")";',
            "printf '\\033]7770;%s\\007' \"$_p\";",
            '};',
            "printf '\\033]7771;\\007'",
        ].join('')
        this.outputToSession.next(Buffer.from(fn + '\n'))

        this.setupTimer = setTimeout(() => {
            this.settingUp = false
            if (this.outputBuffer) {
                this.outputToTerminal.next(Buffer.from(this.outputBuffer))
                this.outputBuffer = ''
            }
        }, 3000)
    }

    feedFromSession (data: Buffer): void {
        this.outputBuffer += data.toString('utf-8')
        this.flush()
    }

    close (): void {
        if (this.setupTimer !== null) {
            clearTimeout(this.setupTimer)
            this.setupTimer = null
        }
        super.close()
    }

    private flush (): void {
        if (this.settingUp) {
            const readyMarker = OSC_READY + OSC_TERM
            const idx = this.outputBuffer.indexOf(readyMarker)
            if (idx < 0) {
                return
            }
            this.outputBuffer = this.outputBuffer.slice(idx + readyMarker.length)
            this.settingUp = false
            if (this.setupTimer !== null) {
                clearTimeout(this.setupTimer)
                this.setupTimer = null
            }
        }

        while (true) {
            const startIdx = this.outputBuffer.indexOf(OSC_OPEN)
            if (startIdx < 0) {
                if (this.outputBuffer) {
                    this.outputToTerminal.next(Buffer.from(this.outputBuffer))
                    this.outputBuffer = ''
                }
                return
            }

            const endIdx = this.outputBuffer.indexOf(OSC_TERM, startIdx + OSC_OPEN.length)
            if (endIdx < 0) {
                if (startIdx > 0) {
                    this.outputToTerminal.next(Buffer.from(this.outputBuffer.slice(0, startIdx)))
                    this.outputBuffer = this.outputBuffer.slice(startIdx)
                }
                return
            }

            if (startIdx > 0) {
                this.outputToTerminal.next(Buffer.from(this.outputBuffer.slice(0, startIdx)))
            }

            const fullPath = this.outputBuffer.slice(startIdx + OSC_OPEN.length, endIdx).trim()
            this.outputBuffer = this.outputBuffer.slice(endIdx + OSC_TERM.length)

            if (fullPath) {
                this.openEditor(fullPath)
            }
        }
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
        setTimeout(() => {
            try {
                this.attachMiddleware(tab)
                const sub = tab.sessionChanged$.subscribe(() => {
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
            return
        }
        const sshSession: any = (tab as any).sshSession
        if (!sshSession?.openSFTP) {
            return
        }
        const existing = (tab.session.middleware as any).stack?.some?.(
            (m: any) => m instanceof EditCommandMiddleware,
        )
        if (existing) {
            return
        }
        const mw = new EditCommandMiddleware(sshSession, this.app, this.notifications)
        tab.session.middleware.unshift(mw)
        mw.init()
    }
}
