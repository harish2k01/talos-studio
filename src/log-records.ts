export interface LogRecord {
  raw: string;
  message: string;
  time: string;
  level: string;
}
export function parseLogs(text: string): LogRecord[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((raw) => {
      const start = raw.indexOf('{');
      if (start >= 0) {
        try {
          const value = JSON.parse(raw.slice(start));
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            const stamp = value.ts ?? value.timestamp ?? value.time;
            const date =
              typeof stamp === 'number' ? new Date(stamp < 1e12 ? stamp * 1000 : stamp) : new Date(stamp);
            const message = value.msg ?? value.message;
            if (typeof message === 'string')
              return {
                raw,
                message,
                time: !Number.isNaN(date.valueOf()) ? date.toLocaleTimeString() : '',
                level: String(value.level ?? value.severity ?? 'info').toLowerCase(),
              };
          }
        } catch {
          /* Unstructured or partial lines remain readable and intact. */
        }
      }
      const level = /\b(error|fatal|warn|warning|debug|info)\b/i.exec(raw)?.[1].toLowerCase() || 'other';
      return { raw, message: raw, time: '', level };
    });
}
