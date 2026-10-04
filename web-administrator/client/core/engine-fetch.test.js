import assert from 'node:assert/strict';

globalThis.document = { cookie: 'oie-engine=k%3Afirst; oie-login=one' };
globalThis.window = new EventTarget();
const { engineFetch, adoptEngineContext, assertEngineResponse, discardEngineResponses, captureEngineSession } = await import('./engine-fetch.js');
let calls = 0, changes = 0;
window.addEventListener('oie-session-changed', () => changes++);
globalThis.fetch = async (_url, init) => {
    calls++;
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.get('X-OIE-Context'), encodeURIComponent(JSON.stringify(['k:first', '', 'one'])));
    return new Response('ok');
};
assert.equal(await (await engineFetch('/api/test', { cache: 'force-cache' })).text(), 'ok');
document.cookie = 'oie-engine=k%3Asecond; oie-login=two';
await assert.rejects(engineFetch('/api/test', { method: 'PUT', body: 'secret' }), /会话已变更/);
assert.equal(calls, 1, 'stale mutation must not reach fetch');
assert.equal(changes, 1);

// Even a same-engine re-login must fence the old tab's work.
document.cookie = 'oie-engine=k%3Afirst; oie-login=two';
await assert.rejects(engineFetch('/api/test'), /会话已变更/);
assert.equal(calls, 1);

// Header-time and body-time races both discard the previous session's data.
adoptEngineContext();
let complete;
globalThis.fetch = () => new Promise(resolve => { complete = resolve; });
const pending = engineFetch('/api/test');
document.cookie = 'oie-engine=k%3Asecond; oie-login=three';
complete(new Response('old data'));
await assert.rejects(pending, /会话已变更/);

adoptEngineContext();
globalThis.fetch = async () => new Response('old body');
const response = await engineFetch('/api/test');
document.cookie = 'oie-engine=k%3Asecond; oie-login=four';
adoptEngineContext();
await response.text();
assert.throws(() => assertEngineResponse(response), /上一会话/);
// Local idle lock fences headers AND bodies without waiting for remote cookies.
globalThis.fetch = () => new Promise(resolve => { complete = resolve; });
const pendingIdle = engineFetch('/api/test');
discardEngineResponses();
complete(new Response('late private data'));
await assert.rejects(pendingIdle, /上一会话/);
globalThis.fetch = async () => new Response('new response');
const beforeLock = await engineFetch('/api/test');
discardEngineResponses();
assert.throws(() => assertEngineResponse(beforeLock), /上一会话/);
assert.equal(await (await engineFetch('/api/test')).text(), 'new response');

// A logical operation cannot start fresh requests after an earlier stage was
// invalidated, even if that stage's caller deliberately tolerated its failure.
const interruptedOperation = captureEngineSession();
interruptedOperation();
discardEngineResponses();
assert.throws(interruptedOperation, /上一会话/);
const replacementOperation = captureEngineSession();
replacementOperation();
assert.throws(interruptedOperation, /上一会话/);

document.cookie = 'oie-engine=k%3Asecond; oie-login=five';
assert.throws(replacementOperation, /会话已变更/);
assert.throws(captureEngineSession, /会话已变更/);
adoptEngineContext();
assert.throws(replacementOperation, /上一会话/);
captureEngineSession()();
console.log('engine-fetch: session changes block requests and stale responses');
