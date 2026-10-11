import { Cpu, HardDrive, MemoryStick, Server } from 'lucide-react';
import type { Hardware } from '../shared/types.ts';

const labels: Record<string, string> = {
  coreCount: 'Cores',
  threadCount: 'Threads',
  size: 'Capacity',
  sizeMiB: 'Memory',
  sizeMB: 'Capacity (MB)',
  model: 'Model',
  manufacturer: 'Manufacturer',
  productName: 'Product',
  speed: 'Speed',
  type: 'Type',
  serialNumber: 'Serial number',
  busPath: 'Bus path',
  pretty_size: 'Capacity',
};
const memory = (value: unknown) =>
  typeof value === 'number' ? `${Number((value / 1024).toFixed(2))} GiB` : String(value);
const display = (value: unknown) => (typeof value === 'object' ? JSON.stringify(value) : String(value));
export function HardwareView({ hardware }: { hardware: Hardware[] }) {
  const cpus = hardware.find((h) => h.kind === 'Processors');
  const ram = hardware.find((h) => h.kind === 'Memory');
  const disks = hardware.find((h) => h.kind === 'Disks');
  const physicalDisks = disks?.resources.filter((r) => !/^loop\d+$/.test(r.id)) || [];
  const cores = cpus?.resources.reduce(
    (sum, r) => sum + (typeof r.spec.coreCount === 'number' ? r.spec.coreCount : 0),
    0,
  );
  const ramMiB = ram?.resources.reduce(
    (sum, r) => sum + (typeof r.spec.sizeMiB === 'number' ? r.spec.sizeMiB : 0),
    0,
  );
  return (
    <>
      <div className="hardware-glance">
        <div>
          <Cpu size={19} />
          <strong>{cores || '—'}</strong>
          <span>CPU cores</span>
        </div>
        <div>
          <MemoryStick size={19} />
          <strong>
            {ramMiB
              ? memory(ramMiB)
              : ram?.resources[0]?.spec.size
                ? String(ram.resources[0].spec.size)
                : '—'}
          </strong>
          <span>Installed memory</span>
        </div>
        <div>
          <HardDrive size={19} />
          <strong>{disks?.error ? '—' : physicalDisks.length}</strong>
          <span>Disks · excludes loop devices</span>
        </div>
        <div>
          <Server size={19} />
          <strong>
            {physicalDisks[0]?.spec.pretty_size
              ? String(physicalDisks[0].spec.pretty_size)
              : physicalDisks[0]?.spec.size
                ? String(physicalDisks[0].spec.size)
                : '—'}
          </strong>
          <span>First disk capacity</span>
        </div>
      </div>
      <div className="hardware-sections hardware-cards">
        {hardware.map((group) => {
          const Icon =
            group.kind === 'Processors'
              ? Cpu
              : group.kind === 'Memory'
                ? MemoryStick
                : group.kind === 'Disks'
                  ? HardDrive
                  : Server;
          return (
            <section className="hardware-card" key={group.kind}>
              <header>
                <span className="hardware-symbol">
                  <Icon size={22} />
                </span>
                <div>
                  <h3>
                    {group.kind === 'System'
                      ? 'Machine identity'
                      : group.kind === 'Processors'
                        ? 'Processors'
                        : group.kind}
                  </h3>
                  <p className="muted small">
                    {group.error
                      ? 'Reading unavailable'
                      : `${(group.kind === 'Disks' ? physicalDisks : group.resources).length} ${(group.kind === 'Disks' ? physicalDisks : group.resources).length === 1 ? 'resource' : 'resources'} detected`}
                  </p>
                </div>
              </header>
              {group.error && (
                <p role="status" className="inline-error">
                  {group.error}
                </p>
              )}
              {!group.error && !group.resources.length && (
                <p className="muted">No resources reported by this machine.</p>
              )}
              {group.resources
                .filter((resource) => group.kind !== 'Disks' || !/^loop\d+$/.test(resource.id))
                .map((resource) => {
                  const facts = Object.entries(resource.spec).filter(
                    ([key]) => labels[key] && !(key === 'size' && resource.spec.pretty_size),
                  );
                  return (
                    <article className="hardware-resource" key={resource.id}>
                      <h4>{String(resource.spec.model || resource.spec.productName || resource.id)}</h4>
                      <dl>
                        {facts.map(([key, value]) => (
                          <div key={key}>
                            <dt>{labels[key]}</dt>
                            <dd>{key === 'sizeMiB' ? memory(value) : display(value)}</dd>
                          </div>
                        ))}
                      </dl>
                      {!facts.length && (
                        <p className="muted small">
                          Summary fields unavailable. Technical details are available below.
                        </p>
                      )}
                      <details>
                        <summary>
                          Technical details <span>{resource.id}</span>
                        </summary>
                        <pre>{JSON.stringify(resource.spec, null, 2)}</pre>
                      </details>
                    </article>
                  );
                })}
              {group.kind === 'Disks' && group.resources.some((r) => /^loop\d+$/.test(r.id)) && (
                <details className="virtual-devices">
                  <summary>Virtual block devices</summary>
                  <pre>
                    {JSON.stringify(
                      group.resources.filter((r) => /^loop\d+$/.test(r.id)),
                      null,
                      2,
                    )}
                  </pre>
                </details>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
