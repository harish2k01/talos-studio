import { parseDocument } from 'yaml';
export interface Resource {
  node?: string;
  metadata: { id: string };
  spec: Record<string, any>;
}
// talosctl emits consecutive pretty-printed JSON objects rather than one JSON array.
export function parseResources(text: string): Resource[] {
  const values: Resource[] = [];
  let start = -1,
    depth = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) {
      if (/\s/.test(c)) continue;
      if (c !== '{') throw new Error('Unexpected talosctl resource output');
      start = i;
      depth = 1;
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      const value = JSON.parse(text.slice(start, i + 1));
      if (
        !value.metadata ||
        typeof value.metadata.id !== 'string' ||
        !value.spec ||
        typeof value.spec !== 'object'
      )
        throw new Error('Malformed Talos resource');
      values.push(value);
      start = -1;
    }
  }
  if (start >= 0) throw new Error('Incomplete talosctl resource output');
  return values;
}
export function parseConfig(text: string) {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw new Error('Could not parse talosconfig');
  const config = doc.toJS({ maxAliasCount: 20 });
  if (!config || !config.contexts || typeof config.contexts !== 'object')
    throw new Error('No contexts in talosconfig');
  const contexts = Object.entries(config.contexts).map(([name, value]) => {
    const c = value as Record<string, unknown>;
    return { name, endpoints: stringArray(c.endpoints), nodes: stringArray(c.nodes) };
  });
  return { contexts, current: typeof config.context === 'string' ? config.context : contexts[0]?.name || '' };
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}
export function validatePatch(text: string): void {
  if (!text.trim() || Buffer.byteLength(text) > 64 * 1024)
    throw new Error('Patch must contain YAML or JSON and be smaller than 64 KiB');
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length) throw new Error('Patch contains invalid YAML or duplicate keys');
  const patch = doc.toJS({ maxAliasCount: 20 });
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new Error('Use a YAML or JSON merge patch object');
}
export function redact(text: string): string {
  const secret =
    '(?:key|crt|ca|cert|certificate|token|secret|password|secretboxEncryptionSecret|bootstrapToken|aescbcEncryptionSecret)';
  const lines = text
    .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED]')
    .replace(new RegExp('("' + secret + '"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"', 'gi'), '$1"[REDACTED]"')
    .split('\n');
  let blockIndent: number | undefined;
  return lines
    .map((line) => {
      const indent = line.match(/^\s*[-+]?\s*/)?.[0].length || 0;
      if (blockIndent !== undefined && (line.trim() === '' || indent > blockIndent)) return '';
      blockIndent = undefined;
      const match = line.match(new RegExp('^(\\s*[-+]?\\s*' + secret + '\\s*:\\s*)(.*)$', 'i'));
      if (!match) return line;
      if (/^[|>]/.test(match[2])) blockIndent = indent;
      return match[1] + '[REDACTED]';
    })
    .join('\n');
}
