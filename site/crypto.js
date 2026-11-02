/** Decrypt program.enc.json in the browser. The key stays on this device. */

export function base64UrlToBytes(value) {
  try {
    const text = String(value ?? '').trim();
    if (!text || /[^A-Za-z0-9_-]/.test(text)) return null;
    const padded = text + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function decryptProgram(envelope, keyText) {
  if (!envelope || envelope.v !== 1 || envelope.alg !== 'AES-256-GCM') {
    throw new Error('Unable to unlock the program.');
  }
  if (!globalThis.crypto?.subtle) throw new Error('Unable to unlock the program.');
  const keyBytes = base64UrlToBytes(keyText);
  const iv = base64UrlToBytes(envelope.iv);
  const ciphertext = base64UrlToBytes(envelope.ct);
  if (!keyBytes || keyBytes.length !== 32 || !iv || iv.length !== 12 || !ciphertext || ciphertext.length <= 16) {
    throw new Error('Unable to unlock the program.');
  }
  try {
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      cryptoKey,
      ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('Unable to unlock the program.');
  }
}
