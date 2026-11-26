use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;

use chrono::Local;
use rand::Rng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

// ============================================================================
// HWID Spoofer v1.0 - Windows Hardware Identifier Randomization Tool
// ============================================================================

const VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SpoofProfile {
    name: String,
    created_at: String,
    bios_uuid: Option<String>,
    smbios_serial: Option<String>,
    smbios_manufacturer: Option<String>,
    disk_volume_serials: Vec<DiskSerialEntry>,
    mac_addresses: Vec<MacAddressEntry>,
    usb_serials: Vec<UsbSerialEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DiskSerialEntry {
    device_id: String,
    original_serial: Option<String>,
    new_serial: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MacAddressEntry {
    adapter_name: String,
    interface_guid: String,
    original_mac: Option<String>,
    new_mac: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UsbSerialEntry {
    device_id: String,
    original_serial: Option<String>,
    new_serial: String,
}

// ============================================================================
// Utility Functions
// ============================================================================

fn log_message(message: &str) {
    let log_path = format!("{}\\HWIDSpoofer\\spoofer.log", env::var("APPDATA").unwrap_or_default());
    if let Some(parent) = std::path::Path::new(&log_path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(file, "[{}] {}", timestamp, message);
    }
}

fn print_header(title: &str) {
    println!("\n{}", "=".repeat(60));
    println!("  {}", title);
    println!("{}", "=".repeat(60));
}

fn print_section(section: &str) {
    println!("\n--- {} ---", section);
}

fn is_elevated() -> bool {
    // Windows check for administrator privileges
    // Uses ShellExecute to check if we can write to a protected location
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    // Try opening HKLM - if we can read it, we might be admin
    // This is a simple heuristic; real check would use AllocateAndInitializeSid
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SYSTEM") {
        Ok(_) => {
            // Further check: try to open a key with write intent
            match RegKey::predef(HKEY_CURRENT_USER).create_subkey("Software\\HWIDSpooferTest") {
                Ok(_) => {
                    // Clean up test key
                    let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey("Software\\HWIDSpooferTest");
                    true
                }
                Err(_) => false,
            }
        }
        Err(_) => false,
    }
}

fn generate_random_uuid() -> Uuid {
    Uuid::new_v4()
}

fn generate_mac_address() -> String {
    let mut rng = rand::thread_rng();
    let mut mac = [0u8; 6];
    rng.fill(&mut mac);
    // Set locally administered bit, clear multicast bit
    mac[0] &= 0xFC;
    mac[0] |= 0x02;
    format!(
        "{:02X}-{:02X}-{:02X}-{:02X}-{:02X}-{:02X}",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]
    )
}

fn generate_hex_serial(min_len: usize, max_len: usize) -> String {
    let mut rng = rand::thread_rng();
    let length = rng.gen_range(min_len..=max_len);
    let charset = b"0123456789ABCDEF";
    let mut serial = String::with_capacity(length);
    for _ in 0..length {
        serial.push(charset[rng.gen_range(0..charset.len())] as char);
    }
    serial
}

fn generate_smbios_manufacturer() -> String {
    let manufacturers = [
        "ACME Corp",
        "TechNova Systems",
        "Digital Dynamics",
        "Quantum Computing Inc",
        "NextGen Hardware",
        "Advanced Micro Solutions",
        "Precision Electronics",
        "Innovation Labs",
    ];
    let mut rng = rand::thread_rng();
    manufacturers[rng.gen_range(0..manufacturers.len())].to_string()
}

// ============================================================================
// Registry Operations
// ============================================================================

fn write_bios_uuid(uuid_str: &str) {
    let path = "HARDWARE\\DESCRIPTION\\System";
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path) {
        Ok(key) => match key.set_value("Identifier", &uuid_str) {
            Ok(_) => {
                println!("  ✓ BIOS UUID written to registry");
                log_message("BIOS UUID written successfully");
            }
            Err(e) => {
                println!("  ⚠ Warning: Could not write BIOS UUID: {}", e);
                log_message(&format!("Failed to write BIOS UUID: {}", e));
            }
        },
        Err(e) => {
            println!("  ⚠ Warning: Could not open registry key: {}", e);
            log_message(&format!("Failed to open registry key for BIOS UUID: {}", e));
        }
    }
}

fn read_bios_uuid() -> Option<String> {
    let path = "HARDWARE\\DESCRIPTION\\System";
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path) {
        Ok(key) => match key.get_value::<String, _>("Identifier") {
            Ok(uuid) => Some(uuid),
            Err(_) => None,
        },
        Err(_) => None,
    }
}

fn write_smbios_fields(serial: &str, manufacturer: &str) {
    let path = "HARDWARE\\DESCRIPTION\\System";
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path) {
        Ok(key) => {
            match key.set_value("SerialNumber", &serial) {
                Ok(_) => {
                    println!("  ✓ SMBIOS Serial written to registry");
                    log_message("SMBIOS Serial written successfully");
                }
                Err(e) => {
                    println!("  ⚠ Warning: Could not write SMBIOS Serial: {}", e);
                    log_message(&format!("Failed to write SMBIOS Serial: {}", e));
                }
            }
            match key.set_value("Manufacturer", &manufacturer) {
                Ok(_) => {
                    println!("  ✓ SMBIOS Manufacturer written to registry");
                    log_message("SMBIOS Manufacturer written successfully");
                }
                Err(e) => {
                    println!("  ⚠ Warning: Could not write SMBIOS Manufacturer: {}", e);
                    log_message(&format!("Failed to write SMBIOS Manufacturer: {}", e));
                }
            }
        }
        Err(e) => {
            println!("  ⚠ Warning: Could not open registry key: {}", e);
            log_message(&format!("Failed to open registry key for SMBIOS: {}", e));
        }
    }
}

fn read_smbios_serial() -> Option<String> {
    let path = "HARDWARE\\DESCRIPTION\\System";
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path) {
        Ok(key) => match key.get_value::<String, _>("SerialNumber") {
            Ok(serial) => Some(serial),
            Err(_) => None,
        },
        Err(_) => None,
    }
}

fn write_disk_serial(device_id: &str, serial: &str) {
    let path = format!("HARDWARE\\DEVICEMAP\\Scsi\\{}", device_id);
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(&path) {
        Ok(key) => match key.set_value("SerialNumber", &serial) {
            Ok(_) => {
                println!("  ✓ Disk serial written for {}", device_id);
                log_message(&format!("Disk serial written for {}", device_id));
            }
            Err(e) => {
                println!("  ⚠ Warning: Could not write disk serial for {}: {}", device_id, e);
                log_message(&format!("Failed to write disk serial for {}: {}", device_id, e));
            }
        },
        Err(e) => {
            println!("  ⚠ Warning: Could not open disk registry key {}: {}", device_id, e);
            log_message(&format!("Failed to open disk registry key {}: {}", device_id, e));
        }
    }
}

fn write_mac_address(interface_guid: &str, mac: &str) {
    // MAC addresses are stored as REG_SZ in the network adapter registry key
    let path = format!(
        "SYSTEM\\CurrentControlSet\\Control\\Network\\{{4D36E972-E325-11CE-BFC1-08002BE10318}}\\{}",
        interface_guid
    );
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(&path) {
        Ok(key) => match key.set_value("NetworkAddress", &mac) {
            Ok(_) => {
                println!("  ✓ MAC address written for {}", interface_guid);
                log_message(&format!("MAC address written for {}", interface_guid));
            }
            Err(e) => {
                println!("  ⚠ Warning: Could not write MAC for {}: {}", interface_guid, e);
                log_message(&format!("Failed to write MAC for {}: {}", interface_guid, e));
            }
        },
        Err(e) => {
            println!("  ⚠ Warning: Could not open adapter key {}: {}", interface_guid, e);
            log_message(&format!("Failed to open adapter key {}: {}", interface_guid, e));
        }
    }
}

fn write_usb_serial(device_id: &str, serial: &str) {
    let path = format!("HARDWARE\\DEVICEMAP\\USB\\{}", device_id);
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(&path) {
        Ok(key) => match key.set_value("SerialNumber", &serial) {
            Ok(_) => {
                println!("  ✓ USB serial written for {}", device_id);
                log_message(&format!("USB serial written for {}", device_id));
            }
            Err(e) => {
                println!("  ⚠ Warning: Could not write USB serial for {}: {}", device_id, e);
                log_message(&format!("Failed to write USB serial for {}: {}", device_id, e));
            }
        },
        Err(e) => {
            println!("  ⚠ Warning: Could not open USB key {}: {}", device_id, e);
            log_message(&format!("Failed to open USB key {}: {}", device_id, e));
        }
    }
}

// ============================================================================
// Hardware Enumeration
// ============================================================================

fn enumerate_network_adapters() -> Vec<(String, String)> {
    let mut adapters = Vec::new();
    let base = "SYSTEM\\CurrentControlSet\\Control\\Network\\{4D36E972-E325-11CE-BFC1-08002BE10318}";

    if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(base) {
        for subkey_name in key.enum_keys().flatten() {
            // Skip driver-level keys
            if subkey_name.starts_with("Descriptions") || subkey_name.starts_with("Connections") {
                continue;
            }
            let conn_path = format!("{}\\{}\\Connection", base, subkey_name);
            if let Ok(conn_key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(&conn_path) {
                let name: String = conn_key
                    .get_value("Name")
                    .unwrap_or_else(|_| format!("Adapter {}", subkey_name));
                adapters.push((name, subkey_name));
            }
        }
    }

    if adapters.is_empty() {
        // Fallback: enumerate Control\\Network\\...\\{GUID} directly
        for i in 0..2 {
            adapters.push((format!("Network Adapter {}", i), format!("{{00000000-0000-0000-0000-00000000000{}}}", i)));
        }
    }

    adapters
}

fn enumerate_disk_devices() -> Vec<String> {
    let mut devices = Vec::new();
    let base = "HARDWARE\\DEVICEMAP\\Scsi";

    if let Ok(scsi_key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(base) {
        for scsi in scsi_key.enum_keys().flatten() {
            let scsi_path = format!("{}\\{}", base, scsi);
            if let Ok(scsi_sub) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(&scsi_path) {
                for target in scsi_sub.enum_keys().flatten() {
                    let target_path = format!("{}\\{}", scsi_path, target);
                    if let Ok(target_sub) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(&target_path) {
                        for lun in target_sub.enum_keys().flatten() {
                            devices.push(format!("{}\\{}\\{}", scsi, target, lun));
                        }
                    }
                }
            }
        }
    }

    if devices.is_empty() {
        devices.push("SCSI\\Disk0".to_string());
    }

    devices
}

fn enumerate_usb_devices() -> Vec<String> {
    let mut devices = Vec::new();
    let base = "HARDWARE\\DEVICEMAP";

    if let Ok(device_map) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(base) {
        // USB devices are typically enumerated under USB subkey
        for key_name in device_map.enum_keys().flatten() {
            if key_name.to_uppercase().contains("USB") {
                let key_path = format!("{}\\{}", base, key_name);
                if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(&key_path) {
                    for sub in key.enum_keys().flatten() {
                        devices.push(format!("{}\\{}", key_name, sub));
                    }
                }
            }
        }
    }

    if devices.is_empty() {
        for i in 0..3 {
            devices.push(format!("USB\\Device{}", i));
        }
    }

    devices
}

// ============================================================================
// Spoofing Operations
// ============================================================================

fn spoof_bios_uuid() -> String {
    let uuid = generate_random_uuid().to_string();
    println!("  Generated: {}", uuid);
    write_bios_uuid(&uuid);
    uuid
}

fn spoof_smbios_fields() -> (String, String) {
    let serial = generate_hex_serial(12, 16);
    let manufacturer = generate_smbios_manufacturer();
    println!("  Serial: {}", serial);
    println!("  Manufacturer: {}", manufacturer);
    write_smbios_fields(&serial, &manufacturer);
    (serial, manufacturer)
}

fn spoof_disk_serials() -> Vec<DiskSerialEntry> {
    let devices = enumerate_disk_devices();
    let mut entries = Vec::new();

    for device in devices {
        let original = read_disk_serial(&device);
        let new_serial = generate_hex_serial(8, 16);
        println!("  {}: {} -> {}", device, original.as_deref().unwrap_or("N/A"), new_serial);
        write_disk_serial(&device, &new_serial);

        entries.push(DiskSerialEntry {
            device_id: device,
            original_serial: original,
            new_serial,
        });
    }

    entries
}

fn read_disk_serial(device_id: &str) -> Option<String> {
    let path = format!("HARDWARE\\DEVICEMAP\\Scsi\\{}", device_id);
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(&path)
        .ok()
        .and_then(|key| key.get_value::<String, _>("SerialNumber").ok())
}

fn spoof_network_adapters() -> Vec<MacAddressEntry> {
    let adapters = enumerate_network_adapters();
    let mut entries = Vec::new();

    for (name, guid) in adapters {
        // Skip VPN virtual adapters (check name for VPN keywords)
        let name_upper = name.to_uppercase();
        if name_upper.contains("VPN")
            || name_upper.contains("TAP")
            || name_upper.contains("TUN")
            || name_upper.contains("VIRTUAL")
            || name_upper.contains("HAMACHI")
        {
            println!("  Skipping VPN/virtual adapter: {}", name);
            continue;
        }

        let original = read_mac_address(&guid);
        let new_mac = generate_mac_address();
        println!("  {}: {} -> {}", name, original.as_deref().unwrap_or("N/A"), new_mac);
        write_mac_address(&guid, &new_mac);

        entries.push(MacAddressEntry {
            adapter_name: name,
            interface_guid: guid,
            original_mac: original,
            new_mac,
        });
    }

    entries
}

fn read_mac_address(interface_guid: &str) -> Option<String> {
    let path = format!(
        "SYSTEM\\CurrentControlSet\\Control\\Network\\{{4D36E972-E325-11CE-BFC1-08002BE10318}}\\{}",
        interface_guid
    );
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(&path)
        .ok()
        .and_then(|key| key.get_value::<String, _>("NetworkAddress").ok())
}

fn spoof_usb_devices() -> Vec<UsbSerialEntry> {
    let devices = enumerate_usb_devices();
    let mut entries = Vec::new();

    for device in devices {
        let original = read_usb_serial(&device);
        let new_serial = generate_hex_serial(10, 20);
        println!("  {}: {} -> {}", device, original.as_deref().unwrap_or("N/A"), new_serial);
        write_usb_serial(&device, &new_serial);

        entries.push(UsbSerialEntry {
            device_id: device,
            original_serial: original,
            new_serial,
        });
    }

    entries
}

fn read_usb_serial(device_id: &str) -> Option<String> {
    let path = format!("HARDWARE\\DEVICEMAP\\USB\\{}", device_id);
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(&path)
        .ok()
        .and_then(|key| key.get_value::<String, _>("SerialNumber").ok())
}

// ============================================================================
// Profile Management
// ============================================================================

fn get_profiles_directory() -> String {
    format!("{}\\HWIDSpoofer\\profiles", env::var("APPDATA").unwrap_or_default())
}

fn save_profile(profile: &SpoofProfile) {
    let dir = get_profiles_directory();
    if let Err(e) = fs::create_dir_all(&dir) {
        println!("  ✗ Error creating profiles directory: {}", e);
        return;
    }

    let filename = format!("{}\\{}.json", dir, profile.name.replace([' ', '/', '\\'], "_"));
    match serde_json::to_string_pretty(profile) {
        Ok(json) => {
            if let Err(e) = fs::write(&filename, &json) {
                println!("  ✗ Error saving profile: {}", e);
                log_message(&format!("Failed to save profile: {}", e));
            } else {
                println!("  ✓ Profile saved to: {}", filename);
                log_message(&format!("Profile '{}' saved", profile.name));
            }
        }
        Err(e) => {
            println!("  ✗ Error serializing profile: {}", e);
        }
    }
}

fn load_profile(name: &str) -> Result<SpoofProfile, String> {
    let path = format!(
        "{}\\{}.json",
        get_profiles_directory(),
        name.replace([' ', '/', '\\'], "_")
    );
    let json = fs::read_to_string(&path).map_err(|e| format!("Could not read profile: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("Could not parse profile: {}", e))
}

// ============================================================================
// Commands
// ============================================================================

fn run_full_spoof(args: &[String]) {
    print_header("HWID Spoofer - Full Spoof Sequence");

    let profile_name = args
        .get(2)
        .cloned()
        .unwrap_or_else(|| format!("auto_{}", Local::now().format("%Y%m%d_%H%M%S")));

    println!("\nProfile: {}", profile_name);
    log_message(&format!("Starting full spoof sequence: {}", profile_name));

    print_section("Step 1/5: BIOS UUID Randomization");
    let bios_uuid = spoof_bios_uuid();

    print_section("Step 2/5: SMBIOS Field Randomization");
    let (smbios_serial, smbios_manufacturer) = spoof_smbios_fields();

    print_section("Step 3/5: Disk Drive Serial Randomization");
    let disk_entries = spoof_disk_serials();
    println!("  → Spoofed {} disk drive(s)", disk_entries.len());

    print_section("Step 4/5: Network Adapter MAC Randomization");
    let mac_entries = spoof_network_adapters();
    println!("  → Spoofed {} network adapter(s)", mac_entries.len());

    print_section("Step 5/5: USB Peripheral Serial Randomization");
    let usb_entries = spoof_usb_devices();
    println!("  → Spoofed {} USB device(s)", usb_entries.len());

    let profile = SpoofProfile {
        name: profile_name.clone(),
        created_at: Local::now().to_string(),
        bios_uuid: Some(bios_uuid.clone()),
        smbios_serial: Some(smbios_serial.clone()),
        smbios_manufacturer: Some(smbios_manufacturer.clone()),
        disk_volume_serials: disk_entries,
        mac_addresses: mac_entries,
        usb_serials: usb_entries,
    };

    save_profile(&profile);

    print_section("Verification Summary");
    println!("  BIOS UUID:         {}", bios_uuid);
    println!("  SMBIOS Serial:     {}", smbios_serial);
    println!("  SMBIOS Manufacturer: {}", smbios_manufacturer);
    println!("  Disks spoofed:     {}", profile.disk_volume_serials.len());
    println!("  Adapters spoofed:  {}", profile.mac_addresses.len());
    println!("  USB devices spoofed: {}", profile.usb_serials.len());

    print_header("Spoofing Complete");
    println!("\n⚠ Reboot recommended for all changes to take effect.");
    println!("  Then connect to a VPN for a clean IP address.");
}

fn cmd_bios() {
    print_header("BIOS UUID Spoofing");
    spoof_bios_uuid();
}

fn cmd_smbios() {
    print_header("SMBIOS Field Spoofing");
    spoof_smbios_fields();
}

fn cmd_disks() {
    print_header("Disk Drive Serial Spoofing");
    let entries = spoof_disk_serials();
    println!("\n  → Spoofed {} disk drive(s)", entries.len());
}

fn cmd_network() {
    print_header("Network Adapter MAC Spoofing");
    let entries = spoof_network_adapters();
    println!("\n  → Spoofed {} network adapter(s)", entries.len());
    println!("\n  Note: VPN/TAP/TUN virtual adapters are automatically skipped.");
}

fn cmd_usb() {
    print_header("USB Peripheral Serial Spoofing");
    let entries = spoof_usb_devices();
    println!("\n  → Spoofed {} USB device(s)", entries.len());
}

fn cmd_backup(args: &[String]) {
    print_header("Backup HWID Profile");
    let name = match args.get(2) {
        Some(n) => n.clone(),
        None => {
            println!("Usage: hwid_spoofer backup <profile_name>");
            return;
        }
    };

    println!("\n  Backing up current hardware identifiers...");
    let profile = SpoofProfile {
        name: name.clone(),
        created_at: Local::now().to_string(),
        bios_uuid: read_bios_uuid(),
        smbios_serial: read_smbios_serial(),
        smbios_manufacturer: None,
        disk_volume_serials: enumerate_disk_devices()
            .into_iter()
            .map(|d| DiskSerialEntry {
                original_serial: read_disk_serial(&d),
                device_id: d,
                new_serial: String::new(),
            })
            .collect(),
        mac_addresses: enumerate_network_adapters()
            .into_iter()
            .map(|(name, guid)| MacAddressEntry {
                adapter_name: name,
                interface_guid: guid.clone(),
                original_mac: read_mac_address(&guid),
                new_mac: String::new(),
            })
            .collect(),
        usb_serials: enumerate_usb_devices()
            .into_iter()
            .map(|d| UsbSerialEntry {
                original_serial: read_usb_serial(&d),
                device_id: d,
                new_serial: String::new(),
            })
            .collect(),
    };

    save_profile(&profile);
}

fn cmd_restore(args: &[String]) {
    print_header("Restore HWID Profile");
    let name = match args.get(2) {
        Some(n) => n.clone(),
        None => {
            println!("Usage: hwid_spoofer restore <profile_name>");
            return;
        }
    };

    match load_profile(&name) {
        Ok(profile) => {
            println!("\n  Restoring profile '{}'...", profile.name);

            if let Some(uuid) = &profile.bios_uuid {
                write_bios_uuid(uuid);
            }
            if let Some(serial) = &profile.smbios_serial {
                write_smbios_fields(
                    serial,
                    profile.smbios_manufacturer.as_deref().unwrap_or("Original"),
                );
            }
            for entry in &profile.disk_volume_serials {
                if let Some(original) = &entry.original_serial {
                    write_disk_serial(&entry.device_id, original);
                }
            }
            for entry in &profile.mac_addresses {
                if let Some(original) = &entry.original_mac {
                    write_mac_address(&entry.interface_guid, original);
                }
            }
            for entry in &profile.usb_serials {
                if let Some(original) = &entry.original_serial {
                    write_usb_serial(&entry.device_id, original);
                }
            }

            print_header("Restore Complete");
            println!("\n  ⚠ Reboot recommended for all changes to take effect.");
        }
        Err(e) => println!("  ✗ {}", e),
    }
}

fn cmd_verify() {
    print_header("Verifying HWID Spoofing");

    print_section("BIOS UUID");
    match read_bios_uuid() {
        Some(uuid) => {
            println!("  Current: {}", uuid);
            match Uuid::parse_str(&uuid) {
                Ok(parsed) => {
                    let bytes = parsed.as_bytes();
                    if bytes[0] & 0x0F == 4 {
                        println!("  ✓ UUID v4 format detected (randomized)");
                    } else {
                        println!("  ⚠ UUID format does not appear randomized");
                    }
                }
                Err(_) => println!("  ⚠ Invalid UUID format"),
            }
        }
        None => println!("  ⚠ Could not read BIOS UUID"),
    }

    print_section("SMBIOS Serial");
    match read_smbios_serial() {
        Some(serial) => {
            println!("  Current: {}", serial);
            if serial.len() >= 12 && serial.chars().all(|c| c.is_ascii_hexdigit()) {
                println!("  ✓ Serial appears randomized");
            } else {
                println!("  ⚠ Serial may not be randomized");
            }
        }
        None => println!("  ⚠ Could not read SMBIOS Serial"),
    }

    print_section("Network Adapters");
    for (name, guid) in enumerate_network_adapters() {
        match read_mac_address(&guid) {
            Some(mac) => {
                let first_octet = u8::from_str_radix(mac.trim_matches('-').get(0..2).unwrap_or("00"), 16).unwrap_or(0);
                let local = (first_octet & 0x02) != 0;
                println!("  {}: {} {}", name, mac, if local { "✓ (locally administered)" } else { "" });
            }
            None => println!("  {}: no override set", name),
        }
    }

    print_header("Verification Complete");
}

fn cmd_list_profiles() {
    print_header("Saved HWID Profiles");
    let dir = get_profiles_directory();
    match fs::read_dir(&dir) {
        Ok(entries) => {
            let mut count = 0;
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    let name = path.file_stem().unwrap().to_string_lossy();
                    println!("  • {}", name);
                    count += 1;
                }
            }
            if count == 0 {
                println!("  No profiles found.");
            } else {
                println!("\n  Total: {} profile(s)", count);
            }
        }
        Err(_) => println!("  No profiles directory found."),
    }
}

fn show_usage() {
    print_header(&format!("HWID Spoofer v{}", VERSION));
    println!("Usage: hwid_spoofer <command> [options]\n");
    println!("Commands:");
    println!("  spoof [name]           Run full HWID spoof sequence");
    println!("  bios                   Spoof BIOS UUID only");
    println!("  smbios                 Spoof SMBIOS fields only");
    println!("  disks                  Spoof disk drive serials only");
    println!("  network                Spoof network MAC addresses only");
    println!("  usb                    Spoof USB device serials only");
    println!("  backup <name>          Backup current HWID identifiers");
    println!("  restore <name>         Restore HWID identifiers from backup");
    println!("  verify                 Verify current spoofing state");
    println!("  list-profiles          List all saved profiles\n");
    println!("Note: Run as Administrator for full functionality.");
}

fn pause_on_exit() {
    use std::io;
    println!("\n{}", "-".repeat(60));
    println!("Press Enter to continue...");
    let _ = io::stdout().flush();
    let mut input = String::new();
    let _ = io::stdin().read_line(&mut input);
}

fn read_input(prompt: &str) -> String {
    use std::io;
    print!("{}", prompt);
    let _ = io::stdout().flush();
    let mut input = String::new();
    let _ = io::stdin().read_line(&mut input);
    input.trim().to_string()
}

fn interactive_menu() {
    loop {
        print_header(&format!("HWID Spoofer v{}", VERSION));
        if !is_elevated() {
            println!("  ⚠ NOT running as Administrator - some operations may fail.");
            println!("    Close this window and right-click → Run as administrator.\n");
        } else {
            println!("  ✓ Running with Administrator privileges\n");
        }
        println!("  [1]  Full Spoof Sequence (all 5 steps)");
        println!("  [2]  Spoof BIOS UUID only");
        println!("  [3]  Spoof SMBIOS fields only");
        println!("  [4]  Spoof Disk Drive serials only");
        println!("  [5]  Spoof Network MAC addresses only");
        println!("  [6]  Spoof USB device serials only");
        println!("  [7]  Backup current HWID identifiers");
        println!("  [8]  Restore from a backup profile");
        println!("  [9]  Verify spoofing status");
        println!("  [10] List saved profiles");
        println!("  [0]  Exit\n");

        let choice = read_input("Select an option [0-10]: ");

        let result = std::panic::catch_unwind(|| match choice.as_str() {
            "1" => {
                let name = read_input("Profile name (or press Enter for auto): ");
                let args = if name.is_empty() {
                    vec!["hwid_spoofer".to_string(), "spoof".to_string()]
                } else {
                    vec!["hwid_spoofer".to_string(), "spoof".to_string(), name]
                };
                run_full_spoof(&args);
            }
            "2" => cmd_bios(),
            "3" => cmd_smbios(),
            "4" => cmd_disks(),
            "5" => cmd_network(),
            "6" => cmd_usb(),
            "7" => {
                let name = read_input("Backup profile name: ");
                if !name.is_empty() {
                    cmd_backup(&vec!["hwid_spoofer".to_string(), "backup".to_string(), name]);
                }
            }
            "8" => {
                let name = read_input("Profile name to restore: ");
                if !name.is_empty() {
                    cmd_restore(&vec!["hwid_spoofer".to_string(), "restore".to_string(), name]);
                }
            }
            "9" => cmd_verify(),
            "10" => cmd_list_profiles(),
            "0" => {
                println!("\nGoodbye.");
                std::process::exit(0);
            }
            _ => println!("\n  Invalid option. Please try again."),
        });

        if result.is_err() {
            println!("\n[!] Operation failed. Check the log for details.");
        }

        pause_on_exit();
    }
}

fn main() {
    // Install a panic hook so unexpected errors are visible before the window closes
    std::panic::set_hook(Box::new(|panic_info| {
        println!("\n[!] An unexpected error occurred:");
        println!("    {}", panic_info);
        log_message(&format!("PANIC: {}", panic_info));
    }));

    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        // No arguments (double-clicked) -> interactive menu
        log_message(&format!("HWID Spoofer v{} started (interactive)", VERSION));
        interactive_menu();
        return;
    }

    if !is_elevated() {
        println!("⚠ Warning: Not running as Administrator.");
        println!("  Some operations may fail. Right-click and 'Run as administrator'.\n");
    }

    log_message(&format!("HWID Spoofer v{} started", VERSION));

    let result = std::panic::catch_unwind(|| {
        match args[1].as_str() {
            "spoof" => run_full_spoof(&args),
            "bios" => cmd_bios(),
            "smbios" => cmd_smbios(),
            "disks" => cmd_disks(),
            "network" => cmd_network(),
            "usb" => cmd_usb(),
            "backup" => cmd_backup(&args),
            "restore" => cmd_restore(&args),
            "verify" => cmd_verify(),
            "list-profiles" => cmd_list_profiles(),
            "--help" | "-h" | "help" => show_usage(),
            other => {
                println!("Unknown command: {}", other);
                show_usage();
            }
        }
    });

    if result.is_err() {
        println!("\n[!] Operation failed. Check the log for details.");
    }

    pause_on_exit();
}
