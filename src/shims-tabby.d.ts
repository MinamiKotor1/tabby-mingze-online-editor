// Minimal typings so this plugin can be built without installing Tabby's internal packages.
// At runtime Tabby provides these modules.

declare module '@angular/core' {
    export const Injectable: any
    export const Component: any
    export const NgModule: any
    export const ViewChild: any
    export class Injector { }
    export class ElementRef<T = any> { nativeElement: T }
    export class ChangeDetectorRef { detectChanges (): void }
}

declare module '@angular/common' {
    export const CommonModule: any
}

declare module 'tabby-core' {
    const TabbyCoreModule: any
    export default TabbyCoreModule

    export interface MenuItemOptions {
        label?: string
        click?: () => void
        type?: string
        checked?: boolean
        commandLabel?: string
        sublabel?: string
    }

    export class AppService {
        openNewTabRaw<T = any> (params: any): T
    }

    export class NotificationsService {
        error (message: string): void
        notice (message: string): void
    }

    export class PlatformService {
        showMessageBox (options: any): Promise<{ response: number }>
        popupContextMenu (menu: MenuItemOptions[], event?: MouseEvent): void
    }

    export class ThemesService {
        themeChanged$: any
    }

    export class BaseTabComponent {
        title: string
        icon: string | null
        constructor (injector: any)
        setTitle (title: string): void
        destroy (skipDestroyedEvent?: boolean): void
        ngOnDestroy (): void
        canClose (): Promise<boolean>
    }
}

declare module 'tabby-ssh' {
    export interface SFTPFile {
        name: string
        fullPath: string
        isDirectory: boolean
        mode: number
        size: number
    }

    export class SFTPPanelComponent {
        session: any
        sftp: any
    }

    export abstract class SFTPContextMenuItemProvider {
        weight: number
        abstract getItems (item: SFTPFile, panel: SFTPPanelComponent): Promise<any[]>
    }

    export class SFTPSession {
        stat (path: string): Promise<any>
        readdir (path: string): Promise<SFTPFile[]>
        open (path: string, mode: number): Promise<any>
        mkdir (path: string): Promise<void>
        rmdir (path: string): Promise<void>
        unlink (path: string): Promise<void>
        rename (oldPath: string, newPath: string): Promise<void>
        chmod (path: string, mode: any): Promise<void>
    }
}

declare module 'tabby-terminal' {
    export abstract class TerminalDecorator {
        attach (terminal: BaseTerminalTabComponent<any>): void
        detach (terminal: BaseTerminalTabComponent<any>): void
        protected subscribeUntilDetached (terminal: BaseTerminalTabComponent<any>, subscription?: any): void
    }

    export abstract class BaseTerminalTabComponent<P = any> {
        session: BaseSession | null
        sessionChanged$: any
        input$: any
    }

    export class BaseSession {
        readonly middleware: SessionMiddlewareStack
    }

    export class SessionMiddleware {
        protected outputToSession: { next (data: Buffer): void, complete (): void }
        protected outputToTerminal: { next (data: Buffer): void, complete (): void }
        feedFromSession (data: Buffer): void
        feedFromTerminal (data: Buffer): void
        close (): void
    }

    export class SessionMiddlewareStack extends SessionMiddleware {
        push (middleware: SessionMiddleware): void
        unshift (middleware: SessionMiddleware): void
        remove (middleware: SessionMiddleware): void
    }
}
