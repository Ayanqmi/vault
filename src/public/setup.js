/* ayanami.vault — setup.js  (vault key creation page) */

const form        = document.getElementById('setupForm');
const setupBtn    = document.getElementById('setupBtn');
const setupText   = document.getElementById('setupBtnText');
const errEl       = document.getElementById('setupError');
const setupCsrf   = document.getElementById('setupCsrf').value;
const strengthBar   = document.getElementById('strengthBar');
const strengthLabel = document.getElementById('strengthLabel');

document.getElementById('vaultKey').addEventListener('input', function () {
  const v = this.value;
  let score = 0;
  if (v.length >= 8)  score++;
  if (v.length >= 12) score++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
  if (/\d/.test(v)) score++;
  if (/[^a-zA-Z0-9]/.test(v)) score++;

  const labels = ['', 'weak', 'fair', 'good', 'strong', 'very strong'];
  const colors = ['', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#27ae60'];
  strengthBar.style.width      = (score / 5 * 100) + '%';
  strengthBar.style.background = colors[score] || 'transparent';
  strengthLabel.textContent    = labels[score] || '';
});

if (form) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.style.display = 'none';

    const vaultKey = document.getElementById('vaultKey').value;
    const confirm  = document.getElementById('vaultKeyConfirm').value;

    if (vaultKey.length < 8) {
      errEl.textContent = 'Vault key must be at least 8 characters.';
      errEl.style.display = 'block';
      return;
    }
    if (vaultKey !== confirm) {
      errEl.textContent = 'Vault keys do not match.';
      errEl.style.display = 'block';
      return;
    }

    setupBtn.disabled = true;
    setupText.textContent = 'creating vault…';

    try {
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      const salt      = btoa(String.fromCharCode(...saltBytes));
      const key       = await vault_deriveKey(vaultKey, salt);
      const { data, iv } = await vault_encrypt(key, 'ayanami.vault.ok');

      const res = await fetch('/vault/setup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': setupCsrf },
        body:    JSON.stringify({ vault_salt: salt, vault_test: data, vault_test_iv: iv }),
      });

      if (res.redirected) { window.location.href = res.url; return; }

      const result = await res.json().catch(() => ({}));
      if (res.ok && result.ok) {
        window.location.href = '/vault';
      } else {
        throw new Error(result.error || 'Setup failed.');
      }
    } catch (err) {
      errEl.textContent = err.message || 'Something went wrong.';
      errEl.style.display = 'block';
      setupBtn.disabled = false;
      setupText.textContent = 'create vault';
    }
  });
}
