(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-MY');
  const colors = { '1xx': '#7eabce', '2xx': '#58bfa0', '3xx': '#a699d0', '4xx': '#e3b06a', '5xx': '#e58179', '0': '#a5b0be' };
  let all = [], visible = [], explorer = [], sourceName = '', mode = 'empty', issues = [], page = 0;
  let endpointExpanded = false, sortDuration = false, endpointSearch = '', zone = 'Asia/Kuala_Lumpur';
  let pollTimer = null, directory = null, cache = new Map(), generation = 0, noticeText = '', activeFiles = [];
  const PAGE_SIZE = 40, MAX_FILE = 25 * 1024 * 1024, MAX_BATCH = 100 * 1024 * 1024;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const masked = () => $('maskToggle').checked;
  const pathFor = r => masked() ? IIS.maskPath(r.path) : r.path;
  const duration = value => value === null ? '—' : fmt.format(Math.round(value)) + ' ms';
  const localTime = (ts, date = false) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...(date ? { day: '2-digit', month: 'short', year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', second: date ? undefined : '2-digit', hourCycle: 'h23' }).format(ts);
  const family = status => status === 0 ? '0' : Math.floor(status / 100) + 'xx';
  const serviceOf = r => '/' + (r.path.split('/').filter(Boolean)[0] || '(root)');
  function showNotice(message) { noticeText = message; $('notice').textContent = message; $('notice').hidden = !message; }
  function badge(status) { return '<span class="status-badge s' + (status === 0 ? '0' : Math.floor(status / 100)) + '">' + status + '</span>'; }
  function refreshServices() {
    const previous = $('service').value;
    const services = [...new Set(all.map(serviceOf))].sort();
    $('service').innerHTML = '<option value="all">Semua aplikasi</option>' + services.map(x => '<option value="' + escape(x) + '">' + escape(masked() ? IIS.maskPath(x) : x) + '</option>').join('');
    $('service').value = services.includes(previous) ? previous : 'all';
  }
  function resetFilters(renderAfter = true) {
    for (const id of ['period', 'service', 'statusFilter', 'speedFilter']) $(id).value = 'all';
    $('search').value = ''; endpointSearch = ''; sortDuration = false; page = 0;
    $('durationSort').textContent = 'DURATION ↕';
    if (renderAfter) render();
  }
  function installData(results, name, nextMode, warnings = [], reset = false) {
    all = results.flatMap(r => r.parsed.records).sort((a, b) => b.ts - a.ts);
    issues = results.flatMap(r => r.parsed.issues.map(x => ({ ...x, source: r.name })));
    activeFiles = results.map(r => r.name); sourceName = name; mode = nextMode;
    refreshServices(); if (reset) resetFilters(false);
    const msgs = [...warnings];
    if (mode === 'demo') msgs.unshift('DATA DEMO REKAAN — bukan log server kau. Klik Import log untuk analisis fail sebenar.');
    if (issues.length) msgs.push(fmt.format(issues.length) + ' baris tidak dapat diproses. Contoh: ' + issues.slice(0, 3).map(x => x.source + ':' + x.line + ' — ' + x.reason).join(' | '));
    if (!all.length && results.length) msgs.push('Tiada request sah ditemui. Pastikan fail mempunyai header #Fields dan format W3C IIS.');
    showNotice(msgs.join(' ')); render();
  }
  function render() {
    const latest = all[0]?.ts || 0, period = $('period').value, service = $('service').value;
    visible = all.filter(r => (period === 'all' || r.ts >= latest - Number(period) * 60000) && (service === 'all' || serviceOf(r) === service));
    $('sourceName').textContent = sourceName || 'Pilih log IIS untuk bermula';
    $('sideSource').textContent = sourceName || 'Tiada fail dipilih';
    $('sourceMeta').textContent = all.length ? fmt.format(all.length) + ' request · ' + activeFiles.length + ' fail · ' + localTime(all[all.length - 1].ts, true) + ' → ' + localTime(latest, true) : 'Import satu atau beberapa fail .log / .txt';
    $('modeBadge').textContent = { empty: 'BELUM ADA DATA', snapshot: 'SNAPSHOT', demo: 'DATA DEMO', watch: 'PANTAU · 5 SAAT' }[mode];
    $('modeBadge').className = 'mode-badge ' + (mode === 'watch' ? 'watch' : mode === 'demo' ? 'demo' : '');
    $('watchBtn').textContent = directory ? '■  Henti pantau' : '▣  Pantau folder';
    $('timeZoneLabel').textContent = zone === 'UTC' ? 'UTC' : 'MYT';
    $('rangeLabel').textContent = visible.length ? localTime(visible[visible.length - 1].ts, true) + ' — ' + localTime(visible[0].ts, true) : 'Tiada request dalam filter ini';
    const s = IIS.summarize(visible);
    $('totalMetric').textContent = fmt.format(s.total);
    $('totalNote').textContent = fmt.format(s.total - s.errors - s.unknown) + ' respons 1xx–3xx';
    $('errorMetric').textContent = fmt.format(s.errors);
    $('errorNote').textContent = (s.total ? (s.errors / s.total * 100).toFixed(1) : '0.0') + '% · ' + s.clientErrors + ' client / ' + s.serverErrors + ' server';
    $('avgMetric').innerHTML = s.average === null ? '—' : fmt.format(Math.round(s.average)) + ' <small>ms</small>';
    $('avgNote').textContent = 'P95 ' + duration(s.p95);
    $('slowMetric').textContent = fmt.format(s.slow);
    $('slowNote').textContent = '≥ 2,000 ms · Max ' + duration(s.max);
    drawTraffic(); drawStatus(s); renderEndpoints(); renderExplorer();
    $('clearBtn').disabled = !all.length && !directory;
  }
  function drawTraffic() {
    if (!visible.length) { $('trafficChart').innerHTML = '<div class="empty-chart">Tiada request untuk julat ini</div>'; $('bucketLabel').textContent = 'IIS W3C logs'; return; }
    const start = visible[visible.length - 1].ts, end = visible[0].ts, span = Math.max(end - start, 60000);
    const steps = [60000, 300000, 900000, 1800000, 3600000, 10800000, 21600000, 86400000];
    const step = steps.find(x => span / x <= 42) || Math.ceil(span / 40 / 86400000) * 86400000;
    const base = Math.floor(start / step) * step, count = Math.floor((end - base) / step) + 1;
    const buckets = Array.from({ length: count }, (_, i) => ({ t: base + i * step, count: 0, errors: 0 }));
    for (const r of visible) { const b = buckets[Math.floor((r.ts - base) / step)]; b.count++; if (r.status >= 400) b.errors++; }
    const max = Math.max(...buckets.map(x => x.count), 1), yMax = Math.max(4, Math.ceil(max / 4) * 4);
    const W = 640, H = 210, l = 42, right = 10, top = 12, bottom = 31, cw = W - l - right, ch = H - top - bottom;
    const x = i => l + (i + .5) * cw / buckets.length, y = v => top + ch - v / yMax * ch;
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#61c4a8" stop-opacity=".22"/><stop offset="100%" stop-color="#61c4a8" stop-opacity=".01"/></linearGradient></defs>';
    for (let i = 0; i <= 4; i++) { const v = yMax * i / 4; svg += '<line x1="' + l + '" x2="' + (W - right) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="#edf1f5" stroke-dasharray="3 4"/><text x="' + (l - 10) + '" y="' + (y(v) + 3) + '" text-anchor="end" fill="#a0aaba" font-size="9" font-family="Segoe UI,Arial">' + fmt.format(v) + '</text>'; }
    const points = buckets.map((b, i) => x(i) + ',' + y(b.count)).join(' ');
    svg += '<polygon points="' + x(0) + ',' + y(0) + ' ' + points + ' ' + x(buckets.length - 1) + ',' + y(0) + '" fill="url(#area)"/><polyline points="' + points + '" fill="none" stroke="#5abea0" stroke-width="2" stroke-linejoin="round"/>';
    svg += '<polyline points="' + buckets.map((b, i) => x(i) + ',' + y(b.errors)).join(' ') + '" fill="none" stroke="#ec988a" stroke-width="1.6" stroke-linejoin="round"/>';
    buckets.forEach((b, i) => {
      const bw = cw / buckets.length;
      svg += '<rect x="' + (x(i) - bw / 2) + '" y="' + top + '" width="' + bw + '" height="' + ch + '" fill="transparent"><title>' + escape(localTime(b.t, true) + ' · ' + b.count + ' requests · ' + b.errors + ' errors') + '</title></rect>';
      if (i % Math.max(1, Math.ceil(buckets.length / 6)) === 0) svg += '<text x="' + x(i) + '" y="' + (H - 10) + '" text-anchor="middle" fill="#9da8b8" font-size="9" font-family="Segoe UI,Arial">' + escape(localTime(b.t).slice(0, 5)) + '</text>';
    });
    $('trafficChart').innerHTML = svg + '</svg>';
    $('trafficChart').setAttribute('aria-label', 'Graf ' + visible.length + ' request; setiap titik mewakili ' + step / 60000 + ' minit.');
    $('bucketLabel').textContent = 'Interval ' + (step < 3600000 ? step / 60000 + ' minit' : step / 3600000 + ' jam');
  }
  function drawStatus(summary) {
    const counts = new Map(); for (const r of visible) counts.set(family(r.status), (counts.get(family(r.status)) || 0) + 1);
    let offset = 0;
    const stops = [...counts].sort().map(([key, n]) => { const from = offset; offset += n / visible.length * 100; return colors[key] + ' ' + from + '% ' + offset + '%'; });
    $('donut').style.background = stops.length ? 'conic-gradient(' + stops.join(',') + ')' : '#edf1f5';
    $('donutTotal').textContent = fmt.format(visible.length);
    const labels = { '1xx': 'Informational', '2xx': 'Success', '3xx': 'Redirect', '4xx': 'Client error', '5xx': 'Server error', '0': 'Status 0' };
    $('statusLegend').innerHTML = counts.size ? [...counts].sort().map(([key, n]) => '<button class="status-row" data-family="' + key + '" title="Tapis ' + key + '"><span><i style="background:' + colors[key] + '"></i>' + (labels[key] || key) + '</span><b>' + fmt.format(n) + '</b></button>').join('') : '<span class="muted">Tiada data</span>';
    $('statusNote').textContent = summary.unknown ? summary.unknown + ' request mempunyai status 0 (bukan HTTP success/error).' : 'Klik status untuk tapis request explorer.';
  }
  function endpointGroups() {
    const map = new Map();
    for (const r of visible) { const key = r.method + ' ' + IIS.maskPath(r.path); if (!map.has(key)) map.set(key, { key, method: r.method, path: IIS.maskPath(r.path), rows: [] }); map.get(key).rows.push(r); }
    const values = [...map.values()].map(g => ({ ...g, ...IIS.summarize(g.rows), count: g.rows.length }));
    const field = { count: 'count', avg: 'average', errors: 'errors' }[$('endpointSort').value];
    return values.sort((a, b) => (b[field] || 0) - (a[field] || 0) || b.count - a.count);
  }
  function renderEndpoints() {
    const groups = endpointGroups(), shown = endpointExpanded ? groups : groups.slice(0, 7), max = Math.max(...groups.map(g => g.count), 1);
    $('endpointRows').innerHTML = shown.length ? shown.map(g => '<tr><td><button class="endpoint-link mono" data-endpoint="' + escape(g.key) + '" title="Tapis explorer: ' + escape(g.key) + '">' + escape(g.key) + '</button></td><td class="endpoint-count">' + fmt.format(g.count) + '</td><td>' + (g.errors ? '<span class="slow-text">' + fmt.format(g.errors) + '</span>' : '—') + '</td><td class="' + (g.average >= 2000 ? 'slow-text' : '') + '">' + duration(g.average) + '</td><td>' + duration(g.p95) + '</td><td><div class="bar-track"><div class="bar-fill" style="width:' + g.count / max * 100 + '%"></div></div></td></tr>').join('') : '<tr><td colspan="6" class="empty-cell">Tiada endpoint untuk filter ini.</td></tr>';
    $('moreEndpoints').textContent = endpointExpanded ? 'Ringkaskan' : 'Lihat semua ' + groups.length + ' endpoint';
    $('moreEndpoints').disabled = groups.length <= 7;
  }
  function matchesStatus(r) {
    const f = $('statusFilter').value;
    if (f === 'all') return true; if (f === 'errors') return r.status >= 400;
    return family(r.status) === f;
  }
  function renderExplorer() {
    const term = $('search').value.trim().toLowerCase();
    explorer = visible.filter(r => matchesStatus(r) && ($('speedFilter').value === 'all' || (r.duration !== null && r.duration >= 2000)) && (!endpointSearch || r.method + ' ' + IIS.maskPath(r.path) === endpointSearch) && (!term || [pathFor(r), r.method, r.status, r.client].join(' ').toLowerCase().includes(term)));
    if (sortDuration) explorer.sort((a, b) => (b.duration ?? -1) - (a.duration ?? -1) || b.ts - a.ts);
    const pages = Math.max(1, Math.ceil(explorer.length / PAGE_SIZE)); page = Math.max(0, Math.min(page, pages - 1));
    const rows = explorer.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    $('requestCount').textContent = fmt.format(explorer.length);
    $('requestRows').innerHTML = rows.length ? rows.map((r, i) => '<tr><td class="mono">' + escape(localTime(r.ts)) + '</td><td><span class="method ' + (r.method === 'GET' ? '' : r.method === 'POST' ? 'post' : 'other') + '">' + escape(r.method) + '</span></td><td class="path-cell mono" title="' + escape(pathFor(r)) + '">' + escape(pathFor(r)) + '</td><td>' + badge(r.status) + '</td><td class="mono ' + (r.duration >= 2000 ? 'slow-text' : '') + '">' + duration(r.duration) + '</td><td class="mono">' + escape(r.client) + '</td><td><button class="detail-button" data-row="' + (page * PAGE_SIZE + i) + '" aria-label="Buka butiran request ' + (page * PAGE_SIZE + i + 1) + '">↗</button></td></tr>').join('') : '<tr><td colspan="7" class="empty-cell">Tiada request sepadan. Cuba Reset filter atau import log lain.</td></tr>';
    $('pageInfo').textContent = explorer.length ? fmt.format(page * PAGE_SIZE + 1) + '–' + fmt.format(Math.min((page + 1) * PAGE_SIZE, explorer.length)) + ' daripada ' + fmt.format(explorer.length) + ' requests' + (endpointSearch ? ' · endpoint dipilih' : '') : '0 requests';
    $('pageLabel').textContent = page + 1 + ' / ' + pages; $('prevBtn').disabled = page === 0; $('nextBtn').disabled = page >= pages - 1; $('exportBtn').disabled = !explorer.length;
  }
  function openDetails(index) {
    const r = explorer[index]; if (!r) return;
    $('detailTitle').textContent = r.method + ' · ' + r.status;
    const fields = [['Time (' + (zone === 'UTC' ? 'UTC' : 'MYT') + ')', localTime(r.ts, true)], ['Duration', duration(r.duration)], ['Endpoint', pathFor(r), true], ['Query parameters', masked() ? IIS.maskQuery(r.query) : r.query, true], ['HTTP / substatus / Win32', r.status + ' / ' + r.substatus + ' / ' + r.win32], ['Client IP', r.client], ['Bytes sent / received', r.sent + ' / ' + r.received], ['Source', r.source + ' · line ' + r.line]];
    $('detailBody').innerHTML = '<div class="detail-grid">' + fields.map(([key, value, wide]) => '<div class="detail-field ' + (wide ? 'wide' : '') + '"><span>' + escape(key) + '</span><code>' + escape(value) + '</code></div>').join('') + '</div><p class="detail-hint">' + (masked() ? 'Nilai query dan ID dalam path disembunyikan. Tetapan ini juga digunakan untuk export CSV.' : 'Sembunyi ID dimatikan. Query dan path asal boleh mengandungi maklumat peribadi.') + '</p>';
    $('detailDialog').showModal();
  }
  function disconnect() { generation++; clearTimeout(pollTimer); pollTimer = null; directory = null; cache = new Map(); if (mode === 'watch') mode = 'snapshot'; }
  async function readFiles(files, targetMode, name, reset = true) {
    disconnect(); const token = generation, warnings = [], results = []; let bytes = 0;
    $('importBtn').disabled = true; $('importBtn').textContent = 'Membaca…';
    try {
      const list = [...files].filter(f => /\.(log|txt)$/i.test(f.name));
      if (list.length > 100) warnings.push((list.length - 100) + ' fail tidak dibaca (had 100 fail).');
      for (const f of list.slice(0, 100)) {
        if (f.size > MAX_FILE || bytes + f.size > MAX_BATCH) { warnings.push(f.name + ' tidak dibaca: melebihi had saiz.'); continue; }
        bytes += f.size;
        try { results.push({ name: f.name, parsed: IIS.parse(await f.text(), f.name) }); }
        catch { warnings.push(f.name + ' tidak dapat dibaca.'); }
      }
      if (!list.length) warnings.push('Pilih fail .log atau .txt.');
      if (token !== generation) return;
      installData(results, name || (list.length === 1 ? list[0].name : list.length + ' fail log'), targetMode, warnings, reset);
      $('lastCheck').textContent = 'Import: ' + new Date().toLocaleTimeString('en-GB') + ' · snapshot fail';
    } finally { $('importBtn').disabled = false; $('importBtn').textContent = '↑  Import log'; }
  }
  async function scanFolder(token) {
    if (!directory || token !== generation) return;
    try {
      const candidates = [], warnings = [];
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind === 'file' && /\.(log|txt)$/i.test(name)) {
          try { const file = await handle.getFile(); candidates.push(file); }
          catch { warnings.push(name + ' tidak dapat dibaca.'); }
        }
      }
      candidates.sort((a, b) => b.lastModified - a.lastModified);
      if (candidates.length > 100) warnings.push('Hanya 100 fail terkini dipantau; ' + (candidates.length - 100) + ' fail lain diabaikan.');
      const next = new Map(); let bytes = 0;
      for (const f of candidates.slice(0, 100)) {
        if (f.size > MAX_FILE || bytes + f.size > MAX_BATCH) { warnings.push(f.name + ' tidak dibaca: melebihi had saiz.'); continue; }
        bytes += f.size; const signature = f.size + ':' + f.lastModified, old = cache.get(f.name);
        if (old?.signature === signature) next.set(f.name, old);
        else next.set(f.name, { name: f.name, signature, parsed: IIS.parse(await f.text(), f.name) });
      }
      if (token !== generation || !directory) return;
      const changed = next.size !== cache.size || [...next].some(([name, item]) => cache.get(name)?.signature !== item.signature);
      cache = next;
      if (changed || mode !== 'watch') installData([...cache.values()], directory.name, 'watch', warnings);
      else if (warnings.length && warnings.join(' ') !== noticeText) showNotice(warnings.join(' '));
      $('lastCheck').textContent = 'Semakan folder: ' + new Date().toLocaleTimeString('en-GB') + ' · ' + (next.size ? next.size + ' fail' : 'belum ada fail log');
      pollTimer = setTimeout(() => scanFolder(token), 5000);
    } catch (error) {
      if (token !== generation) return;
      disconnect(); render(); showNotice('Pemantauan dihentikan: akses folder gagal. Klik Pantau folder untuk pilih semula. ' + error.message);
    }
  }
  async function watchFolder() {
    if (directory) { disconnect(); render(); $('lastCheck').textContent = 'Pemantauan dihentikan · snapshot terakhir dikekalkan'; return; }
    if (!window.showDirectoryPicker || !window.isSecureContext) { showNotice('Browser ini tidak menyokong pemantauan folder. Buka dashboard melalui HTTPS atau localhost dalam Edge/Chrome, kemudian pilih Pantau folder. Import log masih boleh digunakan.'); return; }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read', id: 'iis-log-folder' });
      disconnect(); directory = handle; cache = new Map(); mode = 'empty'; resetFilters(false);
      await scanFolder(generation);
    } catch (error) { if (error.name !== 'AbortError') showNotice('Folder tidak dapat dipilih: ' + error.message); }
  }
  function exportCSV() {
    const rows = [['TimeUTC', 'Method', 'Endpoint', 'Query', 'Status', 'Substatus', 'Win32', 'DurationMs', 'ClientIP', 'Source', 'Line'], ...explorer.map(r => [new Date(r.ts).toISOString(), r.method, pathFor(r), masked() ? IIS.maskQuery(r.query) : r.query, r.status, r.substatus, r.win32, r.duration, r.client, r.source, r.line])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + IIS.toCSV(rows)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'iis-requests-' + (masked() ? 'masked' : 'original') + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function demo() {
    disconnect();
    const lines = ['#Software: SYNTHETIC DEMO DATA', '#Fields: date time cs-method cs-uri-stem cs-uri-query sc-status time-taken c-ip'];
    const paths = ['/orders/api/orders', '/identity/api/login', '/billing/api/invoices', '/catalog/api/products', '/orders/api/health', '/catalog/api/search', '/assets/favicon.ico'];
    const base = Date.parse('2026-11-01T00:00:00Z');
    for (let i = 0; i < 720; i++) {
      const stamp = new Date(base + i * 30000).toISOString(), path = paths[i % paths.length];
      const status = i % 53 === 0 ? 500 : i % 13 === 0 ? 404 : i % 11 === 0 ? 304 : 200;
      lines.push(stamp.slice(0, 10) + ' ' + stamp.slice(11, 19) + ' ' + (i % 5 === 0 ? 'POST' : 'GET') + ' ' + path + ' - ' + status + ' ' + (i % 17 === 0 ? 2300 + i * 3 : 20 + i * 7 % 620) + ' 192.0.2.' + (i % 20 + 1));
    }
    installData([{ name: 'demo-synthetic.log', parsed: IIS.parse(lines.join('\n'), 'demo-synthetic.log') }], 'Demo · data rekaan', 'demo', [], true);
    $('lastCheck').textContent = 'Demo rekaan · Import log untuk data sebenar';
  }
  $('importBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', e => { if (e.target.files.length) readFiles(e.target.files, 'snapshot'); e.target.value = ''; });
  $('watchBtn').addEventListener('click', watchFolder);
  $('clearBtn').addEventListener('click', () => { disconnect(); all = []; activeFiles = []; sourceName = ''; mode = 'empty'; issues = []; showNotice(''); refreshServices(); resetFilters(); $('lastCheck').textContent = 'Data telah dikosongkan daripada halaman ini.'; });
  $('resetBtn').addEventListener('click', () => resetFilters());
  ['period', 'service'].forEach(id => $(id).addEventListener('change', () => { page = 0; render(); }));
  $('timezone').addEventListener('change', e => { zone = e.target.value; render(); });
  ['statusFilter', 'speedFilter'].forEach(id => $(id).addEventListener('change', () => { page = 0; renderExplorer(); }));
  $('maskToggle').addEventListener('change', () => { if ($('detailDialog').open) $('detailDialog').close(); refreshServices(); render(); });
  $('search').addEventListener('input', () => { endpointSearch = ''; page = 0; renderExplorer(); });
  $('endpointSort').addEventListener('change', renderEndpoints);
  $('moreEndpoints').addEventListener('click', () => { endpointExpanded = !endpointExpanded; renderEndpoints(); });
  $('durationSort').addEventListener('click', () => { sortDuration = !sortDuration; page = 0; $('durationSort').textContent = sortDuration ? 'DURATION ↓' : 'DURATION ↕'; renderExplorer(); });
  $('endpointRows').addEventListener('click', e => { const b = e.target.closest('[data-endpoint]'); if (b) { endpointSearch = b.dataset.endpoint; $('search').value = ''; $('statusFilter').value = 'all'; $('speedFilter').value = 'all'; page = 0; renderExplorer(); $('requests').scrollIntoView({ behavior: 'smooth' }); } });
  $('statusLegend').addEventListener('click', e => { const b = e.target.closest('[data-family]'); if (b) { endpointSearch = ''; $('search').value = ''; $('statusFilter').value = b.dataset.family; page = 0; renderExplorer(); $('requests').scrollIntoView({ behavior: 'smooth' }); } });
  $('requestRows').addEventListener('click', e => { const b = e.target.closest('[data-row]'); if (b) openDetails(Number(b.dataset.row)); });
  $('prevBtn').addEventListener('click', () => { page--; renderExplorer(); }); $('nextBtn').addEventListener('click', () => { page++; renderExplorer(); });
  $('exportBtn').addEventListener('click', exportCSV);
  ['helpBtn', 'helpTop'].forEach(id => $(id).addEventListener('click', () => $('helpDialog').showModal()));
  $('closeHelp').addEventListener('click', () => $('helpDialog').close()); $('closeDetail').addEventListener('click', () => $('detailDialog').close());
  $('demoBtn').addEventListener('click', () => { $('helpDialog').close(); demo(); });
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d && e.offsetX >= 0 && e.offsetY >= 0 && (e.offsetX > d.clientWidth || e.offsetY > d.clientHeight)) d.close(); }));
  document.querySelectorAll('nav a').forEach(a => a.addEventListener('click', () => { document.querySelectorAll('nav a').forEach(x => x.classList.remove('active')); a.classList.add('active'); }));
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dragDepth++; $('dropOverlay').hidden = false; } });
  window.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropOverlay').hidden = true; });
  window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('dropOverlay').hidden = true; if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files, 'snapshot'); });
  window.addEventListener('beforeunload', () => clearTimeout(pollTimer));
  demo();
})();
