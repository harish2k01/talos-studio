import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TalosService } from './talos.ts';
import { message } from './talos.ts';

export async function createApp(service: TalosService, options: { port?: number; staticDir?: string } = {}) {
  const port = options.port || 4317;
  const app = Fastify({
    logger: false,
    bodyLimit: 80 * 1024,
    requestTimeout: 360000,
    forceCloseConnections: true,
  });
  const token = randomBytes(32).toString('hex');
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, '127.0.0.1:5173', 'localhost:5173']);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  const children = new Set<ReturnType<typeof service.runner.stream>>();
  let streams = 0;
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    );
    if (
      !req.headers.host ||
      !hosts.has(req.headers.host) ||
      (req.headers.origin && !origins.has(req.headers.origin)) ||
      ['cross-site', 'same-site'].includes(String(req.headers['sec-fetch-site']))
    )
      return reply.code(403).send({ error: 'Use the local Talos Studio URL' });
    if (
      req.url.startsWith('/api/') &&
      req.url.split('?')[0] !== '/api/session' &&
      req.headers['x-studio-token'] !== token
    )
      return reply.code(403).send({ error: 'Local session required; reload Talos Studio' });
  });
  app.setErrorHandler((error, _req, reply) => reply.code(400).send({ error: message(error) }));
  app.get('/api/session', async () => ({ token }));
  app.get('/api/connection', async () => service.connection());
  app.get<{ Querystring: { context: string; refresh?: string } }>('/api/machines', async (req) =>
    service.machines(req.query.context, req.query.refresh === '1'),
  );
  app.get<{ Querystring: { context: string; node: string } }>('/api/inspect', async (req) =>
    service.inspect(req.query.context, req.query.node),
  );
  app.get<{ Querystring: { context: string; node: string; service: string } }>('/api/logs', async (req) => ({
    text: await service.logs(req.query.context, req.query.node, req.query.service),
  }));
  app.get('/api/operations', async () => service.history);
  app.post<{ Body: { context: string; node: string; kind: string; patch?: string } }>(
    '/api/plans',
    async (req) => service.plan(req.body.context, req.body.node, req.body.kind, req.body.patch),
  );
  app.post<{ Body: { id: string; confirmation: string } }>('/api/execute', async (req) =>
    service.execute(req.body.id, req.body.confirmation),
  );
  // A POST stream keeps the session token out of URLs and browser history.
  app.post<{ Body: { context: string; node: string; service: string } }>(
    '/api/logs/stream',
    async (req, reply) => {
      if (streams >= 4) return reply.code(429).send({ error: 'At most four log streams can run at once' });
      const args = await service.logArgs(req.body.context, req.body.node, req.body.service);
      if (service.options.demo)
        return reply.code(400).send({ error: 'Demo mode provides log snapshots, not live streams' });
      const child = service.runner.stream([...args, '--follow']);
      children.add(child);
      child.stdin.end();
      streams++;
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      reply.raw.flushHeaders();
      let finished = false,
        size = 0;
      const send = (event: { text?: string; error?: string; done?: boolean }) => {
        if (!finished && !reply.raw.destroyed) {
          size += Buffer.byteLength(JSON.stringify(event));
          if (size > 8 * 1024 * 1024) return finish('Log stream reached its 8 MiB limit; start a new stream');
          if (!reply.raw.write(JSON.stringify(event) + '\n')) child.stdout.pause();
        }
      };
      const finish = (error?: string) => {
        if (finished) return;
        if (error) reply.raw.write(JSON.stringify({ error }) + '\n');
        finished = true;
        clearTimeout(timer);
        child.kill();
        children.delete(child);
        streams--;
        reply.raw.end();
      };
      const timer = setTimeout(
        () => finish('Log stream reached its 10 minute limit; reconnect to continue'),
        600000,
      );
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (text) => send({ text }));
      child.stderr.on('data', (text) => send({ error: message(new Error(text)) }));
      child.on('error', () => finish('Could not start talosctl log stream'));
      child.on('close', (code) => {
        send(code === 0 ? { done: true } : { error: `Log stream ended with code ${code}` });
        finish();
      });
      reply.raw.on('drain', () => child.stdout.resume());
      reply.raw.on('close', () => finish());
    },
  );
  app.addHook('onClose', async () => {
    for (const child of children) child.kill();
  });
  const staticDir = options.staticDir || resolve('dist');
  if (existsSync(staticDir)) {
    await app.register(staticPlugin, { root: staticDir });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Unknown endpoint' })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
