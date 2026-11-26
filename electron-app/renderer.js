const $ = (id) => document.getElementById(id);

function toast(msg, type = 'info') {
  const t = $('toast');
  t.textContent = msg;
  t.style.borderColor = type === 'error' ? 'var(--red)' : type === 'success' ? 'var(--green)' : 'var(--border)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function logLine(panel, text, cls = '') {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  const ts = new Date().toLocaleTimeString();
  line.textContent = `[${ts}] ${text}`;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
}

// ============================================================================
// Tabs
// ============================================================================

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    $('tab-' + tab.dataset.tab).classList.add('active');

    if (tab.dataset.tab === 'verify') refreshVerify();
    if (tab.dataset.tab === 'profiles') refreshProfiles();
    if (tab.dataset.tab === 'compare') loadCompareState();
  });
});

// ============================================================================
// Status
// ============================================================================

async function init() {
  const status = await window.api.getStatus();
  const badge = $('statusBadge');
  if (status.admin) {
    badge.className = 'status-badge status-admin';
    badge.textContent = '✓ Administrator';
  } else {
    badge.className = 'status-badge status-noadmin';
    badge.textContent = '⚠ Not Administrator';
  }

  window.api.onProgress((data) => {
    const pct = (data.step / data.total) * 100;
    $('progressBar').style.width = pct + '%';
    $('progressLabel').textContent = data.label;
    $('progressStep').textContent = `${data.step} / ${data.total}`;
    logLine($('spoofLog'), `${data.label}: ${data.detail}`, 'log-info');
  });
}
init();

// ============================================================================
// Full Spoof
// ============================================================================

$('btnFullSpoof').addEventListener('click', async () => {
  const name = $('profileName').value.trim() || `auto_${Date.now()}`;
  const btn = $('btnFullSpoof');
  const logPanel = $('spoofLog');
  const progress = $('progressContainer');
  const summary = $('spoofSummary');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Spoofing...';
  logPanel.style.display = 'block';
  logPanel.innerHTML = '';
  progress.classList.add('show');
  summary.style.display = 'none';
  $('progressBar').style.width = '0%';

  logLine(logPanel, 'Starting full HWID spoof sequence...', 'log-info');

  try {
    const result = await window.api.fullSpoof(name);
    const p = result.profile;

    $('progressBar').style.width = '100%';
    $('progressLabel').textContent = 'Complete!';
    logLine(logPanel, '✓ BIOS UUID spoofed', 'log-ok');
    logLine(logPanel, `✓ SMBIOS: ${p.smbios_serial} / ${p.smbios_manufacturer}`, 'log-ok');
    logLine(logPanel, `✓ ${p.disks.length} disk drive(s) spoofed`, 'log-ok');
    logLine(logPanel, `✓ ${p.network.filter(x => !x.skipped).length} adapter(s) spoofed`, 'log-ok');
    logLine(logPanel, `✓ ${p.usb.length} USB device(s) spoofed`, 'log-ok');
    logLine(logPanel, `✓ Profile saved: ${result.saved.ok ? result.saved.path : 'failed'}`, 'log-ok');

    // Summary
    const grid = $('summaryGrid');
    grid.innerHTML = '';
    const items = [
      ['BIOS UUID', p.bios_uuid],
      ['SMBIOS Serial', p.smbios_serial],
      ['Manufacturer', p.smbios_manufacturer],
      ['Disks Spoofed', p.disks.length],
      ['Adapters Spoofed', p.network.filter(x => !x.skipped).length],
      ['USB Devices Spoofed', p.usb.length],
    ];
    for (const [label, value] of items) {
      const div = document.createElement('div');
      div.className = 'summary-item';
      div.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
      grid.appendChild(div);
    }
    // Comparison summary
    if (result.comparison) {
      const diff = result.comparison;
      const dc = $('spoofDiffContainer');
      dc.innerHTML = `
        <div class="diff-stats">
          <div class="stat-box stat-changed"><div class="n">${diff.changedCount}</div><div class="l">Identifiers Changed</div></div>
          <div class="stat-box stat-same"><div class="n">${diff.totalCount - diff.changedCount}</div><div class="l">Unchanged</div></div>
        </div>
        <div style="font-size:12px;color:var(--muted);">Comparison saved — open the <b>Compare</b> tab for the full old → new table.</div>
      `;
    }
    summary.style.display = 'block';
    toast('Full spoof sequence completed!', 'success');
  } catch (e) {
    logLine(logPanel, `✗ Error: ${e.message}`, 'log-error');
    toast('Spoofing failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Start Full Spoof Sequence';
  }
});

// ============================================================================
// Individual spoofing
// ============================================================================

document.querySelectorAll('[data-spoof]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const type = btn.dataset.spoof;
    const logPanel = $('individualLog');
    btn.disabled = true;

    try {
      let result;
      switch (type) {
        case 'bios': result = await window.api.spoofBios(); break;
        case 'smbios': result = await window.api.spoofSmbios(); break;
        case 'disks': result = await window.api.spoofDisks(); break;
        case 'network': result = await window.api.spoofNetwork(); break;
        case 'usb': result = await window.api.spoofUsb(); break;
      }

      logLine(logPanel, `--- ${type.toUpperCase()} ---`, 'log-info');
      if (result.uuid) logLine(logPanel, `New UUID: ${result.uuid}`, 'log-ok');
      if (result.serial) logLine(logPanel, `New Serial: ${result.serial}`, 'log-ok');
      if (result.manufacturer) logLine(logPanel, `Manufacturer: ${result.manufacturer}`, 'log-ok');
      if (result.registry === false) {
        logLine(logPanel, 'Note: registry mirror skipped (run as admin for system-wide visibility)', 'log-warn');
      }
      for (const r of (result.results || [])) {
        if (r.skipped) logLine(logPanel, `Skipped virtual adapter: ${r.name}`, 'log-warn');
        else logLine(logPanel, `${r.name || r.id}: ${r.old} → ${r.mac || r.serial} ${r.ok ? '✓' : '✗'}`, r.ok ? 'log-ok' : 'log-error');
      }
      if (result.ok === false || (result.results || []).some(r => !r.skipped && !r.ok)) {
        toast(`${type.toUpperCase()} spoof incomplete — check log`, 'error');
      } else {
        toast(`${type.toUpperCase()} spoofed`, 'success');
      }
    } catch (e) {
      logLine(logPanel, `Error: ${e.message}`, 'log-error');
      toast('Error: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
});

// ============================================================================
// Verify
// ============================================================================

async function refreshVerify() {
  const container = $('verifyResults');
  container.innerHTML = '<div style="color:var(--muted);">Checking...</div>';
  try {
    const v = await window.api.verify();
    container.innerHTML = '';

    const addItem = (name, value, ok, detail) => {
      const div = document.createElement('div');
      div.className = 'verify-item';
      div.innerHTML = `
        <span class="verify-icon">${ok ? '✓' : '⚠'}</span>
        <span class="verify-name">${name}${detail ? `<br><small style="color:var(--muted)">${detail}</small>` : ''}</span>
        <span class="verify-value">${value}</span>
      `;
      container.appendChild(div);
    };

    const srcLabel = (s) => s === 'override' ? 'registry override (applied)' :
      s === 'driver' ? 'from driver (real MAC)' : 'firmware value (real)';

    addItem('BIOS UUID', v.bios_uuid || 'N/A', v.uuid_valid,
      `${srcLabel(v.uuid_source)} · ${v.uuid_valid ? 'UUID v4 format' : 'not v4 format'}`);

    addItem('SMBIOS Serial', v.smbios_serial || 'N/A', v.serial_valid,
      `${srcLabel(v.serial_source)} · ${v.serial_valid ? 'hex serial' : 'unusual format'}`);

    for (const a of v.adapters) {
      const detail = a.skipped
        ? 'Virtual adapter (skipped)'
        : a.local
          ? `${srcLabel(a.source)} · locally administered MAC`
          : `${srcLabel(a.source)} · no override`;
      addItem(a.name, a.mac, a.local || a.skipped, detail);
    }
  } catch (e) {
    container.innerHTML = `<div style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

$('btnVerify').addEventListener('click', refreshVerify);

// ============================================================================
// Profiles
// ============================================================================

async function refreshProfiles() {
  const list = $('profilesList');
  try {
    const profiles = await window.api.listProfiles();
    list.innerHTML = '';
    if (profiles.length === 0) {
      list.innerHTML = '<div style="color:var(--muted);font-size:13px;">No saved profiles yet.</div>';
      return;
    }
    for (const name of profiles) {
      const div = document.createElement('div');
      div.className = 'profile-item';
      div.innerHTML = `
        <span class="name">${name}</span>
        <button class="btn btn-danger btn-restore" data-name="${name}">Restore</button>
      `;
      list.appendChild(div);
    }
    document.querySelectorAll('.btn-restore').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm(`Restore profile "${b.dataset.name}"? This will overwrite current identifiers.`)) return;
        try {
          const result = await window.api.restore(b.dataset.name);
          if (result.ok) {
            toast(`Restored ${result.results.length} identifiers. Reboot recommended.`, 'success');
          } else {
            toast('Restore failed: ' + result.error, 'error');
          }
        } catch (e) {
          toast('Error: ' + e.message, 'error');
        }
      });
    });
  } catch (e) {
    list.innerHTML = `<div style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

$('btnBackup').addEventListener('click', async () => {
  const name = $('backupName').value.trim();
  if (!name) { toast('Enter a profile name', 'error'); return; }
  try {
    const result = await window.api.backup(name);
    if (result.ok) {
      toast(`Backup saved: ${result.path}`, 'success');
      $('backupName').value = '';
      refreshProfiles();
    } else {
      toast('Backup failed: ' + result.error, 'error');
    }
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
});

$('btnOpenFolder').addEventListener('click', () => window.api.showFolder());

// ============================================================================
// Comparison
// ============================================================================

function renderDiff(diff) {
  const results = $('compareResults');
  const stats = $('compareStats');

  if (!diff || !diff.rows) {
    results.innerHTML = '<div class="diff-empty">No comparison data.</div>';
    stats.style.display = 'none';
    return;
  }

  // Stats
  stats.style.display = 'flex';
  stats.innerHTML = `
    <div class="stat-box stat-changed"><div class="n">${diff.changedCount}</div><div class="l">Changed</div></div>
    <div class="stat-box stat-same"><div class="n">${diff.totalCount - diff.changedCount}</div><div class="l">Unchanged</div></div>
    <div class="stat-box"><div class="n">${diff.totalCount}</div><div class="l">Total Checked</div></div>
  `;

  // Table
  let html = `<table class="diff-table">
    <thead><tr>
      <th style="width:90px;">Category</th>
      <th>Identifier</th>
      <th style="width:30%;">Old Value</th>
      <th style="width:4%;"></th>
      <th style="width:30%;">New Value</th>
      <th style="width:90px;">Status</th>
    </tr></thead><tbody>`;

  for (const r of diff.rows) {
    const sourceBadge = r.source
      ? `<span class="diff-cat" style="background:rgba(188,140,255,0.15);color:var(--purple);margin-left:6px;">${r.source}</span>`
      : '';
    html += `
      <tr class="${r.changed ? 'changed' : 'unchanged'}">
        <td><span class="diff-cat">${r.category}</span></td>
        <td>${r.item}${sourceBadge}</td>
        <td class="diff-old">${r.old}</td>
        <td class="diff-arrow">→</td>
        <td class="diff-new">${r.new}</td>
        <td><span class="diff-badge ${r.changed ? 'badge-changed' : 'badge-same'}">${r.changed ? 'CHANGED' : 'same'}</span></td>
      </tr>`;
  }

  html += '</tbody></table>';
  results.innerHTML = html;
}

async function loadCompareState() {
  try {
    const result = await window.api.compare();
    if (result.ok) {
      const d = new Date(result.diff.beforeTime);
      $('snapshotTime').textContent = `Baseline: ${d.toLocaleString()}`;
      renderDiff(result.diff);
    } else {
      $('snapshotTime').textContent = '';
      $('compareStats').style.display = 'none';
      $('compareResults').innerHTML = `
        <div class="diff-empty">
          <div style="font-size:32px;margin-bottom:12px;">📸</div>
          <div>${result.error}</div>
          <div style="margin-top:8px;">Click <b>Capture Baseline Snapshot</b> now, spoof, then come back and click <b>Compare Now</b>.</div>
        </div>`;
    }
  } catch (e) {
    $('compareResults').innerHTML = `<div class="diff-empty" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

$('btnSnapshot').addEventListener('click', async () => {
  try {
    const state = await window.api.snapshot();
    $('snapshotTime').textContent = `Baseline: ${new Date().toLocaleString()}`;
    toast('Baseline snapshot captured!', 'success');
    // Immediately compare to show current state (all unchanged for now)
    const result = await window.api.compare();
    if (result.ok) renderDiff(result.diff);
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
});

$('btnCompare').addEventListener('click', loadCompareState);

$('btnViewFullDiff').addEventListener('click', () => {
  document.querySelector('.tab[data-tab="compare"]').click();
});

refreshProfiles();
