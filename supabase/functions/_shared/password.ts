const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const encoded = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey(
    'raw',
    encoded,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    HASH_BYTES * 8
  );
  const saltHex = bufferToHex(salt);
  const hashHex = bufferToHex(bits);
  return `${saltHex}.${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const dot = stored.indexOf('.');
  if (dot === -1) return false;
  const saltHex = stored.slice(0, dot);
  const hashHex = stored.slice(dot + 1);
  const salt = hexToBuffer(saltHex);
  const encoded = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey(
    'raw',
    encoded,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    HASH_BYTES * 8
  );
  const computed = bufferToHex(bits);
  return computed === hashHex;
}
