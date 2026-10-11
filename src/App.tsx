import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  FileCode2,
  Hexagon,
  LayoutDashboard,
  LayoutGrid,
  List,
  LoaderCircle,
  Moon,
  Plug,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sun,
  Terminal,
  X,
} from 'lucide-react';
import type { Connection, Inspector, Machine, Operation, Plan } from '../shared/types.ts';
import { api, followLogs, query } from './api.ts';

const pages = [
  { name: 'Overview', icon: LayoutDashboard },
  { name: 'Machines', icon: Server },
  { name: 'Configuration', icon: FileCode2 },
  { name: 'Operations', icon: Activity },
  { name: 'Connections', icon: Plug },
];
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');
const role = (s: string) => (s === 'controlplane' ? 'Control plane' : s === 'worker' ? 'Worker' : s);
const time = (s: string) =>
  new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const status = (m: Machine) =>
  !m.reachable
    ? 'Unreachable'
    : m.ready === true
      ? 'Ready'
      : m.ready === false
        ? 'Not ready'
        : 'Readiness unknown';
const stateClass = (m: Machine) => (m.reachable && m.ready === true ? 'good' : 'warn');

export function App() {
  const [connection, setConnection] = useState<Connection>();
  const [context, setContext] = useState('');
  const [page, setPage] = useState('Overview'),
    [theme, setTheme] = useState(() => localStorage.getItem('studio-theme') || 'dark');
  const [machines, setMachines] = useState<Machine[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [view, setView] = useState('cards'),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<Machine>(),
    [plan, setPlan] = useState<Plan>(),
    [toast, setToast] = useState('');
  const machineRequest = useRef(0);
  const machineAbort = useRef<AbortController | null>(null);
  const notify = (text: string) => setToast(text);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('studio-theme', theme);
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const connect = useCallback(async (signal?: AbortSignal) => {
    setError('');
    try {
      const c = await api<Connection>('connection', { signal });
      setConnection(c);
      setContext((previous) =>
        c.contexts.some((x) => x.name === previous) ? previous : c.current || c.contexts[0]?.name || '',
      );
    } catch (e) {
      if (!signal?.aborted) {
        setError(errorText(e));
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void connect(abort.signal);
    return () => abort.abort();
  }, [connect]);
  const refresh = useCallback(async () => {
    if (!context) return;
    const id = ++machineRequest.current;
    machineAbort.current?.abort();
    const abort = new AbortController();
    machineAbort.current = abort;
    setLoading(true);
    setError('');
    try {
      const data = await api<Machine[]>('machines?' + query({ context, refresh: '1' }), {
        signal: abort.signal,
      });
      if (id === machineRequest.current) setMachines(data);
    } catch (e) {
      if (id === machineRequest.current && !abort.signal.aborted) setError(errorText(e));
    } finally {
      if (id === machineRequest.current && !abort.signal.aborted) setLoading(false);
    }
  }, [context]);
  useEffect(() => {
    setMachines([]);
    setSelected(undefined);
    setPlan(undefined);
    setSearch('');
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      clearInterval(timer);
      machineAbort.current?.abort();
      machineRequest.current++;
    };
  }, [refresh]);
  const needs = machines.filter((n) => !n.reachable || n.ready !== true),
    ready = machines.filter((n) => n.reachable && n.ready === true).length;
  const planes = machines.filter((n) => n.role === 'controlplane'),
    versions = new Set(machines.map((n) => n.version));
  const visible = machines.filter(
    (n) =>
      (filter === 'all' || (filter === 'attention' ? !n.reachable || n.ready !== true : n.role === filter)) &&
      `${n.name} ${n.address}`.toLowerCase().includes(search.toLowerCase()),
  );
  const reviewReboot = async (machine: Machine) => {
    try {
      const result = await api<Plan>('plans', { body: { context, node: machine.address, kind: 'reboot' } });
      setPlan(result);
    } catch (e) {
      notify(errorText(e));
    }
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Talos Studio home">
          <span className="brand-mark">
            <Hexagon size={21} />
          </span>
          Talos <strong>Studio</strong>
        </a>
        <span className="preview-label">{connection?.demo ? 'DEMO WORKSPACE' : 'LOCAL WORKSPACE'}</span>
        <div className="top-actions">
          <span className="bridge">
            <span className={connection ? 'dot good' : 'dot warn'} />
            {connection ? 'Bridge connected' : 'Connecting'}
          </span>
          <button
            className="icon-button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <div className="nav-caption">Workspace</div>
        <nav aria-label="Main navigation">
          {pages.map((p) => (
            <button
              key={p.name}
              aria-current={page === p.name ? 'page' : undefined}
              className={'nav-item ' + (page === p.name ? 'selected' : '')}
              onClick={() => setPage(p.name)}
            >
              <p.icon size={18} />
              {p.name}
              {p.name === 'Machines' && machines.length > 0 && (
                <span className="nav-count">{machines.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={20} />
          <div>
            {connection?.writes ? 'Reviewed writes enabled' : 'Read-only session'}
            <small>{connection?.demo ? 'Sample data only' : 'Credentials stay local'}</small>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="page-header">
          <div>
            <div className="breadcrumb">
              Workspace <ChevronRight size={12} /> {context || 'Connection'}
            </div>
            <h1>{page === 'Overview' ? 'Your cluster, at a glance.' : page}</h1>
            <p className="muted">
              {
                (
                  {
                    Overview: 'Machine health and the next thing that needs your attention.',
                    Machines: 'Inspect your machines, services and hardware.',
                    Configuration: 'Review a targeted configuration patch before applying it.',
                    Operations: 'Results from this bridge session. Recovery is verified separately.',
                    Connections: 'Local tools and cluster access, in one place.',
                  } as Record<string, string>
                )[page]
              }
            </p>
          </div>
          <div className="header-actions">
            {connection && (
              <label className="context-select">
                <Hexagon size={15} />
                <select
                  aria-label="Talos context"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                >
                  {connection.contexts.map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="icon-button"
              aria-label="Refresh connection and machine health"
              disabled={loading && !!connection}
              onClick={() => void (connection ? refresh() : connect())}
            >
              <RefreshCw size={17} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </div>
        {error && (
          <div role="alert" className="alert error">
            <CircleAlert size={20} />
            <div>
              <strong>Connection needs attention</strong>
              <p>{error}</p>
              <span className="muted">
                Any previously displayed machine data is stale until a refresh succeeds.
              </span>
            </div>
            <button onClick={() => void (connection ? refresh() : connect())}>Retry</button>
          </div>
        )}
        {connection?.demo && (
          <div className="demo-banner">
            <Terminal size={15} />
            Demo mode · sample machines and logs · no cluster commands
          </div>
        )}
        {page === 'Overview' && (
          <>
            <div className="summary-grid">
              <Metric
                label="Machines ready"
                value={machines.length ? `${ready} / ${machines.length}` : '—'}
                detail={
                  machines.length
                    ? `${needs.length} need attention`
                    : loading
                      ? 'Discovering machines'
                      : 'No data available'
                }
                fraction={machines.length ? ready / machines.length : 0}
              />
              <Metric
                label="Control plane readiness"
                value={
                  planes.length
                    ? `${planes.filter((n) => n.ready === true && n.reachable).length} / ${planes.length}`
                    : '—'
                }
                detail="Machine readiness · not an etcd quorum check"
                fraction={
                  planes.length
                    ? planes.filter((n) => n.ready === true && n.reachable).length / planes.length
                    : 0
                }
              />
              <Metric
                label="Talos versions"
                value={machines.length ? `${versions.size}` : '—'}
                detail={
                  versions.size === 1
                    ? 'Discovered members report one version'
                    : 'Reported by membership discovery'
                }
                fraction={versions.size === 1 ? 1 : 0}
              />
            </div>
            {needs.length > 0 && (
              <div className="alert">
                <CircleAlert size={19} />
                <div>
                  <strong>
                    {needs[0].name} {needs[0].reachable ? 'is not ready' : 'is unreachable'}
                  </strong>
                  <p>
                    {needs[0].error || `Stage: ${needs[0].stage}`} · checked {time(needs[0].checkedAt)}
                  </p>
                </div>
                <button onClick={() => setSelected(needs[0])}>
                  Inspect <ArrowRight size={14} />
                </button>
              </div>
            )}
          </>
        )}
        {['Overview', 'Machines'].includes(page) && (
          <section>
            <div className="section-header">
              <h2>
                Machine fleet <span>{machines.length} machines</span>
              </h2>
              <div className="segmented">
                <button
                  aria-label="Card view"
                  aria-pressed={view === 'cards'}
                  onClick={() => setView('cards')}
                >
                  <LayoutGrid size={16} />
                </button>
                <button aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}>
                  <List size={18} />
                </button>
              </div>
            </div>
            <div className="fleet-tools">
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="Search machines"
                  placeholder="Find a machine or address…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <select aria-label="Filter machines" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All machines</option>
                <option value="controlplane">Control plane</option>
                <option value="worker">Workers</option>
                <option value="attention">Needs attention</option>
              </select>
            </div>
            <div className={'machine-grid ' + (view === 'list' ? 'list-view' : '')}>
              {visible.map((n) => (
                <button key={n.address} className="machine-card" onClick={() => setSelected(n)}>
                  <div className="machine-top">
                    <span className="machine-icon">
                      <Server size={19} />
                    </span>
                    <span className={'status ' + stateClass(n)}>
                      <span className="dot" />
                      {status(n)}
                    </span>
                  </div>
                  <div className="machine-name">
                    <strong>{n.name}</strong>
                    <span className="mono muted">{n.address}</span>
                  </div>
                  <span className="role-tag">{role(n.role)}</span>
                  <div className="machine-footer">
                    <span>{n.version.replace(/^Talos \((.+)\)$/, '$1')}</span>
                    <span>{n.stage}</span>
                  </div>
                </button>
              ))}
            </div>
            {loading && machines.length === 0 && (
              <div className="empty">
                <LoaderCircle className="spin" size={25} />
                <h2>Discovering your machines</h2>
                <p>Reading cluster members and checking each machine.</p>
              </div>
            )}
            {!loading && visible.length === 0 && (
              <div className="empty">
                <Server size={26} />
                <h2>{machines.length ? 'No matching machines' : 'No machines available'}</h2>
                <p>
                  {machines.length
                    ? 'Try another search or filter.'
                    : 'Check the connection and retry discovery.'}
                </p>
              </div>
            )}
            <div className="fleet-footer">
              <span>
                <span className="dot good" />{' '}
                {loading ? 'Refreshing health…' : 'Automatic refresh every 30 seconds'}
              </span>
              <span>{machines[0] ? `Last checked ${time(machines[0].checkedAt)}` : 'Awaiting data'}</span>
            </div>
          </section>
        )}
        {page === 'Configuration' && (
          <Configuration context={context} machines={machines} onPlan={setPlan} notify={notify} />
        )}
        {page === 'Operations' && <History context={context} />}
        {page === 'Connections' && (
          <section className="panel connection-panel">
            <div className="section-header">
              <h2>Local bridge</h2>
              <span className="pill">Loopback only</span>
            </div>
            <KV label="Client" value={connection?.version || 'Not connected'} />
            <KV label="Credentials" value="Existing local talosconfig" />
            <KV label="Context" value={context || 'None'} />
            <KV
              label="Endpoints"
              value={connection?.contexts.find((c) => c.name === context)?.endpoints.join(', ') || 'None'}
            />
            <KV
              label="Configured nodes"
              value={connection?.contexts.find((c) => c.name === context)?.nodes.join(', ') || 'None'}
            />
            <KV
              label="Permissions"
              value={
                connection?.writes
                  ? 'Reviewed configuration patch and reboot'
                  : 'Read-only; configuration dry runs available'
              }
            />
            <div className="connection-note">
              <ShieldCheck size={20} />
              <p>
                Talos Studio invokes your installed talosctl. The bridge uses local credentials; it never
                sends the talosconfig to the browser.
              </p>
            </div>
            <button
              className="primary"
              onClick={() => void connect().then(() => notify('Connection settings refreshed'))}
            >
              Refresh connection
            </button>
          </section>
        )}
        <footer className="app-footer">
          <span>
            Talos Studio <span className="muted">/ 0.1.0</span>
          </span>
          <span className="muted">{connection?.demo ? 'Demo' : 'Local bridge'} → talosctl → Talos API</span>
        </footer>
      </main>
      {selected && (
        <InspectorDrawer
          context={context}
          machine={selected}
          writes={!!connection?.writes}
          demo={!!connection?.demo}
          close={() => setSelected(undefined)}
          reboot={reviewReboot}
        />
      )}
      {plan && (
        <PlanDialog
          plan={plan}
          writes={!!connection?.writes}
          close={() => setPlan(undefined)}
          completed={(operation) => {
            setPlan(undefined);
            setSelected(undefined);
            notify(operation.summary);
            void refresh();
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  fraction,
}: {
  label: string;
  value: string;
  detail: string;
  fraction: number;
}) {
  return (
    <div className="metric-panel">
      <span className="muted">{label}</span>
      <div className="metric-value">{value}</div>
      <p className="muted">{detail}</p>
      <div className="meter">
        <span style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
function KV({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <div>{value}</div>
    </div>
  );
}
function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const items = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select,textarea,a[href]',
          ) || []),
        ].filter((x) => x.getClientRects().length);
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className={'overlay ' + (wide ? 'centered' : '')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className={wide ? 'review-dialog' : 'inspector'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="dialog-heading">
          <span className="eyebrow">{wide ? 'Operation review' : 'Machine inspector'}</span>
          <button className="icon-button" aria-label="Close dialog" onClick={close}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function InspectorDrawer({
  context,
  machine,
  writes,
  demo,
  close,
  reboot,
}: {
  context: string;
  machine: Machine;
  writes: boolean;
  demo: boolean;
  close: () => void;
  reboot: (n: Machine) => Promise<void>;
}) {
  const [data, setData] = useState<Inspector>(),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState('Overview'),
    [busy, setBusy] = useState(false),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(undefined);
    void api<Inspector>('inspect?' + query({ context, node: machine.address }), { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [context, machine.address, nonce]);
  return (
    <Modal title={machine.name} close={close}>
      <h1>{machine.name}</h1>
      <div className="inspector-sub">
        <span className={'status ' + stateClass(machine)}>
          <span className="dot" />
          {status(machine)}
        </span>
        <span className="muted">
          {role(machine.role)} · {machine.address}
        </span>
      </div>
      <div className="tabs" role="tablist" aria-label="Machine details">
        {['Overview', 'Services', 'Logs', 'Hardware'].map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === tab}
            aria-controls="machine-tab-content"
            id={'tab-' + t}
            className={t === tab ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div id="machine-tab-content" role="tabpanel" aria-labelledby={'tab-' + tab}>
        {loading && (
          <div className="empty">
            <LoaderCircle className="spin" />
            <p>Reading machine resources…</p>
          </div>
        )}
        {error && (
          <div role="alert" className="inline-error">
            {error}
            <button onClick={() => setNonce((n) => n + 1)}>Retry</button>
          </div>
        )}
        {data && (
          <>
            {data.errors.length > 0 && <div className="inline-error">{data.errors.join('\n')}</div>}
            {tab === 'Overview' && (
              <>
                <KV label="Stage" value={data.machine.stage} />
                <KV label="Talos version" value={data.machine.version} />
                <KV label="Checked" value={time(data.machine.checkedAt)} />
                <KV
                  label="Services healthy"
                  value={`${data.services.filter((s) => s.healthy === true).length} / ${data.services.length}`}
                />
                <div className="section-gap">
                  <h3>Maintenance</h3>
                  <p className="muted">Review the target and impact before requesting a reboot.</p>
                  <button
                    disabled={!writes || !machine.reachable || machine.ready !== true || busy}
                    onClick={() => {
                      setBusy(true);
                      void reboot(machine).finally(() => setBusy(false));
                    }}
                  >
                    {busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}Review
                    reboot…
                  </button>
                  {!writes && <p className="muted small">Writes are disabled for this session.</p>}
                </div>
              </>
            )}
            {tab === 'Services' && (
              <div>
                {data.services.length === 0 && <p className="muted">Service status unavailable.</p>}
                {data.services.map((s) => (
                  <div className="service-row" key={s.name}>
                    <span className="service-icon">
                      <Activity size={15} />
                    </span>
                    <strong>{s.name}</strong>
                    <span className={'status ' + (s.healthy === true ? 'good' : 'warn')}>
                      {!s.running
                        ? 'Stopped'
                        : s.healthy === true
                          ? 'Healthy'
                          : s.healthy === false
                            ? 'Unhealthy'
                            : 'Health unknown'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {tab === 'Hardware' && (
              <div className="hardware-sections">
                {data.hardware.map((h) => (
                  <section key={h.kind}>
                    <h3>{h.kind}</h3>
                    {h.error && <p className="inline-error">{h.error}</p>}
                    {!h.error && !h.resources.length && <p className="muted">No resources reported.</p>}
                    {h.resources.map((r) => (
                      <details key={r.id}>
                        <summary>
                          {r.id}
                          <span className="muted">
                            {String(
                              r.spec.model ||
                                r.spec.productName ||
                                r.spec.manufacturer ||
                                r.spec.pretty_size ||
                                '',
                            )}
                          </span>
                        </summary>
                        <pre>{JSON.stringify(r.spec, null, 2)}</pre>
                      </details>
                    ))}
                  </section>
                ))}
              </div>
            )}
            {tab === 'Logs' && (
              <Logs
                context={context}
                node={machine.address}
                services={data.services.map((s) => s.name)}
                demo={demo}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
function Logs({
  context,
  node,
  services,
  demo,
}: {
  context: string;
  node: string;
  services: string[];
  demo: boolean;
}) {
  const [service, setService] = useState(services.includes('kubelet') ? 'kubelet' : services[0] || ''),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [following, setFollowing] = useState(false),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!service) return;
    const abort = new AbortController();
    setText('');
    setError('');
    setBusy(true);
    const append = (chunk: string) => {
      if (!abort.signal.aborted) setText((previous) => (previous + chunk).slice(-250000));
    };
    const job = following
      ? followLogs({ context, node, service }, abort.signal, append)
      : api<{ text: string }>('logs?' + query({ context, node, service }), { signal: abort.signal }).then(
          (r) => append(r.text),
        );
    void job
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) {
          setBusy(false);
          if (following) setFollowing(false);
        }
      });
    return () => abort.abort();
  }, [context, node, service, following, nonce]);
  if (!services.length) return <p className="muted">No services available for log inspection.</p>;
  return (
    <>
      <div className="log-tools">
        <select
          aria-label="Log service"
          value={service}
          onChange={(e) => {
            setFollowing(false);
            setService(e.target.value);
          }}
        >
          {services.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button disabled={demo} aria-pressed={following} onClick={() => setFollowing(!following)}>
          {following ? 'Stop following' : 'Follow live'}
        </button>
        <button aria-label="Reload log snapshot" disabled={following} onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="terminal">
        <div className="terminal-header">
          <Terminal size={14} />
          {service}
          <span>{following ? 'LIVE' : 'SNAPSHOT'}</span>
        </div>
        <pre>{text || (busy ? 'Waiting for logs…' : 'No logs returned.')}</pre>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <p className="muted small">
        Last 200 lines{following ? ' plus new output' : ''}. Display keeps the latest 250,000 characters.
        {demo ? ' Demo snapshots only.' : ''}
      </p>
    </>
  );
}
function Configuration({
  context,
  machines,
  onPlan,
  notify,
}: {
  context: string;
  machines: Machine[];
  onPlan: (p: Plan) => void;
  notify: (t: string) => void;
}) {
  const [node, setNode] = useState(''),
    [patch, setPatch] = useState('machine:\n  kubelet:\n    extraArgs:\n      max-pods: "110"\n'),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    setNode('');
    setBusy(false);
  }, [context]);
  const target =
    machines.find((n) => n.address === node) || machines.find((n) => n.reachable && n.ready === true);
  const review = async () => {
    if (!target) return;
    const id = epoch.current;
    setBusy(true);
    try {
      const p = await api<Plan>('plans', { body: { context, node: target.address, kind: 'patch', patch } });
      if (id === epoch.current) onPlan(p);
    } catch (e) {
      if (id === epoch.current) notify(errorText(e));
    } finally {
      if (id === epoch.current) setBusy(false);
    }
  };
  return (
    <section className="panel config-panel">
      <div className="section-header">
        <h2>Configuration patch</h2>
        <span className="pill">Merge patch · YAML / JSON</span>
      </div>
      <p className="muted">
        Change only the fields you need. The bridge asks Talos for a dry-run preview before offering apply.
      </p>
      <label className="field-label" htmlFor="config-node">
        Target machine
      </label>
      <select id="config-node" value={target?.address || ''} onChange={(e) => setNode(e.target.value)}>
        <option value="" disabled>
          Select a machine
        </option>
        {machines.map((n) => (
          <option value={n.address} key={n.address}>
            {n.name} · {n.address}
          </option>
        ))}
      </select>
      <div className="editor-label">
        <label htmlFor="patch">Merge patch</label>
        <span className="muted small">Example patch · edit before applying</span>
      </div>
      <textarea
        id="patch"
        className="code-editor"
        value={patch}
        onChange={(e) => setPatch(e.target.value)}
        spellCheck={false}
      />
      <div className="config-footer">
        <div className="muted small">
          <ShieldCheck size={15} />
          No-reboot mode · reboot-requiring changes are rejected
        </div>
        <button
          className="primary"
          disabled={busy || !target?.reachable || target.ready !== true || !patch.trim()}
          onClick={() => void review()}
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : <FileCode2 size={16} />}
          {busy ? 'Validating with Talos…' : 'Review patch'}
          <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}
function PlanDialog({
  plan,
  writes,
  close,
  completed,
}: {
  plan: Plan;
  writes: boolean;
  close: () => void;
  completed: (o: Operation) => void;
}) {
  const [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const execute = async () => {
    setBusy(true);
    setError('');
    try {
      completed(await api<Operation>('execute', { body: { id: plan.id, confirmation } }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Review operation"
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <h1>{plan.kind === 'reboot' ? 'Review machine reboot' : 'Review configuration patch'}</h1>
      <p className="muted">
        {plan.name} · {plan.context} · {plan.node}
      </p>
      <div className="alert review-warning">
        <CircleAlert size={20} />
        <p>{plan.warning}</p>
      </div>
      <h3>Command</h3>
      <pre>{plan.command}</pre>
      <h3>{plan.kind === 'patch' ? 'Talos dry-run preview' : 'Expected behavior'}</h3>
      <pre>{plan.preview}</pre>
      <p className="muted small">Review expires at {time(plan.expiresAt)}. Each review can be used once.</p>
      {writes ? (
        <>
          <label className="field-label" htmlFor="confirm-name">
            Type <strong>{plan.name}</strong> to confirm
          </label>
          <input
            id="confirm-name"
            autoComplete="off"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={plan.name}
            disabled={busy}
          />
          <div className="review-actions">
            <button onClick={close} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={
                busy || confirmation !== plan.name || Date.now() >= new Date(plan.expiresAt).getTime()
              }
              onClick={() => void execute()}
            >
              {busy && <LoaderCircle size={16} className="spin" />}
              {busy
                ? 'Submitting…'
                : plan.kind === 'patch'
                  ? 'Apply reviewed patch'
                  : 'Request drain & reboot'}
            </button>
          </div>
        </>
      ) : (
        <p className="inline-note">
          Read-only session. Set STUDIO_WRITES=1 when starting the bridge to enable reviewed actions.
        </p>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
function History({ context }: { context: string }) {
  const [operations, setOperations] = useState<Operation[]>([]),
    [error, setError] = useState(''),
    [nonce, setNonce] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void api<Operation[]>('operations', { signal: abort.signal })
      .then(setOperations)
      .catch((e) => {
        if (!abort.signal.aborted) setError(errorText(e));
      });
    return () => abort.abort();
  }, [nonce]);
  const visible = operations.filter((o) => o.context === context);
  return (
    <section className="panel">
      <div className="section-header">
        <h2>Operation history</h2>
        <button onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {visible.length === 0 && (
        <div className="empty">
          <Activity size={28} />
          <h2>No operations yet</h2>
          <p>Reviewed writes appear here. History is held in memory for this bridge session.</p>
        </div>
      )}
      {visible.map((o) => (
        <article key={o.id} className="operation">
          <span className={'status ' + (o.status === 'completed' ? 'good' : 'warn')}>
            {o.status === 'completed' ? <Check size={15} /> : <CircleAlert size={15} />}
            {o.status}
          </span>
          <strong>
            {o.kind === 'reboot' ? 'Drain & reboot request' : 'Configuration patch'} · {o.node}
          </strong>
          <p>{o.summary}</p>
          <time className="muted small">{new Date(o.createdAt).toLocaleString()}</time>
        </article>
      ))}
    </section>
  );
}
