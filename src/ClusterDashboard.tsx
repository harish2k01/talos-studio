import { useEffect, useState } from 'react';
import { ArrowRight, Server, Activity } from 'lucide-react';
import type { Inspector, Machine } from '../shared/types.ts';
import { api, query } from './api.ts';

export function ClusterDashboard({
  context,
  machines,
  loading,
  inspect,
  configure,
}: {
  context: string;
  machines: Machine[];
  loading: boolean;
  inspect: (machine: Machine) => void;
  configure: () => void;
}) {
  const [address, setAddress] = useState('');
  const [readings, setReadings] = useState<Record<string, Inspector>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const machine = machines.find((n) => n.address === address) || machines[0];
  useEffect(() => {
    const abort = new AbortController();
    setReadings({});
    setFailures({});
    for (const node of machines) {
      if (!node.reachable) continue;
      void api<Inspector>('inspect?' + query({ context, node: node.address }), { signal: abort.signal })
        .then((data) => {
          if (!abort.signal.aborted) setReadings((old) => ({ ...old, [node.address]: data }));
        })
        .catch((error) => {
          if (!abort.signal.aborted) setFailures((old) => ({ ...old, [node.address]: error.message }));
        });
    }
    return () => abort.abort();
  }, [context, machines]);
  const ready = machines.filter((n) => n.reachable && n.ready === true).length;
  const services = [...new Set(Object.values(readings).flatMap((r) => r.services.map((s) => s.name)))].sort();
  const planes = machines.filter((n) => n.role === 'controlplane');
  const workers = machines.filter((n) => n.role !== 'controlplane');
  const nodeButton = (node: Machine) => (
    <button
      key={node.address}
      className={'topology-node ' + (node.address === machine?.address ? 'active' : '')}
      aria-pressed={node.address === machine?.address}
      onClick={() => setAddress(node.address)}
    >
      <Server size={16} />
      <span>
        {node.name}
        <small>{node.role === 'controlplane' ? 'Control plane' : node.role}</small>
      </span>
      <i className={'dot ' + (node.ready === true && node.reachable ? 'good' : 'warn')} />
    </button>
  );
  return (
    <section className="cluster-bento" aria-label="Cluster dashboard">
      <article className="panel health-pulse">
        <div className="section-header">
          <h2>Cluster pulse</h2>
          <span className="pill">{loading ? 'Refreshing' : 'Latest discovery'}</span>
        </div>
        <div className="pulse-number">
          {ready}
          <span> / {machines.length}</span>
        </div>
        <p className="muted">Machines ready</p>
        <div className="readiness-track" aria-label={`${ready} of ${machines.length} machines ready`}>
          {machines.map((n) => (
            <button
              key={n.address}
              className={n.reachable && n.ready === true ? 'healthy' : 'attention'}
              aria-label={`Inspect ${n.name}`}
              onClick={() => inspect(n)}
            />
          ))}
        </div>
        <div className="pulse-facts">
          <span>
            <strong>{planes.length}</strong>Control plane
          </span>
          <span>
            <strong>{workers.length}</strong>Other members
          </span>
          <span>
            <strong>{machines.filter((n) => !n.reachable).length}</strong>Unreachable
          </span>
        </div>
        <p className="small muted">
          Machine readiness · etcd quorum and resource utilization are not measured here.
        </p>
      </article>
      <article className="panel matrix-panel">
        <div className="section-header">
          <h2>Service health</h2>
          <span className="pill">Live inspection</span>
        </div>
        <div className="matrix-scroll">
          <table className="health-matrix">
            <thead>
              <tr>
                <th>Service</th>
                {machines.map((n) => (
                  <th key={n.address}>{n.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {services.map((name) => (
                <tr key={name}>
                  <th>{name}</th>
                  {machines.map((n) => {
                    const service = readings[n.address]?.services.find((s) => s.name === name);
                    const health =
                      service?.healthy === true
                        ? 'Healthy'
                        : service?.healthy === false
                          ? 'Unhealthy'
                          : 'Unknown';
                    return (
                      <td key={n.address}>
                        <button
                          className={'health-cell ' + health.toLowerCase()}
                          aria-label={`${n.name} ${name}: ${health}`}
                          title={`${n.name} · ${name} · ${health}`}
                          onClick={() => inspect(n)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!services.length && (
          <p className="muted">
            {machines.length ? 'Waiting for service readings…' : 'Discover machines to inspect services.'}
          </p>
        )}
        {Object.keys(failures).length > 0 && (
          <p role="status" className="small warn">
            {Object.keys(failures).length} machine inspections unavailable. Open a machine for details.
          </p>
        )}
        <div className="matrix-legend">
          <span>
            <i className="health-cell healthy" />
            Healthy
          </span>
          <span>
            <i className="health-cell unhealthy" />
            Unhealthy
          </span>
          <span>
            <i className="health-cell unknown" />
            Unknown
          </span>
        </div>
      </article>
      <article className="panel machine-focus">
        <div className="section-header">
          <select
            aria-label="Dashboard machine"
            value={machine?.address || ''}
            onChange={(e) => setAddress(e.target.value)}
          >
            {machines.map((n) => (
              <option key={n.address} value={n.address}>
                {n.name}
              </option>
            ))}
          </select>
          <button className="primary" disabled={!machine} onClick={() => machine && inspect(machine)}>
            Inspect <ArrowRight size={14} />
          </button>
        </div>
        <div className="server-illustration" role="img" aria-label="Illustrative server chassis">
          <div className="server-chassis">
            <i className="power-light" />
            {[0, 1, 2, 3].map((i) => (
              <div className="drive-bay" key={i}>
                <span />
                <i />
              </div>
            ))}
            <div className="server-vents" />
          </div>
        </div>
        <div className="focus-heading">
          <h2>{machine?.name || 'No machine selected'}</h2>
          <span className={'status ' + (machine?.ready === true && machine.reachable ? 'good' : 'warn')}>
            {machine?.ready === true && machine.reachable ? 'Ready' : 'Needs attention'}
          </span>
        </div>
        <p className="muted mono">{machine?.address || 'Awaiting discovery'}</p>
        <dl className="focus-facts">
          <div>
            <dt>Stage</dt>
            <dd>{machine?.stage || '—'}</dd>
          </div>
          <div>
            <dt>Talos</dt>
            <dd>{machine?.version || '—'}</dd>
          </div>
          <div>
            <dt>Last checked</dt>
            <dd>{machine ? new Date(machine.checkedAt).toLocaleTimeString() : '—'}</dd>
          </div>
        </dl>
        <p className="small muted">Select a node in the topology to focus it here.</p>
      </article>
      <article className="panel topology-panel">
        <div className="section-header">
          <h2>Cluster topology</h2>
          <span className="pill">{ready} ready</span>
        </div>
        <div className="topology-planes">{planes.map(nodeButton)}</div>
        <div className="topology-branches">{workers.map(nodeButton)}</div>
        {!machines.length && (
          <p className="muted">{loading ? 'Discovering cluster members…' : 'No topology available'}</p>
        )}
        <p className="small muted">
          Membership by role · connections show grouping, not measured network links.
        </p>
      </article>
      <article className="panel quick-workflows">
        <Activity size={20} />
        <h2>Operate with confidence</h2>
        <p className="muted">Inspect services and logs, then review a targeted change.</p>
        <button onClick={configure}>
          Review configuration <ArrowRight size={15} />
        </button>
        <p className="small muted">
          Your credentials stay local. Writes follow the session’s permission settings.
        </p>
      </article>
    </section>
  );
}
