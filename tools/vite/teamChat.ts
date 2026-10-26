/**
 * Dev-server side of the Team page: the review team's chat (tools/team/chat.mjs) for the studio.
 *
 *   GET  /api/team/chat?since=<id>  -> { messages }  (all after that id)
 *   POST /api/team/chat { text, to?, reply? } -> { message }  (a message from Salvatore)
 *   GET  /api/team/file?p=<path>     -> a picture an agent attached (only under qa-out/review)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
// @ts-expect-error - plain ESM tool without types
import { readChat, postChat } from '../team/chat.mjs';

interface Msg {
  id: number;
}

export function teamChat(): Plugin {
  return {
    name: 'fox-team-chat',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const review = path.join(root, 'qa-out', 'review');
      server.middlewares.use('/api/team', (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const json = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method === 'GET' && url.pathname === '/stream') {
          // Live: server-sent events, pushed when the chat file changes (no polling from the page).
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          let last = Number(url.searchParams.get('since') ?? 0);
          const push = () => {
            const fresh = (readChat() as Msg[]).filter((m) => m.id > last);
            if (!fresh.length) return;
            last = fresh[fresh.length - 1].id;
            res.write(`data: ${JSON.stringify(fresh)}\n\n`);
          };
          push();
          fs.mkdirSync(review, { recursive: true });
          const watcher = fs.watch(review, (_e, name) => name === 'chat.jsonl' && setTimeout(push, 50));
          const ping = setInterval(() => res.write(': ping\n\n'), 25000);
          req.on('close', () => {
            watcher.close();
            clearInterval(ping);
          });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/chat') {
          const since = Number(url.searchParams.get('since') ?? 0);
          return json(200, { messages: (readChat() as Msg[]).filter((m) => m.id > since) });
        }
        if (req.method === 'POST' && url.pathname === '/chat') {
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (c: string) => (body += c.length + body.length > 20000 ? '' : c));
          req.on('end', () => {
            try {
              const b = JSON.parse(body) as { text?: string; to?: string; reply?: number };
              json(200, postChat({ from: 'salvatore', text: b.text, to: b.to, reply: b.reply, kind: b.to && b.to !== 'all' ? 'question' : 'note' }));
            } catch (e) {
              json(400, { error: e instanceof Error ? e.message : String(e) });
            }
          });
          return;
        }
        if (req.method === 'GET' && url.pathname === '/file') {
          const p = path.resolve(root, url.searchParams.get('p') ?? '');
          if (!p.startsWith(review + path.sep) || !/\.(jpe?g|png|webp)$/i.test(p) || !fs.existsSync(p)) return json(404, { error: 'not found' });
          res.setHeader('Content-Type', /\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg');
          return fs.createReadStream(p).pipe(res);
        }
        next(); // (other /api/team routes: teamAsk.ts)
      });
    },
  };
}
