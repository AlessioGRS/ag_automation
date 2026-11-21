import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const env = { ASSETS: { fetch: async () => new Response('asset') } };
const call = (path, method = 'GET') => worker.fetch(new Request(`https://www.agautomation.it${path}`, { method }), env);

test('GET /api/contact is not allowed', async () => {
  const res = await call('/api/contact');
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'POST');
});

test('unknown /api path is 404', async () => {
  assert.equal((await call('/api/other', 'POST')).status, 404);
});

test('other paths fall through to static assets', async () => {
  assert.equal(await (await call('/index.html')).text(), 'asset');
});
