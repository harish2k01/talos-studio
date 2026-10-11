import { Cpu, HardDrive, MemoryStick, Server } from 'lucide-react';
import type { Hardware } from '../shared/types.ts';

const labels: Record<string, string> = {
  coreCount: 'Cores',
  threadCount: 'Threads',
  size: 'Capacity',
  sizeMiB: 'Capacity (MiB)',
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
const display = (value: unknown) => (typeof value === 'object' ? JSON.stringify(value) : String(value));
export function HardwareView({ hardware }: { hardware: Hardware[] }) {
  return (
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
                    : `${group.resources.length} ${group.resources.length === 1 ? 'resource' : 'resources'} detected`}
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
                          <dd>{display(value)}</dd>
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
  );
}
