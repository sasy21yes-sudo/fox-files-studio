/**
 * Dev-server bridge between the browser's project library and the git repository, so an episode can
 * also be edited remotely (a Claude Code session on another machine edits the files and pushes).
 *
 *   episodes/<id>.foxproj.json   the episode (Project JSON, pretty-printed, no image data)
 *   episodes/media/<mediaId>.<ext>  its images (the browser keeps them in IndexedDB)
 *
 * Browser -> repo: the page PUTs every autosave; when files change, a few seconds later the episodes
 * folder (and nothing else) is committed, merged with the remote and pushed on the current branch.
 * Repo -> browser: every 45 s the remote is fetched and pulled when it has new commits; any change to an
 * episode file that this server did not write (a pull, or a local Claude Code session editing the file)
 * is announced to the page over Vite's websocket ("fox:episodes"), which reloads that episode.
 *
 * Runs only inside `npm run dev`. Settings in .env: FOX_EPISODE_GIT=off (files only, no git),
 * FOX_EPISODE_PUSH=off (commit locally, never push).
 *
 *   GET /__episodes/status            -> { enabled, git, push, branch, upstream, lastSync, lastCommit, error, episodes: {id: hash} }
 *   GET /__episodes/index             -> [{ id, title, updated }]
 *   GET /__episodes/p/<id>            -> the episode file
 *   PUT /__episodes/p/<id>            <- Project JSON
 *   GET /__episodes/media             -> [file names]
 *   GET /__episodes/m/<name>          -> image
 *   PUT /__episodes/m/<name>          <- image bytes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, type Plugin, type ViteDevServer } from 'vite';

const ID = /^[\w-]{1,80}$/;
const MEDIA_NAME = /^[\w-]{1,80}\.(png|jpe?g|webp|gif)$/;
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const COMMIT_DELAY = 8000;
const POLL = 45000;

interface State {
  git: boolean;
  push: boolean;
  branch: string | null;
  upstream: boolean;
  lastSync: number | null;
  lastCommit: string | null;
  error: string | null;
}

const hash = (b: Buffer | string) => createHash('sha1').update(b).digest('hex');

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) reject(new Error('request too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function episodeSync(): Plugin {
  return {
    name: 'fox-episode-sync',
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      const root = server.config.root;
      const env = loadEnv(server.config.mode, root, '');
      const dir = path.join(root, 'episodes');
      const mediaDir = path.join(dir, 'media');
      fs.mkdirSync(mediaDir, { recursive: true });
      const state: State = {
        git: env.FOX_EPISODE_GIT !== 'off',
        push: env.FOX_EPISODE_PUSH !== 'off',
        branch: null,
        upstream: false,
        lastSync: null,
        lastCommit: null,
        error: null,
      };
      /** Hashes of what this server wrote (or last saw) per file, so its own writes are not "remote" changes. */
      const known = new Map<string, string>();
      const log = (msg: string) => server.config.logger.info(`[episodes] ${msg}`, { timestamp: true });

      const git = (args: string[]) =>
        new Promise<{ code: number; out: string; err: string }>((resolve) => {
          execFile('git', args, { cwd: root, windowsHide: true, maxBuffer: 8 << 20 }, (e, out, err) =>
            resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, out: String(out).trim(), err: String(err).trim() }),
          );
        });
      // One git operation at a time.
      let chain: Promise<unknown> = Promise.resolve();
      const queue = (fn: () => Promise<void>) => {
        chain = chain.then(fn, fn).catch((e) => {
          state.error = e instanceof Error ? e.message : String(e);
        });
        return chain;
      };

      const fileOf = (id: string) => path.join(dir, `${id}.foxproj.json`);
      const idOf = (rel: string) => /^episodes\/([\w-]+)\.foxproj\.json$/.exec(rel.replace(/\\/g, '/'))?.[1] ?? null;

      const notify = (ids: string[]) => {
        if (!ids.length) return;
        for (const id of ids) {
          try {
            known.set(id, hash(fs.readFileSync(fileOf(id))));
          } catch {
            known.delete(id);
          }
        }
        log(`changed outside the page: ${ids.join(', ')}`);
        server.ws.send({ type: 'custom', event: 'fox:episodes', data: { ids } });
      };

      const refreshBranch = async () => {
        if (!state.git) return;
        const b = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
        state.branch = b.code === 0 ? b.out : null;
        state.upstream = (await git(['rev-parse', '--abbrev-ref', '@{u}'])).code === 0;
        if (b.code !== 0) state.git = false; // not a git checkout: files only
      };

      /** Pull new remote commits; announce the episodes they changed. */
      const pull = async () => {
        if (!state.git || !state.upstream) return;
        const f = await git(['fetch', '--quiet']);
        if (f.code !== 0) return void (state.error = `fetch: ${f.err.split('\n')[0]}`);
        const behind = Number((await git(['rev-list', '--count', 'HEAD..@{u}'])).out || 0);
        if (!behind) return;
        const changed = (await git(['diff', '--name-only', 'HEAD', '@{u}', '--', 'episodes'])).out.split('\n').map(idOf).filter((x): x is string => !!x);
        // Fast-forward, or merge when this side has commits too: either way git only touches the files the
        // incoming commits change (no stash/rebase of the working tree, which would rewrite unrelated files
        // being edited and make Vite restart and reload the page).
        const ahead = Number((await git(['rev-list', '--count', '@{u}..HEAD'])).out || 0);
        const p = await git(ahead ? ['merge', '--no-edit', '--quiet', '@{u}'] : ['merge', '--ff-only', '--quiet', '@{u}']);
        if (p.code !== 0) {
          await git(['merge', '--abort']);
          state.error = `pull: ${(p.err || p.out).split('\n')[0] || 'conflict'} (local episode kept; resolve with git)`;
          return;
        }
        state.lastSync = Date.now();
        state.error = null;
        log(`pulled ${behind} commit(s)`);
        notify([...new Set(changed)]);
      };

      /** Commit the episodes folder only, then merge the remote and push. */
      const commitAndPush = async () => {
        if (!state.git) return;
        await refreshBranch();
        await git(['add', '-A', '--', 'episodes']);
        const staged = await git(['diff', '--cached', '--name-only', '--', 'episodes']);
        if (staged.out) {
          const ids = [...new Set(staged.out.split('\n').map(idOf).filter((x): x is string => !!x))];
          const titles = ids.map((id) => {
            try {
              const p = JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
              return p.episodeTitle || id;
            } catch {
              return id;
            }
          });
          const msg = `Episode: ${titles.join(', ') || 'images'} (edited in the studio)`;
          const c = await git(['commit', '--quiet', '-m', msg, '--', 'episodes']);
          if (c.code !== 0) return void (state.error = `commit: ${(c.err || c.out).split('\n')[0]}`);
          state.lastCommit = (await git(['rev-parse', '--short', 'HEAD'])).out;
          log(`committed ${state.lastCommit}: ${msg}`);
        }
        if (!state.push) return;
        if (state.upstream) {
          await pull();
          if (state.error?.startsWith('pull:')) return;
          const ahead = Number((await git(['rev-list', '--count', '@{u}..HEAD'])).out || 0);
          if (!ahead) return void (state.lastSync = Date.now());
          const p = await git(['push', '--quiet']);
          if (p.code !== 0) return void (state.error = `push: ${p.err.split('\n')[0]}`);
        } else if (state.branch && (await git(['remote'])).out.split('\n').includes('origin')) {
          const p = await git(['push', '--quiet', '-u', 'origin', state.branch]);
          if (p.code !== 0) return void (state.error = `push: ${p.err.split('\n')[0]}`);
          state.upstream = true;
        } else return;
        state.lastSync = Date.now();
        state.error = null;
        log(`pushed to ${state.branch}`);
      };

      let commitTimer: ReturnType<typeof setTimeout> | null = null;
      const scheduleCommit = () => {
        if (commitTimer) clearTimeout(commitTimer);
        commitTimer = setTimeout(() => void queue(commitAndPush), COMMIT_DELAY);
      };

      void queue(async () => {
        await refreshBranch();
        for (const f of fs.readdirSync(dir)) {
          const id = /^([\w-]+)\.foxproj\.json$/.exec(f)?.[1];
          if (id) known.set(id, hash(fs.readFileSync(fileOf(id))));
        }
        log(state.git ? `syncing episodes/ on ${state.branch}${state.upstream ? '' : ' (no upstream yet)'}${state.push ? '' : ', push off'}` : 'episodes/ on disk (git off)');
        await pull();
      });
      const poll = setInterval(() => void queue(pull), POLL);

      // Episode files changed on disk by someone else (a local Claude Code session, an editor): tell the page,
      // and commit them like the page's own edits.
      let watchTimer: ReturnType<typeof setTimeout> | null = null;
      const touched = new Set<string>();
      const watcher = fs.watch(dir, (_ev, name) => {
        const id = name && /^([\w-]+)\.foxproj\.json$/.exec(String(name))?.[1];
        if (!id) return;
        touched.add(id);
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          const ids = [...touched].filter((i) => {
            try {
              return hash(fs.readFileSync(fileOf(i))) !== known.get(i);
            } catch {
              return false;
            }
          });
          touched.clear();
          if (ids.length) {
            notify(ids);
            scheduleCommit();
          }
        }, 400);
      });
      server.httpServer?.on('close', () => {
        clearInterval(poll);
        watcher.close();
      });

      server.middlewares.use('/__episodes', (req, res, next) => {
        void (async () => {
          const url = new URL(req.url ?? '/', 'http://x');
          const parts = url.pathname.split('/').filter(Boolean);
          if (req.method === 'GET' && parts[0] === 'status') return sendJson(res, 200, { enabled: true, ...state, episodes: Object.fromEntries(known) });
          if (req.method === 'GET' && parts[0] === 'index') {
            const list = fs
              .readdirSync(dir)
              .filter((f) => f.endsWith('.foxproj.json'))
              .map((f) => {
                try {
                  const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                  return { id: p.id, title: p.episodeTitle, updated: p.updated ?? 0 };
                } catch {
                  return null;
                }
              })
              .filter(Boolean);
            return sendJson(res, 200, list);
          }
          if (parts[0] === 'p' && parts[1] && ID.test(parts[1])) {
            const id = parts[1];
            if (req.method === 'GET') {
              if (!fs.existsSync(fileOf(id))) return sendJson(res, 404, { error: 'no such episode' });
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Cache-Control', 'no-store');
              return res.end(fs.readFileSync(fileOf(id)));
            }
            if (req.method === 'PUT') {
              const body = JSON.parse((await readBody(req, 50 << 20)).toString('utf8'));
              if (!body || body.id !== id || !Array.isArray(body.scenes)) return sendJson(res, 400, { error: 'not an episode' });
              delete body.mediaData;
              const text = JSON.stringify(body, null, 2) + '\n';
              const h = hash(text);
              if (known.get(id) !== h || !fs.existsSync(fileOf(id))) {
                known.set(id, h);
                fs.writeFileSync(fileOf(id), text);
                scheduleCommit();
              }
              return sendJson(res, 200, { ok: true });
            }
          }
          if (req.method === 'GET' && parts[0] === 'media' && !parts[1]) return sendJson(res, 200, fs.readdirSync(mediaDir).filter((f) => MEDIA_NAME.test(f)));
          if (parts[0] === 'm' && parts[1] && MEDIA_NAME.test(parts[1])) {
            const file = path.join(mediaDir, parts[1]);
            if (req.method === 'GET') {
              if (!fs.existsSync(file)) return sendJson(res, 404, { error: 'no such image' });
              res.setHeader('Content-Type', TYPES[parts[1].split('.').pop()!.toLowerCase()] ?? 'application/octet-stream');
              return res.end(fs.readFileSync(file));
            }
            if (req.method === 'PUT') {
              const bytes = await readBody(req, 30 << 20);
              if (!fs.existsSync(file) || hash(fs.readFileSync(file)) !== hash(bytes)) {
                fs.writeFileSync(file, bytes);
                scheduleCommit();
              }
              return sendJson(res, 200, { ok: true });
            }
          }
          next();
        })().catch((e) => sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) }));
      });
    },
  };
}
