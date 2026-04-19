/* ayanami.vault — crypto.js
   Client-side AES-256-GCM encryption using the Web Crypto API.
   The vault key / derived key never leave the browser.
*/

const PBKDF2_ITERATIONS = 310000;
const PBKDF2_HASH      = 'SHA-256';
const AES_KEY_LEN      = 256;

// Derive an AES-GCM key from a vault password + salt string
async function vault_deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name:       'PBKDF2',
      salt:       enc.encode(salt),
      iterations: PBKDF2_ITERATIONS,
      hash:       PBKDF2_HASH,
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LEN },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt a plaintext string. Returns { data: base64, iv: base64 }
async function vault_encrypt(key, plaintext) {
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  return {
    data: _bufToB64(ciphertext),
    iv:   _bufToB64(iv.buffer),
  };
}

// Decrypt a { data, iv } (both base64) pair. Returns the plaintext string.
// Throws on wrong key or tampered data.
async function vault_decrypt(key, data, iv) {
  const cipherBuf = _b64ToBuf(data);
  const ivBuf     = _b64ToBuf(iv);
  const plainBuf  = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuf },
    key,
    cipherBuf
  );
  return new TextDecoder().decode(plainBuf);
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function _bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function _b64ToBuf(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}
