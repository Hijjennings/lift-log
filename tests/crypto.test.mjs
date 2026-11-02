import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { decryptProgram } from '../site/crypto.js';
import { encryptProgram } from './encrypt.mjs';

const sample = JSON.parse(readFileSync(new URL('./fixtures/sample-program.json', import.meta.url), 'utf8'));

test('a fixture program round-trips through AES-256-GCM', async () => {
  const { key, enc } = await encryptProgram(sample);
  assert.equal(key.length, 43);
  assert.equal(enc.v, 1);
  assert.equal(enc.alg, 'AES-256-GCM');
  const program = await decryptProgram(enc, key);
  assert.equal(program.days.length, sample.days.length);
  assert.equal(program.days[0].exercises[0].name, 'Sample Exercise A');
});

test('a bad key fails without throwing a stack into the result', async () => {
  const { key, enc } = await encryptProgram(sample);
  const bad = key.replace(/^./, key[0] === 'A' ? 'B' : 'A');
  await assert.rejects(() => decryptProgram(enc, bad), /Unable to unlock the program/);
  await assert.rejects(() => decryptProgram(enc, 'abcd'), /Unable to unlock the program/);
});

test('the shipped program is ciphertext only', async () => {
  const raw = readFileSync(new URL('../site/program.enc.json', import.meta.url), 'utf8');
  const envelope = JSON.parse(raw);
  assert.equal(envelope.v, 1);
  assert.equal(envelope.alg, 'AES-256-GCM');
  assert.equal(Object.keys(envelope).sort().join(','), 'alg,ct,iv,v');
  const iv = Buffer.from(envelope.iv, 'base64url');
  const ct = Buffer.from(envelope.ct, 'base64url');
  assert.equal(iv.length, 12);
  assert.ok(ct.length > 16);
  assert.equal(raw.includes('"days"'), false);
  assert.equal(raw.includes('"exercises"'), false);
  assert.equal(raw.includes('"titlePrinted"'), false);
  const wrong = 'A'.repeat(43);
  await assert.rejects(() => decryptProgram(envelope, wrong), /Unable to unlock the program/);
});
