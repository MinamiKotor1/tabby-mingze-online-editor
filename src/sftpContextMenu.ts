import { Injectable } from '@angular/core'
import { AppService, MenuItemOptions, NotificationsService } from 'tabby-core'
import { SFTPContextMenuItemProvider, SFTPFile, SFTPPanelComponent } from 'tabby-ssh'

import { RemoteEditorTabComponent } from './remoteEditorTab.component'

@Injectable()
export class EditInTabbySFTPContextMenu extends SFTPContextMenuItemProvider {
    weight = 5

    constructor (
        private app: AppService,
        private notifications: NotificationsService,
    ) {
        super()
    }

    async getItems (item: SFTPFile, panel: SFTPPanelComponent): Promise<MenuItemOptions[]> {
        if (item.isDirectory) {
            return []
        }

        return [
            {
                label: '在 Tabby 中编辑',
                click: () => this.openEditorTab(item, panel),
            },
        ]
    }

    private openEditorTab (item: SFTPFile, panel: SFTPPanelComponent): void {
        // SSHSession isn't exported from tabby-ssh public API, but the runtime object has ref/unref.
        const sshSession: any = (panel as any).session
        if (!sshSession?.openSFTP) {
            this.notifications.error('没有可用于编辑的 SSH 会话')
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
            this.notifications.error(e?.message ?? '打开编辑器失败')
        }
    }
}
