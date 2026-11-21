import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleContact } from '../functions/api/contact.js';

const env = {
  TURNSTILE_SECRET_KEY: 'secret',
  RESEND_API_KEY: 'resend-key',
  MAIL_TO: 'to@example.com',
  MAIL_FROM: 'AG Automation <noreply@agautomation.it>',
};

const valid = { name: 'Mario Rossi', email: 'mario@acme.it', company: 'Acme', message: 'Ciao', website: '', token: 'tok' };

function post(body) {
  return new Request('https://www.agautomation.it/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function fakeFetch({ captcha = true, sendOk = true } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    if (url.includes('siteverify')) return Response.json({ success: captcha });
    return new Response(sendOk ? '{"id":"1"}' : '{"message":"nope"}', { status: sendOk ? 200 : 422 });
  };
  return { impl, calls };
}

async function run(body, opts) {
  const f = fakeFetch(opts);
  const res = await handleContact(post(body), env, f.impl);
  return { status: res.status, json: await res.json(), calls: f.calls };
}

test('valid message is verified and sent with reply-to', async () => {
  const { status, json, calls } = await run(valid);
  assert.equal(status, 200);
  assert.deepEqual(json, { ok: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body, { secret: 'secret', response: 'tok', remoteip: '1.2.3.4' });
  const mail = calls[1].body;
  assert.equal(calls[1].headers.Authorization, 'Bearer resend-key');
  assert.deepEqual(mail.to, ['to@example.com']);
  assert.equal(mail.from, env.MAIL_FROM);
  assert.equal(mail.reply_to, 'mario@acme.it');
  assert.equal(mail.subject, 'Sito AG Automation: Mario Rossi (Acme)');
  assert.match(mail.text, /Ciao$/);
});

test('filled honeypot pretends success and sends nothing', async () => {
  const { status, calls } = await run({ ...valid, website: 'http://spam' });
  assert.equal(status, 200);
  assert.equal(calls.length, 0);
});

test('missing token is rejected without calling anything', async () => {
  const { status, json, calls } = await run({ ...valid, token: '' });
  assert.equal(status, 403);
  assert.equal(json.error, 'captcha');
  assert.equal(calls.length, 0);
});

test('failed captcha is rejected and no mail is sent', async () => {
  const { status, json, calls } = await run(valid, { captcha: false });
  assert.equal(status, 403);
  assert.equal(json.error, 'captcha');
  assert.equal(calls.length, 1);
});

test('invalid input is rejected', async () => {
  for (const body of [
    'not json',
    { ...valid, email: 'nope' },
    { ...valid, name: '  ' },
    { ...valid, message: '' },
    { ...valid, message: 'x'.repeat(5001) },
    { ...valid, name: 'a\r\nBcc: x@y.z' },
  ]) {
    const { status, json, calls } = await run(body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(json.error, 'invalid');
    assert.equal(calls.length, 0);
  }
});

test('provider failure returns 502', async () => {
  const { status, json } = await run(valid, { sendOk: false });
  assert.equal(status, 502);
  assert.equal(json.error, 'send');
});
