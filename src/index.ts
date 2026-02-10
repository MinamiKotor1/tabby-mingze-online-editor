// Monaco workers/assets are loaded relative to webpack's public path.
// Tabby loads plugins via Node `require()` (no <script src="...">), so we must set it.
// Use a file:// URL so Worker() can resolve it on Windows/macOS/Linux.
declare let __webpack_public_path__: string
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { pathToFileURL } = require('url')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path')
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
__webpack_public_path__ = pathToFileURL(__dirname + path.sep).toString()

import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import TabbyCoreModule from 'tabby-core'
import { SFTPContextMenuItemProvider } from 'tabby-ssh'

import { EditInTabbySFTPContextMenu } from './sftpContextMenu'
import { RemoteEditorTabComponent } from './remoteEditorTab.component'

@NgModule({
    imports: [
        CommonModule,
        TabbyCoreModule,
    ],
    declarations: [
        RemoteEditorTabComponent,
    ],
    providers: [
        { provide: SFTPContextMenuItemProvider, useClass: EditInTabbySFTPContextMenu, multi: true },
    ],
})
export default class MingzeOnlineEditorModule { }
