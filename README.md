# Tabby Mingze Online Editor

A Tabby plugin that adds an **"Edit in Tabby"** action to the SSH/SFTP file browser.

- Opens a new Tabby tab with a Monaco editor
- Reads/writes the remote file over SFTP (no manual download/upload step)

## Development

```bash
yarn install
yarn build
yarn watch
```

Notes:
- Tabby provides `tabby-core`, `tabby-ssh`, Angular, etc at runtime; this project does not install them.
- On Windows, build the plugin first, then copy/link the folder into Tabby's Plugins folder.

## Notes

- This is an MVP: assumes UTF-8 text files and does not handle large/binary files yet.
