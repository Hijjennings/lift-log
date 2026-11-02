import { webcrypto } from 'node:crypto';

export function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

/** Test-only encrypt. Matches the site's AES-256-GCM envelope. */
export async function encryptProgram(program, keyBytes = webcrypto.getRandomValues(new Uint8Array(32))) {
  const key = keyBytes instanceof Uint8Array ? keyBytes : new Uint8Array(keyBytes);
  const cryptoKey = await webcrypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(program));
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plain));
  return {
    key: bytesToBase64Url(key),
    enc: {
      v: 1,
      alg: 'AES-256-GCM',
      iv: bytesToBase64Url(iv),
      ct: bytesToBase64Url(ciphertext),
    },
  };
}
