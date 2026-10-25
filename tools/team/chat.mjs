// The review team's chat: short messages between the agents, the producer (Claude) and Salvatore.
// The studio shows it on the Team page (tools/vite/teamChat.ts); agents read it instead of each other's reports.
//
//   node tools/team/chat.mjs post <from> "<text>" [--to <name|all>] [--kind finding|fix|question|answer|note]
//                                [--sev B|I|R] [--at <seconds>] [--img <path under qa-out/review>] [--reply <id>]
//   node tools/team/chat.mjs read [--for <name>] [--last 30] [--since <id>]
//   node tools/team/chat.mjs new --for <name>                  only unseen messages for <name> (cheapest)
//   node tools/team/chat.mjs wait --for <name> [--timeout 120]  block until a message for <name> arrives
//
// Messages are capped at MAX_TEXT characters: a finding is one line (time, what, fix); details go in the report.
// Stored in qa-out/review/chat.jsonl (TEAM_CHAT overrides), one JSON object per line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CHAT_FILE = process.env.TEAM_CHAT || path.join(root, 'qa-out', 'review', 'chat.jsonl');
export const MAX_TEXT = 300;
/** Others' messages in `new` / `wait` are cut to this (the full text stays in the file and on the Team page). */
const NEW_CUT = 160;
const CURSORS = path.join(path.dirname(CHAT_FILE), '.chat-cursors.json');
const readCursors = () => {
  try {
    return JSON.parse(fs.readFileSync(CURSORS, 'utf8'));
  } catch {
    return {};
  }
};
const writeCursors = (c) => fs.writeFileSync(CURSORS, JSON.stringify(c));
const KINDS = ['finding', 'fix', 'question', 'answer', 'note'];

export function readChat(file = CHAT_FILE) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((l) => {
      try {
        return l.trim() ? [JSON.parse(l)] : [];
      } catch {
        return [];
      }
    });
}

export function postChat(msg, file = CHAT_FILE) {
  const all = readChat(file);
  const text = String(msg.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('empty message');
  const m = {
    id: (all.at(-1)?.id ?? 0) + 1,
    ts: new Date().toISOString(),
    from: String(msg.from).toLowerCase(),
    to: msg.to ? String(msg.to).toLowerCase() : 'all',
    kind: KINDS.includes(msg.kind) ? msg.kind : 'note',
    ...(msg.sev && /^[BIR]$/.test(msg.sev) ? { sev: msg.sev } : {}),
    ...(Number.isFinite(Number(msg.at)) && msg.at !== undefined && msg.at !== '' ? { at: Number(msg.at) } : {}),
    ...(msg.img ? { img: String(msg.img).replace(/\\/g, '/') } : {}),
    ...(msg.reply ? { reply: Number(msg.reply) } : {}),
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(m)}\n`);
  return { message: m, truncated: text.length > MAX_TEXT };
}

/** One compact line per message: what an agent reads (a few tokens each). */
export function formatLine(m) {
  const sev = m.sev ? ` [${m.sev}]` : '';
  const at = m.at !== undefined ? ` @${m.at}s` : '';
  const re = m.reply ? ` re#${m.reply}` : '';
  return `#${m.id} ${m.from}→${m.to}${sev}${at}${re}: ${m.text}${m.img ? ` (img ${m.img})` : ''}`;
}

function args(list) {
  const out = { _: [] };
  for (let i = 0; i < list.length; i++) {
    if (list[i].startsWith('--')) out[list[i].slice(2)] = list[++i];
    else out._.push(list[i]);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  if (cmd === 'post') {
    const [from, text] = a._;
    if (!from || !text) {
      console.error('usage: chat.mjs post <from> "<text>" [--to x] [--kind k] [--sev B|I|R] [--at s] [--img p] [--reply id]');
      process.exit(1);
    }
    const { message, truncated } = postChat({ from, text, to: a.to, kind: a.kind, sev: a.sev, at: a.at, img: a.img, reply: a.reply });
    console.log(`posted #${message.id}${truncated ? ` (cut to ${MAX_TEXT} chars: put details in your report)` : ''}`);
  } else if (cmd === 'read' || cmd === 'new' || cmd === 'wait') {
    // new: only what this reader has not seen yet (a cursor per name), own messages left out, others' cut to
    // NEW_CUT chars - each line costs a few tokens and nothing is ever read twice.
    // wait: like new, but blocks (up to --timeout s, default 120) until something arrives - a live conversation.
    const who = a.for?.toLowerCase();
    const fresh = cmd !== 'read';
    if (fresh && !who) {
      console.error(`usage: chat.mjs ${cmd} --for <name>`);
      process.exit(1);
    }
    const cursors = fresh ? readCursors() : {};
    const pick = () => {
      let list = readChat();
      const since = fresh ? cursors[who] ?? 0 : Number(a.since ?? 0);
      list = list.filter((m) => m.id > since);
      if (who) list = list.filter((m) => (m.to === 'all' || m.to === who || m.from === who) && !(fresh && m.from === who));
      return list.slice(-Number(a.last ?? 30));
    };
    let list = pick();
    if (cmd === 'wait') {
      const until = Date.now() + Number(a.timeout ?? 120) * 1000;
      while (!list.length && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1500));
        list = pick();
      }
    }
    const lines = list.map((m) => (fresh && m.text.length > NEW_CUT ? formatLine({ ...m, text: `${m.text.slice(0, NEW_CUT - 1)}…` }) : formatLine(m)));
    console.log(lines.length ? lines.join('\n') : '(nothing new)');
    if (fresh) {
      const last = readChat().at(-1)?.id ?? 0;
      cursors[who] = Math.max(cursors[who] ?? 0, list.at(-1)?.id ?? 0, last);
      writeCursors(cursors);
    }
  } else {
    console.error('usage: chat.mjs post|read ...');
    process.exit(1);
  }
}
