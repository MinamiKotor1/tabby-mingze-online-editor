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
                label: 'Edit in Tabby',
                click: () => this.openEditorTab(item, panel),
            },
        ]
    }

    private openEditorTab (item: SFTPFile, panel: SFTPPanelComponent): void {
        // SSHSession isn't exported from tabby-ssh public API, but the runtime object has ref/unref.
        const sshSession: any = (panel as any).session
        if (!sshSession?.openSFTP) {
            this.notifications.error('No SSH session available for editing')
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
            this.notifications.error(e?.message ?? 'Failed to open editor')
        }
    }
}

