/* ── DOM refs ─────────────────────────────────────────────── */
const form = document.getElementById('shorten-form');
const urlInput = document.getElementById('url-input');
const slugInput = document.getElementById('slug-input');
const durationAmount = document.getElementById('duration-amount');
const durationUnit = document.getElementById('duration-unit');
const submitBtn = document.getElementById('submit-btn');
const resultDiv = document.getElementById('result');
const resultUrl = document.getElementById('result-url');
const resultExpiry = document.getElementById('result-expiry');
const resultOriginal = document.getElementById('result-original');
const copyBtn = document.getElementById('copy-btn');

const urlError = document.getElementById('url-error');
const slugError = document.getElementById('slug-error');
const durationError = document.getElementById('duration-error');

/* ── Validation ───────────────────────────────────────────── */

function clearErrors() {
  urlError.textContent = '';
  slugError.textContent = '';
  durationError.textContent = '';
  urlInput.setCustomValidity('');
  slugInput.setCustomValidity('');
  durationAmount.setCustomValidity('');
}

function showFieldError(field, message) {
  const el = document.getElementById(field + '-error');
  if (el) el.textContent = message;
}

function validateURL(value) {
  if (!value.trim()) return 'Inserisci un URL.';
  try {
    const u = new URL(value.trim());
    if (!['http:', 'https:'].includes(u.protocol)) return 'L\'URL deve iniziare con http:// o https://.';
    return null;
  } catch (_) {
    return 'URL non valido. Inserisci un indirizzo completo (es. https://esempio.com/pagina).';
  }
}

function validateSlug(value) {
  if (!value.trim()) return null; // optional
  const cleaned = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (cleaned.length < 3) return 'Lo slug deve contenere almeno 3 caratteri tra lettere, numeri, trattini e underscore.';
  if (cleaned.length > 32) return 'Lo slug non può superare i 32 caratteri.';
  if (cleaned !== value.trim()) return 'Lo slug può contenere solo lettere minuscole, numeri, trattini (-) e underscore (_).';
  return null;
}

function validateDuration(amount, unit) {
  const mins = Number(amount) * Number(unit);
  if (!Number.isFinite(mins) || mins <= 0) return 'Inserisci una durata valida.';
  if (mins > 525600) return 'La durata massima è 365 giorni (525600 minuti).';
  return null;
}

/* ── Blur validation ──────────────────────────────────────── */

urlInput.addEventListener('blur', () => {
  const err = validateURL(urlInput.value);
  showFieldError('url', err || '');
});

slugInput.addEventListener('blur', () => {
  const err = validateSlug(slugInput.value);
  showFieldError('slug', err || '');
});

durationAmount.addEventListener('blur', () => {
  const err = validateDuration(durationAmount.value, durationUnit.value);
  showFieldError('duration', err || '');
});

durationUnit.addEventListener('change', () => {
  if (durationAmount.value) {
    const err = validateDuration(durationAmount.value, durationUnit.value);
    showFieldError('duration', err || '');
  }
});

/* ── Submit ───────────────────────────────────────────────── */

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors();

  // Validate all
  const urlErr = validateURL(urlInput.value);
  if (urlErr) { showFieldError('url', urlErr); urlInput.focus(); return; }

  const slugErr = validateSlug(slugInput.value);
  if (slugErr) { showFieldError('slug', slugErr); slugInput.focus(); return; }

  const durErr = validateDuration(durationAmount.value, durationUnit.value);
  if (durErr) { showFieldError('duration', durErr); durationAmount.focus(); return; }

  // Prepare payload
  const totalMinutes = Number(durationAmount.value) * Number(durationUnit.value);

  const payload = {
    url: urlInput.value.trim(),
    duration: totalMinutes
  };

  if (slugInput.value.trim()) {
    payload.slug = slugInput.value.trim();
  }

  // Submit
  submitBtn.disabled = true;
  submitBtn.querySelector('.btn-label').textContent = 'Generazione in corso…';
  resultDiv.hidden = true;

  try {
    const resp = await fetch('api/shorten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();

    if (!resp.ok) {
      // Field-specific errors
      if (data.error) {
        if (data.error.toLowerCase().includes('slug')) {
          showFieldError('slug', data.error);
          slugInput.focus();
        } else if (data.error.toLowerCase().includes('url') || data.error.toLowerCase().includes('http')) {
          showFieldError('url', data.error);
          urlInput.focus();
        } else if (data.error.toLowerCase().includes('durata') || data.error.toLowerCase().includes('minut')) {
          showFieldError('duration', data.error);
          durationAmount.focus();
        } else {
          showFieldError('url', data.error);
        }
      }
      return;
    }

    // Success
    resultUrl.textContent = data.shortUrl;
    resultExpiry.textContent = formatExpiry(data.expiresAt);
    resultOriginal.textContent = 'Punta a: ' + data.url;
    resultDiv.hidden = false;
    resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Reset form
    urlInput.value = '';
    slugInput.value = '';
    durationAmount.value = '30';
    durationUnit.value = '60';

  } catch (err) {
    showFieldError('url', 'Errore di connessione. Riprova.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.querySelector('.btn-label').textContent = 'Genera link breve';
  }
});

/* ── Copy button ──────────────────────────────────────────── */

copyBtn.addEventListener('click', async () => {
  const url = resultUrl.textContent;
  try {
    await navigator.clipboard.writeText(url);
    copyBtn.classList.add('copied');
    copyBtn.querySelector('span').textContent = 'Copiato!';
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.querySelector('span').textContent = 'Copia';
    }, 2000);
  } catch (_) {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copyBtn.querySelector('span').textContent = 'Copiato!';
    setTimeout(() => {
      copyBtn.querySelector('span').textContent = 'Copia';
    }, 2000);
  }
});

/* ── Helpers ──────────────────────────────────────────────── */

function formatExpiry(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  const diffMs = d - now;
  const diffMins = Math.round(diffMs / 60000);

  const dateStr = d.toLocaleString('it-IT', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  if (diffMins < 60) {
    return `Scade tra ${diffMins} minuti (${dateStr})`;
  } else if (diffMins < 1440) {
    const hours = Math.round(diffMins / 60);
    return `Scade tra ${hours} ore (${dateStr})`;
  } else {
    const days = Math.round(diffMins / 1440);
    return `Scade tra ${days} giorni (${dateStr})`;
  }
}
