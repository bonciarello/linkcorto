const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4599;
const DATA_FILE = path.join(__dirname, 'data', 'links.json');

// ── Storage helpers ──────────────────────────────────────────────

function loadLinks() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (_) { /* corrupt file → start fresh */ }
  return {};
}

function saveLinks(links) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(links, null, 2), 'utf-8');
}

function generateSlug(length = 6) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

// ── Middleware ────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ── API: shorten ─────────────────────────────────────────────────

app.post('/api/shorten', (req, res) => {
  const { url, slug: customSlug, duration } = req.body;

  // Validate URL
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL mancante o non valido.' });
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return res.status(400).json({ error: 'L\'URL inserito non è valido. Inserisci un URL completo (es. https://esempio.com).' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'L\'URL deve iniziare con http:// o https://.' });
  }

  // Validate duration
  const dur = Number(duration);
  if (!Number.isFinite(dur) || dur <= 0) {
    return res.status(400).json({ error: 'La durata deve essere un numero positivo di minuti.' });
  }
  if (dur > 525600) { // 1 year
    return res.status(400).json({ error: 'La durata massima è 525600 minuti (1 anno).' });
  }

  const links = loadLinks();

  // Determine slug
  let slug;
  if (customSlug && typeof customSlug === 'string' && customSlug.trim()) {
    slug = customSlug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!slug || slug.length < 3) {
      return res.status(400).json({ error: 'Lo slug personalizzato deve contenere almeno 3 caratteri tra lettere, numeri, trattini e underscore.' });
    }
    if (slug.length > 32) {
      return res.status(400).json({ error: 'Lo slug personalizzato non può superare i 32 caratteri.' });
    }
    if (links[slug] && links[slug].expiresAt > Date.now()) {
      return res.status(409).json({ error: 'Questo slug è già in uso. Scegline un altro.' });
    }
  } else {
    // Generate unique slug
    do {
      slug = generateSlug();
    } while (links[slug] && links[slug].expiresAt > Date.now());
  }

  const now = Date.now();
  const expiresAt = now + dur * 60 * 1000;

  links[slug] = {
    url: parsed.href,
    createdAt: now,
    expiresAt
  };

  saveLinks(links);

  res.json({
    slug,
    shortUrl: `${req.protocol}://${req.get('host')}/${slug}`,
    expiresAt,
    url: parsed.href
  });
});

// ── Redirect handler ─────────────────────────────────────────────

app.get('/:slug', (req, res, next) => {
  const { slug } = req.params;

  // Skip static files and API
  if (slug === 'api' || slug === 'favicon.ico' || slug === 'robots.txt' || slug === 'sitemap.xml') {
    return next();
  }

  const links = loadLinks();
  const entry = links[slug];

  if (!entry) {
    return res.status(404).sendFile(path.join(__dirname, 'public', 'expired.html'));
  }

  if (Date.now() > entry.expiresAt) {
    // Clean up expired entry
    delete links[slug];
    saveLinks(links);
    return res.status(410).sendFile(path.join(__dirname, 'public', 'expired.html'));
  }

  // Redirect
  res.redirect(301, entry.url);
});

// ── Cleanup stale entries ────────────────────────────────────────

function cleanupExpired() {
  const links = loadLinks();
  const now = Date.now();
  let changed = false;
  for (const slug of Object.keys(links)) {
    if (links[slug].expiresAt <= now) {
      delete links[slug];
      changed = true;
    }
  }
  if (changed) saveLinks(links);
}

// Run cleanup every 10 minutes
setInterval(cleanupExpired, 10 * 60 * 1000);
cleanupExpired(); // Run at startup

// ── Start ────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LinkCorto in ascolto su http://0.0.0.0:${PORT}`);
});
