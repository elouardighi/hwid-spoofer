# HWID Spoofer

A Windows command-line tool that randomizes hardware identifiers to present a "new" machine profile.

## Features

- **BIOS UUID Randomization** - Generates a new UUID v4 written to the SMBIOS registry
- **SMBIOS Field Spoofing** - Changes serial number and manufacturer strings
- **Disk Drive Serial Spoofing** - Modifies volume and physical drive serial identifiers
- **MAC Address Randomization** - Randomizes MAC addresses for all physical network adapters (skips VPN/virtual adapters)
- **USB Peripheral Spoofing** - Changes USB device serial numbers and descriptors
- **Backup & Restore** - Save original identifiers and restore them later
- **Verification** - Check that spoofing was applied successfully
- **Detailed Logging** - All operations logged to `%APPDATA%\HWIDSpoofer\spoofer.log`
- **Profile Export/Import** - Profiles saved as JSON for reproducibility

## Building

```bash
cargo build --release
```

The executable will be at `target\release\hwid_spoofer.exe`.

## Usage

Run as Administrator (right-click → Run as administrator) for full functionality.

```
hwid_spoofer <command> [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `spoof [name]` | Run the full spoof sequence (all 5 steps) |
| `bios` | Spoof BIOS UUID only |
| `smbios` | Spoof SMBIOS fields only |
| `disks` | Spoof disk drive serials only |
| `network` | Spoof network MAC addresses only |
| `usb` | Spoof USB device serials only |
| `backup <name>` | Backup current hardware identifiers |
| `restore <name>` | Restore identifiers from a backup |
| `verify` | Verify current spoofing state |
| `list-profiles` | List all saved profiles |
| `help` | Show help |

### Example

```
hwid_spoofer backup original
hwid_spoofer spoof fresh_machine
hwid_spoofer verify
hwid_spoofer restore original
```

## Full Spoof Sequence

Running `hwid_spoofer spoof` performs these steps sequentially:

1. Randomizes BIOS UUID (UUID v4)
2. Randomizes SMBIOS serial number and manufacturer
3. Modifies disk drive volume serials and physical IDs
4. Randomizes MAC addresses (skipping VPN/TAP/TUN/virtual adapters)
5. Spoofes USB peripheral serials

A verification summary is displayed at the end, and a profile is saved automatically.

## Important Notes

- **Reboot recommended** after spoofing for all changes to take effect
- **Back up first** - Always run `backup` before spoofing so you can restore
- **Administrator privileges** required for writing to HKLM registry keys
- VPN adapters are automatically detected and skipped to avoid MAC conflicts
- Connect to a VPN after spoofing for a clean, unflagged IP address
- Some anti-cheat systems may detect registry-level spoofing - use at your own risk

## License

For educational purposes only. Use responsibly.
