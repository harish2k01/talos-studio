import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLogs } from '../src/log-records.ts';
test('structured log messages decode escaped content and retain original records', () => {
  const raw =
    '192.0.2.11: ' +
    JSON.stringify({ ts: 1700000000, level: 'ERROR', msg: 'failed "request"', extra: 'details' });
  const record = parseLogs(raw)[0];
  assert.equal(record.level, 'error');
  assert.equal(record.message, 'failed "request"');
  assert.equal(record.raw, raw);
  assert.ok(record.time);
});
test('plain, malformed and partial log records are never lost', () => {
  const lines = ['plain output', 'warning: connection lost', 'node: {"msg":', '{"other":123}'];
  const records = parseLogs(lines.join('\n'));
  assert.deepEqual(
    records.map((r) => r.raw),
    lines,
  );
  assert.equal(records[1].level, 'warning');
  assert.equal(records[2].message, lines[2]);
});
