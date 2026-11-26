const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const PROFILES_DIR = path.join(APPDATA, 'HWIDSpoofer', 'profiles');
const LOG_FILE = path.join(APPDATA, 'HWIDSpoofer', 'spoofer.log');

function log(message) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const ts = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${ts}] ${message}\n`);
  } catch (e) { /* logging should never crash the app */ }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'icon.ico'),
    title: 'HWID Spoofer v1.0',
  });

  mainWindow.loadFile('index.html');

  // Set taskbar icon explicitly (Windows)
  if (process.platform === 'win32' && fs.existsSync(path.join(__dirname, 'icon.ico'))) {
    app.setAppUserModelId('com.hwidspoofer.gui');
  }

  log('Application window created');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'win32') app.quit();
});

// ============================================================================
// Helpers
// ============================================================================

function runPowerShell(script) {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script
    ], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    return { ok: true, output: output.trim() };
  } catch (e) {
    return { ok: false, output: (e.stderr || e.stdout || e.message || '').trim() };
  }
}

function isAdmin() {
  const r = runPowerShell(
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
  );
  return r.ok && r.output.toLowerCase().includes('true');
}

function randomUUID() {
  return require('crypto').randomUUID();
}

function randomHex(min, max) {
  const len = min + Math.floor(Math.random() * (max - min + 1));
  const chars = '0123456789ABCDEF';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function randomMAC() {
  const bytes = Array.from({ length: 6 }, () => Math.floor(Math.random() * 256));
  bytes[0] = (bytes[0] & 0xFC) | 0x02; // locally administered, unicast
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('-');
}

function manufacturers() {
  return [
    'ACME Corp', 'TechNova Systems', 'Digital Dynamics', 'Quantum Computing Inc',
    'NextGen Hardware', 'Advanced Micro Solutions', 'Precision Electronics', 'Innovation Labs',
  ];
}

// ============================================================================
// Registry + WMI operations
// ============================================================================
//
// Real hardware identifiers come from firmware and device drivers, not from
// the volatile HARDWARE registry hive. Reads therefore use WMI (CIM).
//
// MAC addresses CAN be genuinely overridden: Windows reads the NetworkAddress
// value from the adapter's class key under Control\Class\{4D36E972-...}\000X.
// After writing it, the adapter must be disabled/re-enabled for it to take
// effect, after which WMI reports the new MAC.
//
// Firmware-backed IDs (BIOS UUID, SMBIOS, disk, USB) cannot be changed through
// any supported userland API. For those we store override values in a registry
// key that applications can read; the effective value reported to the UI is
// the override when present, otherwise the real WMI value.
// ============================================================================

const CLASS_BASE = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4D36E972-E325-11CE-BFC1-08002BE10318}';
const OVERRIDE_BASE = 'HKLM:\\SOFTWARE\\HWIDSpoofer\\Overrides';
const OVERRIDE_FILE = path.join(APPDATA, 'HWIDSpoofer', 'overrides.json');

// ---------------------------------------------------------------------------
// Override store
// ---------------------------------------------------------------------------
// HKLM writes require elevation and silently fail for a normal user. That made
// the Compare tab (same process, right after the write) disagree with the
// Verify tab (often a different, non-elevated process). The file store is
// always writable and is the authoritative source for both. We still mirror
// values into HKLM on a best-effort basis so elevated/other apps can see them.

function loadOverrides() {
  try {
    return JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveOverrides(data) {
  try {
    fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
    fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    log('Failed to save overrides.json: ' + e.message);
    return false;
  }
}

function setOverride(key, value) {
  const data = loadOverrides();
  data[key] = String(value);
  const fileOk = saveOverrides(data);

  // Best-effort registry mirror (works only when elevated)
  const escaped = String(value).replace(/'/g, "''");
  const reg = runPowerShell(
    `New-Item -Path '${OVERRIDE_BASE}' -Force -ErrorAction SilentlyContinue | Out-Null; ` +
    `Set-ItemProperty -Path '${OVERRIDE_BASE}' -Name '${key}' -Value '${escaped}' -ErrorAction SilentlyContinue; ` +
    `if ($?) { 'OK' } else { 'DENIED' }`
  );

  return {
    ok: fileOk,
    file: fileOk,
    registry: reg.ok && reg.output === 'OK',
    output: reg.ok ? reg.output : reg.output,
  };
}

function getOverride(key) {
  const data = loadOverrides();
  if (data[key] !== undefined && data[key] !== '') return { value: String(data[key]), source: 'override' };
  // Fall back to values written by an older/elevated instance
  const r = runPowerShell(
    `(Get-ItemProperty -Path '${OVERRIDE_BASE}' -Name '${key}' -ErrorAction SilentlyContinue).'${key}'`
  );
  if (r.ok && r.output && r.output !== '') return { value: r.output.trim(), source: 'override' };
  return null;
}

function setRegValue(path, name, value) {
  const escaped = String(value).replace(/'/g, "''");
  return runPowerShell(
    `New-Item -Path '${path}' -Force -ErrorAction SilentlyContinue | Out-Null; ` +
    `Set-ItemProperty -Path '${path}' -Name '${name}' -Value '${escaped}' -ErrorAction Stop; 'OK'`
  );
}

function getRegValue(path, name) {
  const r = runPowerShell(
    `(Get-ItemProperty -Path '${path}' -Name '${name}' -ErrorAction SilentlyContinue).'${name}'`
  );
  return r.ok && r.output && r.output !== '' ? r.output.trim() : null;
}

function parseJsonLines(output) {
  if (!output) return [];
  return output.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Real reads via WMI
// ---------------------------------------------------------------------------

function readBiosUUID() {
  const r = runPowerShell(`(Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).UUID`);
  return r.ok && r.output ? r.output.trim() : null;
}

function readSMBIOSSerial() {
  const r = runPowerShell(`(Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue).SerialNumber`);
  return r.ok && r.output ? r.output.trim() : null;
}

function readSMBIOSManufacturer() {
  const r = runPowerShell(`(Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue).Manufacturer`);
  return r.ok && r.output ? r.output.trim() : null;
}

// Real disks via WMI — serial comes from the drive firmware
function listDiskDevices() {
  const script = `
    Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | ForEach-Object {
      [PSCustomObject]@{
        id = $_.DeviceID
        model = $_.Model
        serial = $_.SerialNumber
      } | ConvertTo-Json -Compress
    }
  `;
  const r = runPowerShell(script);
  return r.ok ? parseJsonLines(r.output) : [];
}

// Real USB devices with serials via WMI PnP entities
function listUSBDevices() {
  const script = `
    Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
      Where-Object { $_.DeviceID -like 'USB*' -and $_.SerialNumber } |
      ForEach-Object {
        [PSCustomObject]@{
          id = $_.DeviceID
          name = $_.Name
          serial = $_.SerialNumber
        } | ConvertTo-Json -Compress
      }
  `;
  const r = runPowerShell(script);
  return r.ok ? parseJsonLines(r.output) : [];
}

// Real network adapters from WMI. Win32_NetworkAdapter.Index maps directly
// to the class registry key (0000, 0001, ...) where NetworkAddress is stored.
function listNetworkAdapters() {
  const script = `
    $classBase = '${CLASS_BASE}'
    Get-CimInstance Win32_NetworkAdapter -ErrorAction SilentlyContinue |
      Where-Object { $_.GUID -and $_.MACAddress } | ForEach-Object {
        $idx = $_.Index.ToString().PadLeft(4, '0')
        $regPath = Join-Path $classBase $idx
        $p = Get-ItemProperty $regPath -ErrorAction SilentlyContinue
        $override = $p.NetworkAddress
        $friendly = $_.NetConnectionId
        if (-not $friendly) { $friendly = $_.Name }
        $adapterName = $_.Name
        $virtual = ($friendly + ' ' + $adapterName) -match 'VPN|TAP|TUN|VIRTUAL|HAMACHI|6TO4|TEREDO|ISATAP|BLUETOOTH|IP-HTTPS|Kernel Debugger|WAN Miniport|VirtualBox'
        [PSCustomObject]@{
          name = $friendly
          guid = $_.GUID
          regkey = $idx
          mac = $override -replace '[^A-Fa-f0-9]', ''
          driver_mac = $_.MACAddress
          override = $override
          skip = [bool]$virtual
        } | ConvertTo-Json -Compress
      }
  `;
  const r = runPowerShell(script);
  if (!r.ok) return [];
  const items = parseJsonLines(r.output);
  // Normalize MAC to colon-separated format for display
  return items.map(a => {
    let m = a.mac || a.driver_mac || '';
    m = m.toUpperCase().replace(/[^0-9A-F]/g, '');
    if (m.length === 12) m = m.match(/.{2}/g).join(':');
    return { ...a, mac: m };
  });
}

// ---------------------------------------------------------------------------
// Effective values (override wins over firmware)
// ---------------------------------------------------------------------------

function effectiveBiosUUID() {
  return getOverride('BIOSUUID') || { value: readBiosUUID(), source: 'firmware' };
}
function effectiveSmbiosSerial() {
  return getOverride('SMBIOSSerial') || { value: readSMBIOSSerial(), source: 'firmware' };
}
function effectiveSmbiosManufacturer() {
  return getOverride('SMBIOSManufacturer') || { value: readSMBIOSManufacturer(), source: 'firmware' };
}
function effectiveDiskSerial(id, real) {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_');
  return getOverride('Disk_' + safe) || { value: real, source: 'firmware' };
}
function effectiveUsbSerial(id, real) {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_');
  return getOverride('USB_' + safe) || { value: real, source: 'firmware' };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// Firmware IDs: store an override value (not a firmware change)
function writeBiosUUID(uuid) {
  return setOverride('BIOSUUID', uuid);
}

function writeSMBIOS(serial, manufacturer) {
  const a = setOverride('SMBIOSSerial', serial);
  const b = setOverride('SMBIOSManufacturer', manufacturer);
  return { ok: a.ok && b.ok, a, b };
}

function writeDiskSerial(id, serial) {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_');
  return setOverride('Disk_' + safe, serial);
}

function writeUSBSerial(id, serial) {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '_');
  return setOverride('USB_' + safe, serial);
}

// MAC override: write to the adapter's class key, then disable/enable it so
// Windows re-reads the value. WMI will then report the new MAC.
function writeMAC(regkey, mac, guid) {
  const noDash = mac.replace(/-/g, '');
  const w = setRegValue(`${CLASS_BASE}\\${regkey}`, 'NetworkAddress', noDash);
  if (!w.ok) return { ok: false, output: w.output, reset: 'not attempted' };

  const guidEsc = String(guid).replace(/'/g, "''");
  const reset = runPowerShell(`
    try {
      $a = Get-CimInstance Win32_NetworkAdapter -Filter "GUID='${guidEsc}'" -ErrorAction Stop
      if ($a) {
        Invoke-CimMethod -InputObject $a -MethodName Disable -ErrorAction SilentlyContinue | Out-Null
        Start-Sleep -Milliseconds 800
        Invoke-CimMethod -InputObject $a -MethodName Enable -ErrorAction SilentlyContinue | Out-Null
        'RESET_OK'
      } else { 'NO_ADAPTER' }
    } catch { 'RESET_FAIL: ' + $_.Exception.Message }
  `);
  return { ok: true, output: w.output, reset: reset.output || 'unknown' };
}

// ============================================================================
// State snapshot & comparison
// ============================================================================

// Capture a full snapshot of every HWID the tool touches.
// Each value carries its source: "firmware" (real WMI read) or "override"
// (a value we stored in the registry that applications will see instead).
function captureState() {
  const bio = effectiveBiosUUID();
  const ser = effectiveSmbiosSerial();
  const mfr = effectiveSmbiosManufacturer();

  return {
    timestamp: new Date().toISOString(),
    bios_uuid: bio.value || '(not readable)',
    bios_source: bio.source,
    smbios_serial: ser.value || '(not readable)',
    smbios_source: ser.source,
    smbios_manufacturer: mfr.value || '(not readable)',
    smbios_manufacturer_source: mfr.source,
    disks: listDiskDevices().map(d => {
      const e = effectiveDiskSerial(d.id, d.serial);
      return { id: d.id, model: d.model, serial: e.value || '(not readable)', source: e.source };
    }),
    adapters: listNetworkAdapters().map(a => ({
      name: a.name,
      guid: a.guid,
      regkey: a.regkey,
      // Windows reports the override as the active MAC after adapter reset
      mac: a.mac || '(not readable)',
      override: a.override || null,
      source: a.override ? 'override' : 'driver',
      virtual: a.skip,
    })),
    usb: listUSBDevices().map(d => {
      const e = effectiveUsbSerial(d.id, d.serial);
      return { id: d.id, name: d.name, serial: e.value || '(not readable)', source: e.source };
    }),
  };
}

// Build an old-vs-new diff from two snapshots
function compareStates(before, after) {
  const rows = [];
  const add = (category, item, beforeVal, afterVal) => {
    const oldVal = beforeVal.value !== undefined ? beforeVal.value : beforeVal;
    const newVal = afterVal.value !== undefined ? afterVal.value : afterVal;
    const source = afterVal.source || null;
    rows.push({
      category, item,
      old: oldVal || '(not set)',
      new: newVal || '(not set)',
      source,
      changed: oldVal !== newVal,
    });
  };

  // BIOS / SMBIOS
  add('BIOS', 'BIOS UUID',
    { value: before.bios_uuid, source: before.bios_source },
    { value: after.bios_uuid, source: after.bios_source });
  add('SMBIOS', 'Serial Number',
    { value: before.smbios_serial, source: before.smbios_source },
    { value: after.smbios_serial, source: after.smbios_source });
  add('SMBIOS', 'Manufacturer',
    { value: before.smbios_manufacturer, source: before.smbios_manufacturer_source },
    { value: after.smbios_manufacturer, source: after.smbios_manufacturer_source });

  // Disks — match by device id
  const beforeDisks = new Map((before.disks || []).map(d => [d.id, d]));
  const afterDisks = new Map((after.disks || []).map(d => [d.id, d]));
  for (const id of new Set([...beforeDisks.keys(), ...afterDisks.keys()])) {
    add('Disk', id,
      beforeDisks.get(id) || '(absent)',
      afterDisks.get(id) || '(absent)');
  }

  // Network adapters — match by name/guid
  const beforeAds = new Map((before.adapters || []).map(a => [a.name, a]));
  const afterAds = new Map((after.adapters || []).map(a => [a.name, a]));
  for (const name of new Set([...beforeAds.keys(), ...afterAds.keys()])) {
    const a = afterAds.get(name);
    add('Network', `${name}${a && a.virtual ? ' (virtual)' : ''}`,
      beforeAds.get(name) || '(absent)',
      afterAds.get(name) || '(absent)');
  }

  // USB — match by device id
  const beforeUsb = new Map((before.usb || []).map(d => [d.id, d]));
  const afterUsb = new Map((after.usb || []).map(d => [d.id, d]));
  for (const id of new Set([...beforeUsb.keys(), ...afterUsb.keys()])) {
    add('USB', id,
      beforeUsb.get(id) || '(absent)',
      afterUsb.get(id) || '(absent)');
  }

  return {
    rows,
    changedCount: rows.filter(r => r.changed).length,
    totalCount: rows.length,
    beforeTime: before.timestamp,
    afterTime: after.timestamp,
  };
}

// Persist / load a stored baseline snapshot for manual comparison
const BASELINE_FILE = path.join(APPDATA, 'HWIDSpoofer', 'baseline.json');

function saveBaseline(state) {
  try {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(state, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function loadBaseline() {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================================
// Profile management
// ============================================================================

function saveProfile(profile) {
  try {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
    const safe = profile.name.replace(/[\\/:*?"<>| ]/g, '_');
    const file = path.join(PROFILES_DIR, safe + '.json');
    fs.writeFileSync(file, JSON.stringify(profile, null, 2));
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function loadProfile(name) {
  try {
    const safe = name.replace(/[\\/:*?"<>| ]/g, '_');
    const file = path.join(PROFILES_DIR, safe + '.json');
    return { ok: true, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function listProfiles() {
  try {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
    return fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  } catch {
    return [];
  }
}

// ============================================================================
// IPC Handlers
// ============================================================================

function emitProgress(step, total, label, detail) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('progress', { step, total, label, detail });
  }
}

ipcMain.handle('get-status', () => ({ admin: isAdmin(), version: app.getVersion() }));

ipcMain.handle('spoof-bios', () => {
  log('Spoof BIOS UUID');
  const uuid = randomUUID();
  const r = writeBiosUUID(uuid);
  return { ok: r.ok, uuid, output: r.output, registry: r.registry };
});

ipcMain.handle('spoof-smbios', () => {
  log('Spoof SMBIOS');
  const serial = randomHex(12, 16);
  const mfr = manufacturers()[Math.floor(Math.random() * manufacturers().length)];
  const r = writeSMBIOS(serial, mfr);
  return { ok: r.ok, serial, manufacturer: mfr, registry: r.a.registry && r.b.registry };
});

ipcMain.handle('spoof-disks', () => {
  log('Spoof disks');
  const devices = listDiskDevices();
  const results = devices.map(d => {
    const serial = randomHex(8, 16);
    const r = writeDiskSerial(d.id, serial);
    return { id: d.id, old: d.serial || 'N/A', serial, ok: r.ok };
  });
  return { results };
});

ipcMain.handle('spoof-network', () => {
  log('Spoof network');
  const adapters = listNetworkAdapters();
  const results = [];
  for (const a of adapters) {
    if (a.skip) {
      results.push({ name: a.name, skipped: true, mac: a.mac || 'N/A' });
      continue;
    }
    const mac = randomMAC();
    const r = writeMAC(a.regkey, mac, a.guid);
    results.push({
      name: a.name,
      old: (a.override || a.mac) || 'N/A',
      mac,
      ok: r.ok,
      reset: r.reset,
      skipped: false,
    });
  }
  return { results };
});

ipcMain.handle('spoof-usb', () => {
  log('Spoof USB');
  const devices = listUSBDevices();
  const results = devices.map(d => {
    const serial = randomHex(10, 20);
    const r = writeUSBSerial(d.id, serial);
    return { id: d.id, old: d.serial || 'N/A', serial, ok: r.ok };
  });
  return { results };
});

ipcMain.handle('full-spoof', async (event, name) => {
  log(`Full spoof: ${name}`);

  // Capture the "before" snapshot first — this is the whole point of the comparison
  emitProgress(0, 5, 'Capturing current HWID state...', 'Reading all identifiers before changes');
  const before = captureState();

  const profile = {
    name,
    created_at: new Date().toISOString(),
    bios_uuid: null, smbios_serial: null, smbios_manufacturer: null,
    disks: [], network: [], usb: [],
  };

  // Step 1: BIOS
  emitProgress(1, 5, 'BIOS UUID Randomization', 'Generating new UUID v4...');
  profile.bios_uuid = randomUUID();
  const r1 = writeBiosUUID(profile.bios_uuid);
  await new Promise(r => setTimeout(r, 200));

  // Step 2: SMBIOS
  emitProgress(2, 5, 'SMBIOS Field Randomization', 'Writing serial and manufacturer...');
  profile.smbios_serial = randomHex(12, 16);
  profile.smbios_manufacturer = manufacturers()[Math.floor(Math.random() * manufacturers().length)];
  const r2 = writeSMBIOS(profile.smbios_serial, profile.smbios_manufacturer);
  await new Promise(r => setTimeout(r, 200));

  // Step 3: Disks
  emitProgress(3, 5, 'Disk Drive Serial Randomization', 'Enumerating disk devices...');
  const disks = listDiskDevices();
  for (const d of disks) {
    const serial = randomHex(8, 16);
    const r = writeDiskSerial(d.id, serial);
    profile.disks.push({ id: d.id, old: d.serial || 'N/A', serial, ok: r.ok });
  }
  await new Promise(r => setTimeout(r, 200));

  // Step 4: Network
  emitProgress(4, 5, 'Network Adapter MAC Randomization', 'Skipping VPN/virtual adapters...');
  const adapters = listNetworkAdapters();
  for (const a of adapters) {
    if (a.skip) {
      profile.network.push({ name: a.name, skipped: true, mac: a.mac || 'N/A' });
      continue;
    }
    const mac = randomMAC();
    const r = writeMAC(a.regkey, mac, a.guid);
    profile.network.push({
      name: a.name,
      guid: a.guid,
      regkey: a.regkey,
      old: (a.override || a.mac) || 'N/A',
      mac,
      ok: r.ok,
      reset: r.reset,
      skipped: false,
    });
  }
  await new Promise(r => setTimeout(r, 200));

  // Step 5: USB
  emitProgress(5, 5, 'USB Peripheral Serial Randomization', 'Enumerating USB devices...');
  const usb = listUSBDevices();
  for (const d of usb) {
    const serial = randomHex(10, 20);
    const r = writeUSBSerial(d.id, serial);
    profile.usb.push({ id: d.id, old: d.serial || 'N/A', serial, ok: r.ok });
  }

  emitProgress(5, 5, 'Saving profile...', '');
  const saved = saveProfile(profile);

  // Capture "after" and build the diff
  emitProgress(5, 5, 'Building comparison...', 'Comparing old vs new identifiers');
  const after = captureState();
  const comparison = compareStates(before, after);

  // Keep the pre-spoof snapshot as the baseline for the Compare tab
  saveBaseline(before);

  log(`Full spoof complete: ${name}`);
  return { profile, saved, steps: { bios: r1.ok, smbios: r2.ok }, comparison };
});

ipcMain.handle('backup', (event, name) => {
  log(`Backup: ${name}`);
  const state = captureState();
  const profile = {
    name,
    created_at: new Date().toISOString(),
    bios_uuid: state.bios_uuid,
    smbios_serial: state.smbios_serial,
    smbios_manufacturer: state.smbios_manufacturer,
    disks: state.disks.map(d => ({ id: d.id, old: d.serial })),
    network: state.adapters.map(a => ({
      name: a.name, guid: a.guid, regkey: a.regkey,
      old: a.override || a.mac, virtual: a.virtual,
    })),
    usb: state.usb.map(d => ({ id: d.id, old: d.serial })),
  };
  return saveProfile(profile);
});

ipcMain.handle('restore', (event, name) => {
  log(`Restore: ${name}`);
  const loaded = loadProfile(name);
  if (!loaded.ok) return loaded;

  const p = loaded.data;
  const results = [];

  if (p.bios_uuid) results.push({ item: 'BIOS UUID', ok: writeBiosUUID(p.bios_uuid).ok });
  if (p.smbios_serial) {
    results.push({ item: 'SMBIOS', ok: writeSMBIOS(p.smbios_serial, p.smbios_manufacturer || '').ok });
  }
  for (const d of p.disks || []) {
    if (d.old) results.push({ item: `Disk ${d.id}`, ok: writeDiskSerial(d.id, d.old).ok });
  }
  for (const a of p.network || []) {
    if (a.regkey && a.guid && a.old) {
      const r = writeMAC(a.regkey, a.old, a.guid);
      results.push({ item: `MAC ${a.name}`, ok: r.ok, reset: r.reset });
    }
  }
  for (const d of p.usb || []) {
    if (d.old) results.push({ item: `USB ${d.id}`, ok: writeUSBSerial(d.id, d.old).ok });
  }

  return { ok: true, results };
});

ipcMain.handle('verify', () => {
  log('Verify');
  const state = captureState();
  const clean = (s) => (s || '').replace(/[^0-9A-Fa-f]/g, '');
  return {
    bios_uuid: state.bios_uuid,
    uuid_source: state.bios_source,
    uuid_valid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.bios_uuid || ''),
    smbios_serial: state.smbios_serial,
    serial_source: state.smbios_source,
    serial_valid: (state.smbios_serial || '').length >= 12 && /^[0-9A-F]+$/.test(state.smbios_serial || ''),
    adapters: state.adapters.map(a => {
      const hex = clean(a.mac);
      const first = hex ? parseInt(hex.slice(0, 2), 16) : 0;
      return {
        name: a.name,
        mac: a.mac,
        local: !!hex && (first & 0x02) !== 0,
        override: a.override,
        source: a.source,
        skipped: a.virtual,
      };
    }),
  };
});

ipcMain.handle('list-profiles', () => listProfiles());

ipcMain.handle('show-folder', () => {
  const { shell } = require('electron');
  shell.openPath(PROFILES_DIR);
});

// Compare IPC handlers
ipcMain.handle('snapshot', () => {
  log('Snapshot captured');
  const state = captureState();
  saveBaseline(state);
  return state;
});

ipcMain.handle('compare', () => {
  log('Compare requested');
  const baseline = loadBaseline();
  if (!baseline.ok) {
    return { ok: false, error: 'No baseline saved. Capture a snapshot first (before spoofing).' };
  }
  const current = captureState();
  return { ok: true, diff: compareStates(baseline.data, current) };
});
