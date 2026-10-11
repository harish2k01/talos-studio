import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { redact } from './parsers.ts';
export interface Runner {
  run(args: string[], options?: { timeout?: number }): Promise<string>;
  stream(args: string[]): ChildProcessWithoutNullStreams;
}
export class TalosRunner implements Runner {
  private active = 0;
  constructor(readonly executable = process.env.TALOSCTL_PATH || 'talosctl') {}
  stream(args: string[]) {
    return spawn(this.executable, args, { shell: false, windowsHide: true, stdio: 'pipe' });
  }
  async run(args: string[], options: { timeout?: number } = {}): Promise<string> {
    if (this.active >= 8) throw new Error('Too many operations; wait for the current requests');
    this.active++;
    try {
      return await new Promise<string>((resolve, reject) => {
        const child = this.stream(args);
        child.stdin.end();
        let stdout = '',
          stderr = '',
          size = 0,
          done = false;
        const timer = setTimeout(
          () => finish(new Error('Talos command timed out')),
          options.timeout || 15000,
        );
        const finish = (error?: Error) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (error) {
            child.kill();
            reject(error);
          } else resolve(stdout);
        };
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        const chunk = (data: string, err: boolean) => {
          size += Buffer.byteLength(data);
          if (size > 4 * 1024 * 1024) return finish(new Error('Talos output exceeded the 4 MiB limit'));
          if (err) stderr += data;
          else stdout += data;
        };
        child.stdout.on('data', (d) => chunk(d, false));
        child.stderr.on('data', (d) => chunk(d, true));
        child.on('error', () =>
          finish(
            new Error('Could not start talosctl. Install it or set TALOSCTL_PATH to its absolute path.'),
          ),
        );
        child.on('close', (code) =>
          finish(
            code === 0
              ? undefined
              : new Error(redact(stderr.trim()).slice(0, 1500) || `talosctl exited with code ${code}`),
          ),
        );
      });
    } finally {
      this.active--;
    }
  }
}
