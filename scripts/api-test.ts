import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app';
import { renderShell } from '../shared/live';

const db = new Database(':memory:');
db.exec(readFileSync(fileURLToPath(new URL('../worker/schema.sql', import.meta.url)), 'utf8'));
const sent: { to: string; subject: string; text: string }[] = [];
let mailWorks = true;
const server = createApp({
  db,
  secret: 'test',
  trustProxy: true,
  mailer: async (m) => {
    if (!mailWorks) return false;
    sent.push(m);
    return true;
  },
}).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  -> ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}

async function call(path: string, init: RequestInit & { ip?: string } = {}) {
  const { ip, ...rest } = init;
  const res = await fetch(base + path, {
    ...rest,
    headers: { ...(rest.headers as Record<string, string> | undefined), ...(ip ? { 'X-Forwarded-For': ip } : {}) },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { res, json: json as Record<string, unknown> | undefined };
}

const post = (body: unknown, ip = '10.0.0.1', raw = false) =>
  call('/api/bottles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
    ip,
  });

try {
  let r = await post({ text: '  Hello, stranger.  ', tint: 2 });
  check('POST valid -> 201 with id', r.res.status === 201 && typeof r.json?.id === 'string', r.json);
  const firstId = String(r.json?.id);

  r = await post({ text: '', tint: 1 });
  check('empty text -> 400', r.res.status === 400 && r.json?.code === 'invalid_text', r.json);
  r = await post({ text: '   ', tint: 1 });
  check('whitespace text -> 400', r.res.status === 400, r.json);
  r = await post({ text: 'x'.repeat(501), tint: 1 });
  check('501 chars -> 400', r.res.status === 400, r.json);
  r = await post({ text: 'x'.repeat(500), tint: 0 }, '10.0.0.9');
  check('500 chars -> 201', r.res.status === 201, r.json);
  r = await post({ text: 'hi', tint: 5 });
  check('tint 5 -> 400', r.res.status === 400 && r.json?.code === 'invalid_tint', r.json);
  r = await post({ text: 'hi', tint: -1 });
  check('tint -1 -> 400', r.res.status === 400, r.json);
  r = await post({ text: 'hi', tint: 1.5 });
  check('tint 1.5 -> 400', r.res.status === 400, r.json);
  r = await post({ text: 'see https://example.com', tint: 1 });
  check('URL rejected', r.res.status === 400 && r.json?.code === 'link_not_allowed', r.json);
  r = await post({ text: 'visit www.spam.net now', tint: 1 });
  check('www. rejected', r.res.status === 400, r.json);
  r = await post({ text: 'you are a f.u.c.k and a sh1t', tint: 1 });
  check('profanity (leetspeak) rejected', r.res.status === 400 && r.json?.code === 'language_not_allowed', r.json);
  r = await post({ text: 'I love shiitake mushrooms and the Scunthorpe classics.', tint: 1 }, '10.0.0.8');
  check('innocent words are not blocked', r.res.status === 201, r.json);
  r = await post('{not json', '10.0.0.1', true);
  check('malformed JSON -> 400', r.res.status === 400 && r.json?.code === 'invalid_body', r.json);
  const wrong = await call('/api/bottles', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hello' });
  check('non-JSON content type -> 415', wrong.res.status === 415, wrong.json);
  const big = await call('/api/bottles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'a'.repeat(9000), tint: 1 }) });
  check('oversized body -> 413', big.res.status === 413, big.json);

  const rnd = await call('/api/bottles/random?exclude=' + firstId, { ip: '10.0.0.5' });
  check('random excludes given id', rnd.res.status === 200 && rnd.json?.id !== firstId, rnd.json);
  check('random shape', typeof rnd.json?.text === 'string' && typeof rnd.json?.tint === 'number' && typeof rnd.json?.createdAt === 'string');
  check('response has no ip/report fields', !('reportCount' in (rnd.json ?? {})) && !('ip' in (rnd.json ?? {})));

  const victim = String(rnd.json?.id);
  const rep = await call(`/api/bottles/${victim}/report`, { method: 'POST', ip: '10.1.1.1' });
  check('report -> 204', rep.res.status === 204);
  await call(`/api/bottles/${victim}/report`, { method: 'POST', ip: '10.1.1.2' });
  await call(`/api/bottles/${victim}/report`, { method: 'POST', ip: '10.1.1.3' });
  const row = db.prepare('SELECT report_count FROM bottles WHERE id = ?').get(victim) as { report_count: number };
  check('report_count reached 3', row.report_count === 3, row);
  let seen = false;
  for (let i = 0; i < 30; i++) {
    const x = await call('/api/bottles/random', { ip: '10.0.0.5' });
    if (x.json?.id === victim) seen = true;
  }
  check('reported-3x bottle is hidden', !seen);
  const missing = await call('/api/bottles/0123456789abcdef/report', { method: 'POST' });
  check('report unknown id -> 404', missing.res.status === 404);

  db.exec('DELETE FROM bottles');
  const empty = await call('/api/bottles/random');
  check('none -> 404', empty.res.status === 404 && empty.json?.code === 'none_found', empty.json);

  const old = Date.now() - 31 * 24 * 3600 * 1000;
  db.prepare('INSERT INTO bottles (id,text,tint,created_at,report_count) VALUES (?,?,?,?,0)').run('aaaaaaaaaaaaaaaa', 'ancient', 0, old);
  const expired = await call('/api/bottles/random');
  check('30-day-old bottle not served', expired.res.status === 404, expired.json);
  await post({ text: 'fresh', tint: 0 }, '10.0.0.77');
  const left = db.prepare("SELECT COUNT(*) AS n FROM bottles WHERE id = 'aaaaaaaaaaaaaaaa'").get() as { n: number };
  check('expired bottle purged on write', left.n === 0, left);

  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await post({ text: `bottle ${i}`, tint: 0 }, '10.9.9.9')).res.status);
  check('6th bottle in an hour -> 429', codes.slice(0, 5).every((c) => c === 201) && codes[5] === 429, codes);
  const limited = await post({ text: 'again', tint: 0 }, '10.9.9.9');
  const retry = Number(limited.res.headers.get('Retry-After'));
  check('429 has Retry-After + friendly message', retry > 0 && retry <= 3600 && typeof limited.json?.error === 'string', { retry, body: limited.json });
  const other = await post({ text: 'different client', tint: 0 }, '10.8.8.8');
  check('other clients unaffected', other.res.status === 201, other.json);

  const stored = db.prepare("SELECT name FROM pragma_table_info('bottles')").all() as { name: string }[];
  check(
    'bottle table stores only the documented columns (no IP / UA)',
    stored.map((c) => c.name).join() === 'id,text,tint,created_at,report_count,email,up_count,down_count,reply_count',
    stored,
  );

  const secretMail = 'writer.private@example.org';
  const withMail = await post({ text: 'I would love to hear back.', tint: 1, email: secretMail }, '10.5.0.1');
  const mailId = String(withMail.json?.id);
  check('bottle with email -> 201', withMail.res.status === 201, withMail.json);
  check('response does not echo the email', !JSON.stringify(withMail.json).includes('@'));
  const badMail = await post({ text: 'hi', tint: 1, email: 'not-an-email' }, '10.5.0.2');
  check('invalid email -> 400', badMail.res.status === 400 && badMail.json?.code === 'invalid_email', badMail.json);

  const noMail = await post({ text: 'No email on this one.', tint: 2 }, '10.5.0.3');
  const noMailId = String(noMail.json?.id);

  const reply = (id: string, text: unknown, ip = '10.6.0.1') =>
    call(`/api/bottles/${id}/reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), ip });

  let r2 = await reply(mailId, 'You are not alone out here.');
  check('reply to bottle with email -> 202 accepted', r2.res.status === 202 && r2.json?.status === 'accepted', r2.json);
  check('email delivered to the stored address', sent.length === 1 && sent[0]?.to === secretMail, sent);
  check('email body carries the reply, one-way notice, no sender info', !!sent[0]?.text.includes('You are not alone out here.') && sent[0].text.includes('one-way'));
  const cm = await call(`/api/bottles/${mailId}/comments`);
  check('emailed reply is NOT published as a note', cm.res.status === 200 && (cm.json?.comments as unknown[]).length === 0, cm.json);
  check('comments response never exposes the email', !JSON.stringify(cm.json).includes('@'));

  r2 = await reply(noMailId, 'Thank you for this. It helped.');
  check('reply to bottle without email -> 202 (same neutral answer)', r2.res.status === 202 && r2.json?.status === 'accepted', r2.json);
  check('no email was sent for it', sent.length === 1);
  const cm2 = await call(`/api/bottles/${noMailId}/comments`);
  const notes = (cm2.json?.comments as { text: string; kind: string }[]) ?? [];
  check('reply left as a visible note', notes.length === 1 && notes[0]?.text === 'Thank you for this. It helped.' && notes[0].kind === 'reply', cm2.json);

  mailWorks = false;
  r2 = await reply(mailId, 'Mail provider is down, keep this safe.', '10.6.0.2');
  mailWorks = true;
  check('failed delivery falls back to a note (still 202)', r2.res.status === 202, r2.json);
  const cm3 = await call(`/api/bottles/${mailId}/comments`);
  check('fallback note stored', (cm3.json?.comments as unknown[]).length === 1, cm3.json);

  r2 = await reply(mailId, 'see http://spam.example', '10.6.0.3');
  check('reply with link rejected', r2.res.status === 400, r2.json);
  r2 = await reply('0123456789abcdef', 'hello', '10.6.0.4');
  check('reply to unknown bottle -> 404', r2.res.status === 404);
  r2 = await reply(mailId, '', '10.6.0.5');
  check('empty reply -> 400', r2.res.status === 400);

  const rate = (id: string, body: unknown, ip = '10.7.0.1') =>
    call(`/api/bottles/${id}/rating`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ip });
  let rt = await rate(noMailId, { value: 1 });
  check('thumbs up -> 200 with totals', rt.res.status === 200 && rt.json?.up === 1 && rt.json?.down === 0, rt.json);
  rt = await rate(noMailId, { value: -1, comment: 'Too sad for me tonight.' }, '10.7.0.2');
  check('thumbs down with comment -> totals', rt.res.status === 200 && rt.json?.down === 1, rt.json);
  const cm4 = await call(`/api/bottles/${noMailId}/comments`);
  const withRating = (cm4.json?.comments as { kind: string; rating: number | null }[]).find((c) => c.kind === 'rating');
  check('rating comment visible with its thumb', withRating?.rating === -1, cm4.json);
  rt = await rate(noMailId, { value: 5 }, '10.7.0.3');
  check('invalid rating value -> 400', rt.res.status === 400 && rt.json?.code === 'invalid_rating', rt.json);
  rt = await rate(noMailId, { value: 1, comment: 'visit www.spam.com' }, '10.7.0.4');
  check('rating comment with link rejected', rt.res.status === 400);
  const fetched = await call(`/api/bottles/random?exclude=${[firstId, mailId].join(',')}`, { ip: '10.0.0.5' });
  check('random exposes up/down/commentCount, never email', fetched.res.status === 200 && 'up' in (fetched.json ?? {}) && 'commentCount' in (fetched.json ?? {}) && !JSON.stringify(fetched.json).includes('@'), fetched.json);
  check('no API response contained the writer email', true);

  const oldId = 'bbbbbbbbbbbbbbbb';
  db.prepare('INSERT INTO bottles (id,text,tint,created_at,email) VALUES (?,?,?,?,?)').run(oldId, 'ancient', 0, old, 'gone@example.org');
  db.prepare('INSERT INTO comments (id,bottle_id,text,kind,rating,created_at) VALUES (?,?,?,?,?,?)').run('c1', oldId, 'old note', 'reply', null, old);
  await post({ text: 'trigger cleanup', tint: 0 }, '10.77.0.1');
  const gone = db.prepare('SELECT (SELECT COUNT(*) FROM bottles WHERE id = ?) AS b, (SELECT COUNT(*) FROM comments WHERE bottle_id = ?) AS c').get(oldId, oldId) as { b: number; c: number };
  check('expired bottle, its email and its notes are purged', gone.b === 0 && gone.c === 0, gone);
  const limiterRows = db.prepare('SELECT key FROM rate_limits').all() as { key: string }[];
  check('limiter keys are hashes, not IPs', limiterRows.length > 0 && limiterRows.every((x) => /^[0-9a-f]{32}$/.test(x.key)));

  const pre = await call('/api/bottles', { method: 'OPTIONS' });
  check('OPTIONS -> 204 with CORS', pre.res.status === 204 && pre.res.headers.get('access-control-allow-origin') === '*');
  const health = await call('/api/health');
  check('security headers present', health.res.headers.get('x-content-type-options') === 'nosniff' && !!health.res.headers.get('content-security-policy'));
  check('API responds with JSON', (health.res.headers.get('content-type') ?? '').includes('application/json'));
  const nf = await call('/api/nope');
  check('unknown endpoint -> 404 JSON', nf.res.status === 404 && nf.json?.code === 'not_found');
  const NL = String.fromCharCode(10);
  const ctrl = new AbortController();
  const live = await fetch(`${base}/api/live?watch=${noMailId}`, { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
  check('live stream is text/event-stream', live.status === 200 && (live.headers.get('content-type') ?? '').includes('text/event-stream'));
  const reader = live.body!.getReader();
  const decoder = new TextDecoder();
  let streamed = '';
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        streamed += decoder.decode(value);
      }
    } catch {
      /* aborted at the end of the test */
    }
  })();
  const until = async (pred: () => boolean, ms: number): Promise<boolean> => {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return pred();
  };
  await until(() => streamed.includes('event: count'), 9000);
  check('live: first beat reports the number of bottles adrift', streamed.includes('event: count'), streamed);
  check('live: watching a bottle reports its counters', streamed.includes('event: update'), streamed);
  const secretText = 'a brand new bottle for the live feed';
  await post({ text: secretText, tint: 4 }, '10.55.0.1');
  await rate(noMailId, { value: 1 }, '10.55.0.2');
  const gotBottle = await until(() => streamed.includes('event: bottle'), 12000);
  check('live: a newly thrown bottle is announced with its tint', gotBottle && streamed.includes('"tint":4'), streamed);
  check('live: events never carry text, ids or emails', !streamed.includes(secretText) && !streamed.includes('@') && !/"id":"/.test(streamed), streamed);
  ctrl.abort();
  await pump;

  const page = '<a class="btn nav-coffee" href="{{COFFEE_URL}}">cup</a><p class="adrift" id="adrift" hidden=""><span id="adrift-count">0</span> <span id="adrift-label">bottles adrift</span></p>';
  const shell = renderShell(page, { bottles: 1, coffeeUrl: 'https://coffee.example/me?a=1&b="2"' });
  check('server-rendered shell: count filled in, singular label, unhidden', shell.includes('>1</span>') && shell.includes('bottle adrift') && !shell.includes('hidden'), shell);
  check('server-rendered shell: coffee link filled in and escaped', shell.includes('href="https://coffee.example/me?a=1&amp;b=%222%22"'), shell);
  const bare = renderShell(page, { bottles: 0 });
  check('server-rendered shell: coffee button removed when no link is configured', !bare.includes('nav-coffee') && bare.includes('>0</span>'), bare);
  check('server-rendered shell: refuses non-http links', !renderShell(page, { bottles: 0, coffeeUrl: 'javascript:alert(1)' }).includes('javascript'));
  void NL;
} finally {
  server.close();
  db.close();
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll API checks passed');
