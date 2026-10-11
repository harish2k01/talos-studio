import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { isIP } from 'node:net';
import { randomUUID, createHash } from 'node:crypto';
import type { Connection, Machine, Inspector, Operation, Plan } from '../shared/types.ts';
import { parseConfig, parseResources, redact, validatePatch } from './parsers.ts';
import type { Runner } from './runner.ts';
import { demoConnection, demoMachines, demoInspector } from './demo.ts';

interface Pending {
  plan: Plan;
  patch?: string;
  fingerprint: string;
  deadline: number;
}
export class TalosService {
  readonly history: Operation[] = [];
  private plans = new Map<string, Pending>();
  private discovery = new Map<string, { expires: number; machines: Machine[] }>();
  private connectionCache?: { expires: number; value: Connection };
  private executing = new Set<string>();
  constructor(
    readonly runner: Runner,
    readonly options: { demo?: boolean; writes?: boolean; configPath?: string } = {},
  ) {}
  async connection(): Promise<Connection> {
    if (this.options.demo) return demoConnection;
    if (this.connectionCache && this.connectionCache.expires > Date.now()) return this.connectionCache.value;
    let config;
    try {
      config = parseConfig(
        await readFile(
          this.options.configPath || process.env.TALOSCONFIG || join(homedir(), '.talos', 'config'),
          'utf8',
        ),
      );
    } catch {
      throw new Error(
        'Cannot read talosconfig. Create a context with talosctl or set TALOSCONFIG to an existing configuration file.',
      );
    }
    const version = await this.runner.run(['version', '--client']);
    const value = {
      ...config,
      version: version.match(/Tag:\s*(\S+)/)?.[1] || version.trim(),
      demo: false,
      writes: !!this.options.writes,
    };
    this.connectionCache = { expires: Date.now() + 10000, value };
    return value;
  }
  private base(context: string, node?: string) {
    return [
      ...(this.options.configPath ? ['--talosconfig', this.options.configPath] : []),
      '--context',
      context,
      ...(node ? ['--nodes', node] : []),
    ];
  }
  async assertContext(context: unknown): Promise<string> {
    if (typeof context !== 'string' || !(await this.connection()).contexts.some((c) => c.name === context))
      throw new Error('Unknown Talos context');
    return context;
  }
  async machines(contextValue: unknown, force = false): Promise<Machine[]> {
    const context = await this.assertContext(contextValue);
    if (this.options.demo) return demoMachines(context);
    const cached = this.discovery.get(context);
    if (!force && cached && cached.expires > Date.now()) return cached.machines;
    const c = (await this.connection()).contexts.find((c) => c.name === context)!;
    const seeds = [...new Set([...c.nodes, ...c.endpoints])].filter((n) => isIP(n));
    if (!seeds.length)
      throw new Error(
        'This context needs at least one numeric node address. Set it with talosctl config node <address>.',
      );
    let resources: ReturnType<typeof parseResources> = [],
      lastError: unknown;
    for (const seed of seeds.slice(0, 3)) {
      try {
        resources = parseResources(
          await this.runner.run([...this.base(context, seed), 'get', 'members', '-o', 'json']),
        );
        if (resources.length) break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!resources.length)
      throw new Error(lastError instanceof Error ? lastError.message : 'No cluster members discovered');
    const members = resources
      .map((r) => {
        const addresses = Array.isArray(r.spec.addresses)
          ? r.spec.addresses.filter((a: unknown): a is string => typeof a === 'string' && !!isIP(a))
          : [];
        const address = addresses.find((a: string) => isIP(a) === 4) || addresses[0];
        return {
          name: typeof r.spec.hostname === 'string' ? r.spec.hostname : r.metadata.id,
          address,
          nodeId: typeof r.spec.nodeId === 'string' ? r.spec.nodeId : undefined,
          role: String(r.spec.machineType || 'unknown'),
          version: String(r.spec.operatingSystem || 'Unknown'),
          reachable: false,
          ready: null,
          stage: 'unknown',
          checkedAt: new Date().toISOString(),
        } as Machine;
      })
      .filter((n) => !!n.address);
    if (members.length > 64) throw new Error('This release supports up to 64 machines per context');
    const machines: Machine[] = [];
    // Limit concurrent probes independently of fleet size.
    for (let i = 0; i < members.length; i += 4)
      machines.push(...(await Promise.all(members.slice(i, i + 4).map((n) => this.probe(context, n)))));
    machines.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
    this.discovery.set(context, { expires: Date.now() + 5000, machines });
    return machines;
  }
  private async probe(context: string, machine: Machine): Promise<Machine> {
    try {
      const [r] = parseResources(
        await this.runner.run([...this.base(context, machine.address), 'get', 'machinestatus', '-o', 'json']),
      );
      if (!r) throw new Error('No machine status returned');
      return {
        ...machine,
        reachable: true,
        ready: typeof r.spec.status?.ready === 'boolean' ? r.spec.status.ready : null,
        stage: String(r.spec.stage || 'unknown'),
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      return { ...machine, checkedAt: new Date().toISOString(), error: message(e) };
    }
  }
  async node(context: unknown, node: unknown, force = false): Promise<Machine> {
    if (typeof node !== 'string' || !isIP(node)) throw new Error('Choose a discovered machine address');
    const machine = (await this.machines(context, force)).find((n) => n.address === node);
    if (!machine) throw new Error('Machine does not belong to this context');
    return machine;
  }
  async inspect(context: string, node: string): Promise<Inspector> {
    const machine = await this.node(context, node);
    if (this.options.demo) return demoInspector(machine);
    const errors: string[] = [];
    let services: Inspector['services'] = [];
    try {
      services = await this.services(context, node);
    } catch (e) {
      errors.push(message(e));
    }
    const hardware: Inspector['hardware'] = [];
    for (const [kind, type] of [
      ['System', 'systeminformation'],
      ['Processors', 'processors.hardware.talos.dev'],
      ['Memory', 'memorymodules'],
      ['Disks', 'disks'],
    ]) {
      try {
        const result = parseResources(
          await this.runner.run([...this.base(context, node), 'get', type, '-o', 'json']),
        );
        hardware.push({ kind, resources: result.map((r) => ({ id: r.metadata.id, spec: r.spec })) });
      } catch (e) {
        hardware.push({ kind, resources: [], error: message(e) });
      }
    }
    return { machine, services, hardware, errors };
  }
  async services(context: string, node: string) {
    return parseResources(
      await this.runner.run([...this.base(context, node), 'get', 'services', '-o', 'json']),
    ).map((r) => ({
      name: r.metadata.id,
      running: r.spec.running === true,
      healthy: r.spec.unknown ? null : typeof r.spec.healthy === 'boolean' ? r.spec.healthy : null,
    }));
  }
  async logArgs(context: string, node: string, service: unknown): Promise<string[]> {
    const machine = await this.node(context, node);
    if (!machine.reachable) throw new Error('Machine is unreachable');
    const services = this.options.demo ? demoInspector(machine).services : await this.services(context, node);
    if (
      typeof service !== 'string' ||
      !/^[a-zA-Z0-9_.-]+$/.test(service) ||
      !services.some((s) => s.name === service)
    )
      throw new Error('Choose a service reported by this machine');
    return [...this.base(context, node), 'logs', service, '--tail', '200'];
  }
  async logs(context: string, node: string, service: string): Promise<string> {
    const args = await this.logArgs(context, node, service);
    if (this.options.demo) return `Demo ${service} logs\nINFO Runtime ready\nINFO Health check completed\n`;
    return this.runner.run(args);
  }
  private writeAllowed() {
    if (this.options.demo || !this.options.writes)
      throw new Error('Writes are disabled. Restart with STUDIO_WRITES=1 to enable reviewed actions.');
  }
  private async patchFile<T>(patch: string, task: (path: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'talos-studio-'));
    try {
      const path = join(dir, 'patch.yaml');
      await writeFile(path, patch, { mode: 0o600 });
      return await task(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  async plan(context: string, node: string, kind: unknown, patch?: unknown): Promise<Plan> {
    if (kind !== 'patch' && kind !== 'reboot') throw new Error('Unsupported operation');
    if (kind === 'reboot') this.writeAllowed();
    const machine = await this.node(context, node, true);
    if (!machine.reachable || machine.ready !== true)
      throw new Error('Machine must be reachable and ready before reviewing an action');
    let preview = '',
      warning = 'Configuration is applied in no-reboot mode. Changes requiring a reboot are rejected.',
      patchText: string | undefined;
    if (kind === 'patch') {
      if (typeof patch !== 'string') throw new Error('A merge patch is required');
      validatePatch(patch);
      patchText = patch;
      if (this.options.demo)
        preview = 'Demo patch validated for preview only. No Talos command executed.\n' + patch;
      else
        preview = redact(
          await this.patchFile(patch, (path) =>
            this.runner.run(
              [
                ...this.base(context, node),
                'patch',
                'machineconfig',
                '--patch-file',
                path,
                '--mode',
                'no-reboot',
                '--dry-run',
              ],
              { timeout: 30000 },
            ),
          ),
        );
      if (!preview.trim()) preview = 'Talos accepted the dry run. No configuration changes were reported.';
    } else {
      await this.checkReboot(context, machine);
      warning =
        machine.role === 'controlplane'
          ? 'Rebooting a control plane interrupts its API and etcd service. A single control plane means a cluster management outage.'
          : 'The node will be drained before reboot. Workloads may be interrupted; eviction can fail if disruption budgets prevent it.';
      preview =
        'The local bridge will request a drain and reboot. Request acceptance is recorded; use a fresh health check to verify recovery.';
    }
    const deadline = Date.now() + 120000,
      id = randomUUID();
    const plan: Plan = {
      id,
      kind,
      context,
      node,
      name: machine.name,
      warning,
      preview,
      expiresAt: new Date(deadline).toISOString(),
      command: [
        'talosctl',
        ...this.base(context, node).filter(
          (_, i, arr) => arr[i - 1] !== '--talosconfig' && arr[i] !== '--talosconfig',
        ),
        ...(kind === 'reboot'
          ? ['reboot', '--drain', '--wait=false']
          : ['patch', 'machineconfig', '--patch-file', '<reviewed-patch>', '--mode', 'no-reboot']),
      ].join(' '),
    };
    for (const [key, p] of this.plans) if (p.deadline <= Date.now()) this.plans.delete(key);
    if (this.plans.size >= 100) throw new Error('Too many pending reviews');
    this.plans.set(id, { plan, patch: patchText, fingerprint: fingerprint(machine), deadline });
    setTimeout(() => this.plans.delete(id), 120000).unref();
    return plan;
  }
  private async checkReboot(context: string, target: Machine) {
    if (target.role !== 'controlplane') return;
    const planes = (await this.machines(context)).filter((n) => n.role === 'controlplane');
    if (planes.length === 1) return; // Explicit outage warning on the review screen.
    let healthy = 0;
    for (const n of planes) {
      try {
        if (
          (await this.services(context, n.address)).some(
            (s) => s.name === 'etcd' && s.healthy === true && s.running,
          )
        )
          healthy++;
      } catch {
        /* Unknown is unhealthy for quorum safety. */
      }
    }
    if (healthy - 1 < Math.floor(planes.length / 2) + 1)
      throw new Error('Reboot blocked: remaining healthy etcd members would not form a majority');
  }
  async execute(id: unknown, confirmation: unknown): Promise<Operation> {
    this.writeAllowed();
    const pending = typeof id === 'string' ? this.plans.get(id) : undefined;
    if (!pending || pending.deadline <= Date.now())
      throw new Error('Review expired or was already used. Create a new review.');
    if (confirmation !== pending.plan.name) throw new Error('Type the exact machine name to confirm');
    this.plans.delete(pending.plan.id); // Single use, including unsuccessful attempts after confirmation.
    const p = pending.plan,
      key = `${p.context}:${p.node}`;
    if (this.executing.has(key)) throw new Error('An operation is already running on this machine');
    this.executing.add(key);
    try {
      const machine = await this.node(p.context, p.node, true);
      if (!machine.reachable || machine.ready !== true || fingerprint(machine) !== pending.fingerprint)
        throw new Error('Machine changed or became unavailable; create a fresh review');
      if (p.kind === 'reboot') await this.checkReboot(p.context, machine);
      if (p.kind === 'patch')
        await this.patchFile(pending.patch!, (path) =>
          this.runner.run(
            [
              ...this.base(p.context, p.node),
              'patch',
              'machineconfig',
              '--patch-file',
              path,
              '--mode',
              'no-reboot',
            ],
            { timeout: 30000 },
          ),
        );
      else
        await this.runner.run([...this.base(p.context, p.node), 'reboot', '--drain', '--wait=false'], {
          timeout: 330000,
        });
      this.discovery.delete(p.context);
      return this.record(
        p,
        'completed',
        p.kind === 'reboot'
          ? 'Drain/reboot request accepted; recovery not yet verified'
          : 'Configuration patch accepted in no-reboot mode',
      );
    } catch (e) {
      this.record(p, 'failed', message(e));
      throw e;
    } finally {
      this.executing.delete(key);
    }
  }
  private record(p: Plan, status: Operation['status'], summary: string): Operation {
    const result: Operation = {
      id: randomUUID(),
      kind: p.kind,
      context: p.context,
      node: p.node,
      status,
      createdAt: new Date().toISOString(),
      summary: redact(summary),
    };
    this.history.unshift(result);
    this.history.splice(100);
    return result;
  }
}
function fingerprint(n: Machine) {
  return createHash('sha256')
    .update(JSON.stringify([n.name, n.address, n.nodeId, n.role, n.version]))
    .digest('hex');
}
export function message(error: unknown) {
  return redact(error instanceof Error ? error.message : 'Talos request failed');
}
