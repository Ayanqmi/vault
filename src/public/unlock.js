/* ayanami.vault — unlock.js  (vault key unlock page) */

const form       = document.getElementById('unlockForm');
const unlockBtn  = document.getElementById('unlockBtn');
const unlockText = document.getElementById('unlockBtnText');
const errEl      = document.getElementById('unlockError');
const csrfToken  = document.querySelector('meta[name="csrf-token"]').content;

if (form) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.style.display    = 'none';
    unlockBtn.disabled     = true;
    unlockText.textContent = 'unlocking…';

    const vaultKey = document.getElementById('vaultKey').value;
    const salt     = document.getElementById('vaultSalt').value;
    const testEnc  = document.getElementById('vaultTest').value;
    const testIv   = document.getElementById('vaultTestIv').value;

    try {
      const key       = await vault_deriveKey(vaultKey, salt);
      const decrypted = await vault_decrypt(key, testEnc, testIv);

      const res = await fetch('/vault/unlock', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body:    JSON.stringify({ sentinel: decrypted }),
      });

      if (res.redirected) { window.location.href = res.url; return; }

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        window.location.href = '/vault';
      } else {
        throw new Error(data.error || 'Incorrect vault key.');
      }
    } catch (err) {
      errEl.textContent      = err.message || 'Incorrect vault key.';
      errEl.style.display    = 'block';
      unlockBtn.disabled     = false;
      unlockText.textContent = 'unlock';
    }
  });
}
