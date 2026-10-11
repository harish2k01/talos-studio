import { createApp } from './app.ts';
import { TalosRunner } from './runner.ts';
import { TalosService } from './talos.ts';
const port = Number(process.env.STUDIO_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('STUDIO_PORT must be an integer from 1024 to 65535');
const service = new TalosService(new TalosRunner(), {
  demo: process.env.STUDIO_DEMO === '1',
  writes: process.env.STUDIO_WRITES === '1',
});
const app = await createApp(service, { port });
await app.listen({ port, host: '127.0.0.1' });
console.log(
  `Talos Studio: http://127.0.0.1:${port} · ${service.options.demo ? 'demo' : service.options.writes ? 'reviewed writes enabled' : 'read-only'}`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
