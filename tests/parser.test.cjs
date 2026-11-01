const test = require('node:test');
const assert = require('node:assert/strict');
require('../dist/parser.js');
const IIS = globalThis.IIS;

test('parses W3C using the declared column order and custom proxy fields', () => {
  const result = IIS.parse([
    '\uFEFF#Software: Microsoft IIS',
    '#Fields: date time cs-method cs-uri-stem sc-status time-taken c-ip X-Forwarded-For',
    '2026-01-01 00:00:00 GET /api/orders 200 42 192.0.2.1 198.51.100.2,198.51.100.3',
    '#Fields: cs-method cs-uri-stem time date sc-status',
    'POST /api/orders 00:00:01 2026-01-01 204',
  ].join('\n'), 'synthetic.log');
  assert.equal(result.records.length, 2);
  assert.equal(result.issues.length, 0);
  assert.equal(result.records[0].client, '198.51.100.2');
  assert.equal(result.records[0].ts, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(result.records[0].source, 'synthetic.log');
  assert.equal(result.records[1].method, 'POST');
  assert.equal(result.records[1].duration, null);
});

test('reports incomplete lines and recovers after a later valid header', () => {
  const result = IIS.parse([
    'unheaded data',
    '#Fields: date time cs-method cs-uri-stem sc-status time-taken',
    '2026-01-01 00:00:00 GET /api/orders 200',
    '2026-01-01 00:00:01 GET /api/orders 200 0',
  ].join('\n'));
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].duration, 0);
  assert.deepEqual(result.issues.map(x => x.line), [1, 3]);
});

test('rejects invalid statuses, timestamps and negative durations', () => {
  const result = IIS.parse([
    '#Fields: date time cs-method cs-uri-stem sc-status time-taken',
    'invalid 00:00:00 GET /a 200 1',
    '2026-01-01 00:00:00 GET /a 999 1',
    '2026-01-01 00:00:00 GET /a 200 -1',
    '2026-01-01 00:00:00 GET /a 0 10',
  ].join('\n'));
  assert.equal(result.issues.length, 3);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].status, 0);
});

test('keeps status 0 separate and excludes missing duration from latency metrics', () => {
  const summary = IIS.summarize([
    { status: 200, duration: 0 },
    { status: 404, duration: 100 },
    { status: 500, duration: 2000 },
    { status: 0, duration: null },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.errors, 2);
  assert.equal(summary.clientErrors, 1);
  assert.equal(summary.serverErrors, 1);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.average, 700);
  assert.equal(summary.slow, 1);
  assert.equal(summary.p95, 2000);
  assert.equal(summary.max, 2000);
});

test('empty datasets return no invented latency', () => {
  const summary = IIS.summarize([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.average, null);
  assert.equal(summary.p95, null);
  assert.equal(summary.max, null);
});

test('uses nearest-rank percentiles without mutating samples', () => {
  const values = [400, 100, 300, 200];
  assert.equal(IIS.percentile(values, 0.5), 200);
  assert.equal(IIS.percentile(values, 0.95), 400);
  assert.deepEqual(values, [400, 100, 300, 200]);
});

test('hides query values and likely path identifiers', () => {
  assert.equal(IIS.maskQuery('id=example&token=secret'), 'id=[hidden]&token=[hidden]');
  assert.equal(IIS.maskQuery('-'), '-');
  assert.equal(IIS.maskPath('/api/users/123456789012/profile'), '/api/users/:id/profile');
  assert.equal(IIS.maskPath('/api/users/550e8400-e29b-41d4-a716-446655440000'), '/api/users/:id');
  assert.equal(IIS.maskPath('/api/users/test%40example.com'), '/api/users/:id');
  assert.equal(IIS.maskPath('/api/orders'), '/api/orders');
});

test('quotes CSV delimiters and neutralizes spreadsheet formula prefixes', () => {
  const csv = IIS.toCSV([
    ['endpoint', 'query'],
    ['/api/"quoted",path', '=SUM(1,2)'],
    ['+cmd', '@value'],
  ]);
  assert.equal(csv, '"endpoint","query"\r\n"/api/""quoted"",path","\'=SUM(1,2)"\r\n"\'+cmd","\'@value"');
});
