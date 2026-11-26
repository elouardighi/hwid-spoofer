# HWID Spoofer - Electron GUI

A modern desktop GUI for the HWID Spoofer, built with [Electron](https://www.electronjs.org/).

## Features

- **Full Spoof Sequence** — One click runs all 5 steps with progress bar and live log
- **Individual Spoofing** — Spoof specific components separately
- **Compare Tab** — Old vs. new HWID table with source badges (firmware / override / driver)
- **Verify Tab** — Check UUID format, SMBIOS serial, and real MAC address status
- **Profiles** — Backup/restore with a saved profile list
- **Admin Badge** — Shows whether the app has administrator privileges

## How reads and writes work

Real hardware identifiers are read from **WMI (CIM)**, not from the volatile
`HARDWARE` registry hive:

| Identifier | Read source | Write mechanism |
|-----------|-------------|-----------------|
| BIOS UUID | `Win32_ComputerSystemProduct.UUID` | Registry override in `HKLM\SOFTWARE\HWIDSpoofer\Overrides` |
| SMBIOS serial / manufacturer | `Win32_BIOS` / `Win32_ComputerSystemProduct` | Registry override |
| Disk serial | `Win32_DiskDrive.SerialNumber` | Registry override |
| MAC address | `Win32_NetworkAdapter` + adapter class key | `NetworkAddress` in `Control\Class\{4D36E972-...}\000X`, then adapter disabled/re-enabled so Windows applies it |

The Compare tab shows a source badge on each row:
- **firmware** — real value read from WMI (cannot be changed from userland)
- **override** — value we stored in the registry that applications will see instead
- **driver** — real MAC reported by the network driver

Firmware-backed IDs (BIOS UUID, SMBIOS, disk, USB) **cannot be changed through any
supported userland API** — the override is stored in the registry and is visible to
applications that read it, but WMI/firmware still reports the original value.
MAC addresses are genuinely changed at the Windows networking level.

## Running

```bash
cd electron-app
npm install
npm start
```

Or run the built executable directly:

```
electron-app\node_modules\electron\dist\electron.exe .
```

For administrator privileges (recommended), right-click the executable → **Run as administrator**.

## Building a Standalone .exe

```bash
npm run build:win
```

This creates an NSIS installer in `electron-app\dist_final\`. The installer is configured to
request administrator elevation automatically (`requestedExecutionLevel: requireAdministrator`).

Overrides are stored in `%APPDATA%\HWIDSpoofer\overrides.json` (always writable), with a
best-effort mirror to `HKLM\SOFTWARE\HWIDSpoofer\Overrides` when running elevated. Both the
Compare and Verify tabs read this same store, so they always agree. Only MAC addresses are
genuinely changed at the OS level; firmware-backed IDs use an override value.

## Project Structure

```
electron-app/
├── package.json      # Electron config + build settings
├── main.js           # Main process: IPC handlers, PowerShell registry ops, profile management
├── preload.js        # Secure bridge (contextIsolation) between renderer and main
├── index.html        # UI layout and styles
├── renderer.js       # UI logic, tab handling, event listeners
└── node_modules/     # Electron + electron-builder
```

## UI Tabs

| Tab | Description |
|-----|-------------|
| **Full Spoof** | Enter profile name, click start, watch 5-step progress + summary |
| **Individual** | Buttons for BIOS, SMBIOS, disks, network, USB |
| **Verify** | Refreshes live status of all identifiers |
| **Profiles** | Backup, list, and restore saved profiles |

## Notes

- The app uses PowerShell commands under the hood to read/write Windows registry keys
- VPN/TAP/TUN/virtual adapters are automatically skipped during MAC randomization
- Logs are written to `%APPDATA%\HWIDSpoofer\spoofer.log`
- Profiles are stored as JSON in `%APPDATA%\HWIDSpoofer\profiles`
