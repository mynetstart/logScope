/* W3C IIS parser. No dependencies, network calls, or persistent storage. */
(function (root) {
  'use strict';
  const required = ['date', 'time', 'cs-method', 'cs-uri-stem', 'sc-status'];
  function number(value) { return value && value !== '-' && Number.isFinite(Number(value)) ? Number(value) : null; }
  function parse(text, source = 'log') {
    const records = [], issues = []; let fields = null, dataLines = 0, headerCount = 0;
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('#Fields:')) {
        fields = line.slice(8).trim().split(/\s+/); headerCount++;
        if (!required.every(f => fields.includes(f))) {
          issues.push({ line: i + 1, reason: 'Header tidak mempunyai kolum IIS yang diperlukan.' }); fields = null;
        }
        continue;
      }
      if (line.startsWith('#')) continue;
      dataLines++;
      if (!fields) { issues.push({ line: i + 1, reason: 'Tiada header #Fields yang sah.' }); continue; }
      const values = line.split(/\s+/);
      if (values.length !== fields.length) { issues.push({ line: i + 1, reason: 'Bilangan kolum tidak sepadan; baris mungkin belum lengkap.' }); continue; }
      const raw = Object.fromEntries(fields.map((f, j) => [f, values[j]]));
      const ts = Date.parse(raw.date + 'T' + raw.time + 'Z'), status = number(raw['sc-status']);
      if (!Number.isFinite(ts) || status === null || (status !== 0 && (status < 100 || status > 599))) {
        issues.push({ line: i + 1, reason: 'Tarikh atau status HTTP tidak sah.' }); continue;
      }
      const duration = number(raw['time-taken']);
      if (duration !== null && duration < 0) { issues.push({ line: i + 1, reason: 'Masa request negatif.' }); continue; }
      const forwarded = raw['X-Forwarded-For'] || raw['x-forwarded-for'];
      const realIP = raw['X-Real-IP'] || raw['x-real-ip'];
      const client = forwarded && forwarded !== '-' ? forwarded.split(',')[0].trim() : realIP && realIP !== '-' ? realIP : raw['c-ip'] || '-';
      records.push({ ts, status, duration, method: raw['cs-method'], path: raw['cs-uri-stem'], query: raw['cs-uri-query'] || '-', client, substatus: raw['sc-substatus'] || '-', win32: raw['sc-win32-status'] || '-', sent: number(raw['sc-bytes']) || 0, received: number(raw['cs-bytes']) || 0, source, line: i + 1, raw });
    }
    return { records, issues, dataLines, headerCount };
  }
  function percentile(values, p) {
    if (!values.length) return null;
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.max(0, Math.ceil(p * ordered.length) - 1)];
  }
  function summarize(records) {
    const durations = records.map(r => r.duration).filter(x => x !== null);
    return { total: records.length, errors: records.filter(r => r.status >= 400).length, clientErrors: records.filter(r => r.status >= 400 && r.status < 500).length, serverErrors: records.filter(r => r.status >= 500).length, unknown: records.filter(r => r.status === 0).length, slow: durations.filter(x => x >= 2000).length, average: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null, p95: percentile(durations, .95), max: durations.length ? durations.reduce((a, b) => Math.max(a, b), 0) : null };
  }
  function maskPath(value) {
    return value.split('/').map(segment => {
      let decoded; try { decoded = decodeURIComponent(segment); } catch { decoded = segment; }
      return /\d{6,}|[0-9a-f]{8}-[0-9a-f-]{27,}|@/i.test(decoded) || decoded.length > 55 ? ':id' : segment;
    }).join('/');
  }
  function maskQuery(value) {
    if (!value || value === '-') return '-';
    return value.split('&').map(part => {
      const key = part.split('=')[0]; return key + '=[hidden]';
    }).join('&');
  }
  function toCSV(rows) {
    return rows.map(row => row.map(value => {
      let v = String(value ?? '');
      if (/^[=+@\-\t\r]/.test(v)) v = "'" + v;
      return '"' + v.replace(/"/g, '""') + '"';
    }).join(',')).join('\r\n');
  }
  root.IIS = { parse, summarize, percentile, maskPath, maskQuery, toCSV };
})(typeof window !== 'undefined' ? window : globalThis);
