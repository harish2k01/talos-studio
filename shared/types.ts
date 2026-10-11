export interface Context {
  name: string;
  endpoints: string[];
  nodes: string[];
}
export interface Connection {
  contexts: Context[];
  current: string;
  version: string;
  demo: boolean;
  writes: boolean;
}
export interface Machine {
  name: string;
  address: string;
  role: string;
  version: string;
  nodeId?: string;
  reachable: boolean;
  ready: boolean | null;
  stage: string;
  checkedAt: string;
  error?: string;
}
export interface Service {
  name: string;
  running: boolean;
  healthy: boolean | null;
}
export interface Hardware {
  kind: string;
  resources: { id: string; spec: Record<string, unknown> }[];
  error?: string;
}
export interface Inspector {
  machine: Machine;
  services: Service[];
  hardware: Hardware[];
  errors: string[];
}
export interface Operation {
  id: string;
  kind: string;
  context: string;
  node: string;
  status: 'completed' | 'failed';
  createdAt: string;
  summary: string;
}
export interface Plan {
  id: string;
  kind: 'reboot' | 'patch';
  context: string;
  node: string;
  name: string;
  command: string;
  preview: string;
  expiresAt: string;
  warning: string;
}
