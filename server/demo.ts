import type { Connection, Machine, Inspector } from '../shared/types.ts';
export const demoConnection: Connection = {
  contexts: [
    { name: 'homelab', endpoints: ['192.0.2.11'], nodes: ['192.0.2.11'] },
    { name: 'staging', endpoints: ['192.0.2.51'], nodes: ['192.0.2.51'] },
  ],
  current: 'homelab',
  version: 'Demo · no talosctl commands',
  demo: true,
  writes: false,
};
export function demoMachines(context: string): Machine[] {
  return Array.from({ length: context === 'staging' ? 3 : 6 }, (_, i) => ({
    name: i < 3 ? `control-0${i + 1}` : `worker-0${i - 2}`,
    address: `192.0.2.${(context === 'staging' ? 51 : 11) + i}`,
    role: i < 3 ? 'controlplane' : 'worker',
    version: i === 4 ? 'v1.12.0' : 'v1.13.0',
    reachable: i !== 5,
    ready: i === 5 ? null : true,
    stage: i === 5 ? 'unknown' : 'running',
    checkedAt: new Date().toISOString(),
    ...(i === 5 ? { error: 'Demo machine is unreachable' } : {}),
  }));
}
export function demoInspector(machine: Machine): Inspector {
  return {
    machine,
    services: machine.reachable
      ? ['apid', 'containerd', 'kubelet', ...(machine.role === 'controlplane' ? ['etcd'] : [])].map(
          (name) => ({ name, running: true, healthy: true }),
        )
      : [],
    hardware: [
      {
        kind: 'System',
        resources: [
          {
            id: 'systeminformation',
            spec: { manufacturer: 'Example hardware', productName: 'Demo machine' },
          },
        ],
      },
      { kind: 'Processors', resources: [{ id: 'cpu0', spec: { coreCount: 8, threadCount: 16 } }] },
      { kind: 'Memory', resources: [{ id: 'dimm0', spec: { size: '32 GiB' } }] },
      { kind: 'Disks', resources: [{ id: 'nvme0n1', spec: { model: 'Demo NVMe', size: '1 TB' } }] },
    ],
    errors: machine.reachable ? [] : ['Live inspection unavailable'],
  };
}
