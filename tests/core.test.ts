import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { parseResources, parseConfig, validatePatch, redact } from '../server/parsers.ts';
import { TalosRunner, type Runner } from '../server/runner.ts';
import { TalosService } from '../server/talos.ts';
import { createApp } from '../server/app.ts';

const resource = (id: string, spec: Record<string, unknown>) => JSON.stringify({ metadata: { id }, spec });
class FakeRunner implements Runner {
  calls: string[][] = [];
  identity = 'original';
  unreachable = false;
  etcdHealthy = true;
  members = 1;
  temporaryPath = '';
  appliedPatch = '';
  failApply = false;
  async run(args: string[]) {
    this.calls.push(args);
    if (args.includes('--client')) return 'Client:\n Tag: v1.13.0';
    if (args.includes('members'))
      return Array.from({ length: this.members }, (_, i) =>
        resource(`node-${i + 1}`, {
          hostname: `node-${i + 1}`,
          nodeId: this.identity + i,
          machineType: this.members === 1 ? 'worker' : 'controlplane',
          addresses: [`192.0.2.${11 + i}`],
          operatingSystem: 'Talos (v1.13.0)',
        }),
      ).join('\n');
    if (args.includes('machinestatus')) {
      if (this.unreachable) throw new Error('Connection timed out');
      return resource('machine', { stage: 'running', status: { ready: true } });
    }
    if (args.includes('services'))
      return (
        resource('kubelet', { running: true, healthy: true }) +
        '\n' +
        resource('etcd', { running: true, healthy: this.etcdHealthy })
      );
    if (args.includes('logs')) return 'INFO runtime ready\n';
    if (args.includes('patch')) {
      this.temporaryPath = args[args.indexOf('--patch-file') + 1];
      const patch = await readFile(this.temporaryPath, 'utf8');
      if (!args.includes('--dry-run')) {
        if (this.failApply) throw new Error('Patch rejected');
        this.appliedPatch = patch;
      }
      return 'max-pods: 110 -> 120\n token: should-not-leak';
    }
    return resource('hardware', { model: 'Example' });
  }
  stream() {
    return spawn(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("line\\n"),10)'], {
      stdio: 'pipe',
    });
  }
}
async function fixture(writes = false) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-test-'));
  const configPath = join(dir, 'config');
  await writeFile(
    configPath,
    'context: test\ncontexts:\n  test:\n    endpoints: [192.0.2.11]\n    nodes: [192.0.2.11]\n    key: synthetic-secret\n',
  );
  const runner = new FakeRunner(),
    service = new TalosService(runner, { configPath, writes });
  return { runner, service, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
test('resource parser handles concatenated pretty JSON, escaped braces and incomplete output', () => {
  const first = resource('one', { text: 'a } brace and "quoted" value', nested: { a: 1 } });
  assert.equal(parseResources(first + '\n' + resource('two', { running: true })).length, 2);
  assert.throws(() => parseResources(first.slice(0, -1)), /Incomplete/);
  assert.throws(() => parseResources('warning\n' + first), /Unexpected/);
  assert.throws(() => parseResources('{}'), /Malformed/);
});
test('talosconfig exposes connection metadata without credentials', () => {
  const parsed = parseConfig(
    'context: test\ncontexts:\n  test:\n    endpoints: [192.0.2.11]\n    nodes: [192.0.2.11]\n    key: private-key\n    crt: private-cert\n',
  );
  assert.equal(parsed.current, 'test');
  assert.equal(JSON.stringify(parsed).includes('private'), false);
});
test('patch validation rejects scalars, duplicate keys, empty and oversized input', () => {
  validatePatch('machine:\n  kubelet:\n    extraArgs: {max-pods: "120"}');
  for (const input of ['', 'hello', '- a\n- b', 'a: 1\na: 2', 'x: ' + 'a'.repeat(66000)])
    assert.throws(() => validatePatch(input));
});
test('preview redaction handles YAML block credentials, inline JSON and PEM', () => {
  const result = redact(
    'token: sensitive\nkey: |\n  block-secret\n  another-secret\nsafe: kept\n{"token":"json-secret","other":"ok"}\n-----BEGIN PRIVATE KEY-----\npem-secret\n-----END PRIVATE KEY-----',
  );
  for (const secret of ['sensitive', 'block-secret', 'another-secret', 'json-secret', 'pem-secret'])
    assert.equal(result.includes(secret), false);
  assert.match(result, /safe: kept/);
  assert.match(result, /"other":"ok"/);
});
test('discovery marks failed probes as unknown rather than ready', async () => {
  const f = await fixture();
  try {
    f.runner.unreachable = true;
    const [n] = await f.service.machines('test');
    assert.equal(n.reachable, false);
    assert.equal(n.ready, null);
    assert.match(n.error!, /timed out/);
  } finally {
    await f.cleanup();
  }
});
test('unknown contexts, nodes and services cannot become CLI arguments', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.machines('--insecure'), /Unknown/);
    await assert.rejects(f.service.inspect('test', '--insecure'), /discovered/);
    await assert.rejects(f.service.inspect('test', '192.0.2.99'), /belong/);
    await assert.rejects(f.service.logs('test', '192.0.2.11', 'kubelet; reboot'), /service/);
    assert.equal(
      f.runner.calls.some((c) => c.includes('--insecure')),
      false,
    );
  } finally {
    await f.cleanup();
  }
});
test('read-only allows dry run but blocks apply and reboot', async () => {
  const f = await fixture();
  try {
    const plan = await f.service.plan('test', '192.0.2.11', 'patch', 'machine: {}');
    assert.equal(plan.preview.includes('should-not-leak'), false);
    await assert.rejects(access(f.runner.temporaryPath));
    await assert.rejects(f.service.execute(plan.id, 'node-1'), /disabled/);
    await assert.rejects(f.service.plan('test', '192.0.2.11', 'reboot'), /disabled/);
    assert.equal(f.runner.appliedPatch, '');
  } finally {
    await f.cleanup();
  }
});
test('review is bound to original patch, exact confirmation, and one execution', async () => {
  const f = await fixture(true);
  try {
    const patch = 'machine:\n  kubelet:\n    extraArgs: {max-pods: "120"}';
    const p = await f.service.plan('test', '192.0.2.11', 'patch', patch);
    await assert.rejects(f.service.execute(p.id, 'wrong-node'), /exact/);
    const result = await f.service.execute(p.id, 'node-1');
    assert.equal(result.status, 'completed');
    assert.equal(f.runner.appliedPatch, patch);
    await assert.rejects(f.service.execute(p.id, 'node-1'), /already used/);
    assert.equal(f.service.history.length, 1);
    assert.equal(JSON.stringify(f.service.history).includes('max-pods'), false);
    await assert.rejects(access(f.runner.temporaryPath));
  } finally {
    await f.cleanup();
  }
});
test('changed node identity blocks an approved plan', async () => {
  const f = await fixture(true);
  try {
    const p = await f.service.plan('test', '192.0.2.11', 'patch', 'machine: {}');
    f.runner.identity = 'replacement';
    await assert.rejects(f.service.execute(p.id, 'node-1'), /changed/);
    assert.equal(f.runner.appliedPatch, '');
    assert.equal(f.service.history[0].status, 'failed');
  } finally {
    await f.cleanup();
  }
});
test('control-plane reboot cannot remove the remaining etcd majority', async () => {
  const f = await fixture(true);
  try {
    f.runner.members = 3;
    f.runner.etcdHealthy = false;
    await assert.rejects(f.service.plan('test', '192.0.2.11', 'reboot'), /majority/);
    assert.equal(
      f.runner.calls.some((c) => c.includes('reboot')),
      false,
    );
  } finally {
    await f.cleanup();
  }
});
test('failed patch cleans temporary data and records failure', async () => {
  const f = await fixture(true);
  try {
    const p = await f.service.plan('test', '192.0.2.11', 'patch', 'machine: {}');
    f.runner.failApply = true;
    await assert.rejects(f.service.execute(p.id, 'node-1'), /rejected/);
    await assert.rejects(access(f.runner.temporaryPath));
    assert.equal(f.service.history[0].status, 'failed');
  } finally {
    await f.cleanup();
  }
});
test('HTTP bridge blocks foreign origins, forged hosts, cross-site fetches and missing session', async () => {
  const f = await fixture();
  const app = await createApp(f.service, { staticDir: join(tmpdir(), 'studio-nonexistent') });
  try {
    const host = { host: '127.0.0.1:4317' };
    for (const headers of [
      { host: 'evil.example:4317' },
      { ...host, origin: 'https://evil.example' },
      { ...host, 'sec-fetch-site': 'cross-site' },
      { ...host, 'sec-fetch-site': 'same-site' },
    ])
      assert.equal((await app.inject({ url: '/api/session', headers })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/connection', headers: host })).statusCode, 403);
    const token = (await app.inject({ url: '/api/session', headers: host })).json().token;
    const headers = { ...host, 'x-studio-token': token };
    const connection = await app.inject({ url: '/api/connection', headers });
    assert.equal(connection.statusCode, 200);
    assert.equal(connection.body.includes('synthetic-secret'), false);
    assert.equal((await app.inject({ url: '/api/machines?context=test', headers })).statusCode, 200);
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/execute',
          headers,
          payload: { id: 'fake', confirmation: 'node-1' },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/run', headers, payload: { args: ['reboot'] } }))
        .statusCode,
      404,
    );
  } finally {
    await app.close();
    await f.cleanup();
  }
});
test('demo never invokes installed executable and refuses writes', async () => {
  const runner = new FakeRunner(),
    service = new TalosService(runner, { demo: true, writes: true });
  await service.connection();
  const machines = await service.machines('homelab');
  await service.inspect('homelab', machines[0].address);
  await service.logs('homelab', machines[0].address, 'kubelet');
  const p = await service.plan('homelab', machines[0].address, 'patch', 'machine: {}');
  await assert.rejects(service.execute(p.id, p.name), /disabled/);
  assert.equal(runner.calls.length, 0);
});
test('process runner times out, limits output and handles nonzero exits', async () => {
  const runner = new TalosRunner(process.execPath);
  await assert.rejects(runner.run(['-e', 'setTimeout(()=>{},10000)'], { timeout: 30 }), /timed out/);
  await assert.rejects(runner.run(['-e', 'process.stdout.write("a".repeat(5*1024*1024))']), /limit/);
  await assert.rejects(
    runner.run(['-e', 'process.stderr.write("token: sensitive");process.exit(1)']),
    /REDACTED/,
  );
  assert.equal(
    await runner.run(['-e', 'process.stdout.write(process.argv[1])', 'literal;echo unsafe']),
    'literal;echo unsafe',
  );
});
test('expired review cannot invoke a write', async (t) => {
  const f = await fixture(true);
  try {
    const p = await f.service.plan('test', '192.0.2.11', 'patch', 'machine: {}');
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    t.mock.timers.tick(120001);
    await assert.rejects(f.service.execute(p.id, 'node-1'), /expired/);
    assert.equal(f.runner.appliedPatch, '');
  } finally {
    t.mock.timers.reset();
    await f.cleanup();
  }
});
test('disconnecting a live log stream terminates its child process', { timeout: 10000 }, async () => {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as import('node:net').AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const f = await fixture();
  let child: ReturnType<Runner['stream']> | undefined;
  f.runner.stream = () => {
    child = spawn(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("line\\n"),10)'], {
      stdio: 'pipe',
    });
    return child;
  };
  const app = await createApp(f.service, { port, staticDir: join(tmpdir(), 'studio-nonexistent') });
  try {
    await app.listen({ port, host: '127.0.0.1' });
    const url = `http://127.0.0.1:${port}`;
    const { token } = (await (await fetch(url + '/api/session')).json()) as { token: string };
    const response = await fetch(url + '/api/logs/stream', {
      method: 'POST',
      headers: { 'X-Studio-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: 'test', node: '192.0.2.11', service: 'kubelet' }),
    });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /line/);
    await reader.cancel();
    for (let i = 0; i < 20 && !child?.killed; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(child?.killed, true);
  } finally {
    child?.kill();
    await app.close();
    await f.cleanup();
  }
});
