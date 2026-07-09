// Test suite for LinkCorto — uses Node.js built-in http module
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, 'data', 'links.json');
const TEST_PORT = 14599;

let serverProc;
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: TEST_PORT, path: pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }); }
        catch (_) { resolve({ status: res.statusCode, headers: res.headers, body }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(pathname, followRedirects = false) {
  return new Promise((resolve, reject) => {
    const doGet = (p, redirects) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      const req = http.request({
        hostname: '127.0.0.1', port: TEST_PORT, path: p,
        method: 'GET'
      }, (res) => {
        if (followRedirects && [301, 302, 303, 307, 308].includes(res.statusCode)) {
          const loc = res.headers.location;
          if (loc) {
            // Parse relative or absolute
            try {
              const u = new URL(loc.startsWith('/') ? `http://127.0.0.1:${TEST_PORT}${loc}` : loc);
              return doGet(u.pathname + u.search, redirects + 1);
            } catch (_) { return resolve({ status: res.statusCode, headers: res.headers, body: '' }); }
          }
        }
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    };
    doGet(pathname, 0);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('LinkCorto Test Suite\n');

  // Clean data file
  try { fs.unlinkSync(DATA_FILE); } catch (_) {}

  // Start server
  console.log('Starting test server...');
  serverProc = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: 'pipe'
  });

  // Wait for server to start
  await new Promise((resolve, reject) => {
    let output = '';
    serverProc.stdout.on('data', d => { output += d.toString(); if (output.includes('LinkCorto')) resolve(); });
    serverProc.stderr.on('data', d => { /* ignore */ });
    setTimeout(resolve, 3000);
  });

  await sleep(500);

  try {
    // ── API: POST /api/shorten ─────────────────────────────────
    console.log('\n📦 POST /api/shorten');
    {
      // Valid request with auto slug
      const r = await post('/api/shorten', {
        url: 'https://esempio.com/articolo/lunghissimo',
        duration: 60
      });
      assert(r.status === 200, 'Valid request returns 200');
      assert(r.body.slug && r.body.slug.length >= 6, 'Auto-generated slug is at least 6 chars');
      assert(r.body.shortUrl.includes(r.body.slug), 'shortUrl contains the slug');
      assert(r.body.url === 'https://esempio.com/articolo/lunghissimo', 'Original URL preserved');
      assert(r.body.expiresAt > Date.now(), 'Expiry is in the future');
    }

    {
      // Valid request with custom slug
      const r = await post('/api/shorten', {
        url: 'https://esempio.com/altro',
        slug: 'mio-test-42',
        duration: 1440
      });
      assert(r.status === 200, 'Custom slug returns 200');
      assert(r.body.slug === 'mio-test-42', 'Custom slug preserved');
    }

    {
      // Duplicate custom slug
      const r = await post('/api/shorten', {
        url: 'https://esempio.com/ancora',
        slug: 'mio-test-42',
        duration: 60
      });
      assert(r.status === 409, 'Duplicate slug returns 409');
      assert(r.body.error && r.body.error.toLowerCase().includes('già in uso'), 'Error mentions slug in use');
    }

    {
      // Missing URL
      const r = await post('/api/shorten', {
        duration: 60
      });
      assert(r.status === 400, 'Missing URL returns 400');
    }

    {
      // Invalid URL
      const r = await post('/api/shorten', {
        url: 'not-a-valid-url',
        duration: 60
      });
      assert(r.status === 400, 'Invalid URL returns 400');
    }

    {
      // Non-http URL
      const r = await post('/api/shorten', {
        url: 'ftp://files.example.com',
        duration: 60
      });
      assert(r.status === 400, 'Non-http URL returns 400');
    }

    {
      // Negative duration
      const r = await post('/api/shorten', {
        url: 'https://esempio.com',
        duration: -5
      });
      assert(r.status === 400, 'Negative duration returns 400');
    }

    {
      // Duration exceeding max
      const r = await post('/api/shorten', {
        url: 'https://esempio.com',
        duration: 999999
      });
      assert(r.status === 400, 'Excessive duration returns 400');
    }

    {
      // Slug too short
      const r = await post('/api/shorten', {
        url: 'https://esempio.com',
        slug: 'ab',
        duration: 60
      });
      assert(r.status === 400, 'Too-short slug returns 400');
    }

    // ── GET /:slug (redirect) ──────────────────────────────────
    console.log('\n🔀 GET /:slug (redirect)');
    {
      // Create a link first
      const create = await post('/api/shorten', {
        url: 'https://destinazione.com/pagina',
        duration: 60
      });
      assert(create.status === 200, 'Create link for redirect test');

      const slug = create.body.slug;

      // Check redirect (don't follow — external destination may be unreachable)
      const r = await get('/' + slug, false);
      assert(r.status === 301, `Valid slug returns redirect 301 (got ${r.status})`);
      assert(r.headers.location === 'https://destinazione.com/pagina', 'Redirect points to correct URL');
    }

    {
      // Non-existent slug
      const r = await get('/slug-inesistente-xyz');
      assert(r.status === 404, 'Non-existent slug returns 404');
      assert(r.body.includes('scaduto') || r.body.includes('expired') || r.body.includes('LinkCorto'), 'Expired page shown for 404');
    }

    // ── GET /:slug (expired) ───────────────────────────────────
    console.log('\n⏰ Expired link behavior');
    {
      // Create a link with 1-second duration (practically expired)
      const create = await post('/api/shorten', {
        url: 'https://esempio.com/efimero',
        duration: 0.001 // ~0.06 seconds — will expire immediately
      });
      assert(create.status === 200, 'Create ephemeral link');

      const slug = create.body.slug;
      await sleep(500); // wait for it to expire

      const r = await get('/' + slug);
      assert(r.status === 410 || r.status === 404, `Expired link returns 410 or 404 (got ${r.status})`);
      assert(r.body.includes('scaduto') || r.body.includes('LinkCorto') || r.body.includes('expired'), 'Expired page shown');
    }

    // ── Static files ──────────────────────────────────────────
    console.log('\n📄 Static files');
    {
      const r = await get('/');
      assert(r.status === 200, 'Home page returns 200');
      assert(r.body.includes('LinkCorto'), 'Home page contains app name');
      assert(r.body.includes('linkcorto.it'), 'Home page contains domain');
    }

    {
      const r = await get('/robots.txt');
      assert(r.status === 200, 'robots.txt returns 200');
    }

    {
      const r = await get('/sitemap.xml');
      assert(r.status === 200, 'sitemap.xml returns 200');
    }

  } catch (err) {
    console.error('Test error:', err);
    failed++;
  }

  // Cleanup
  serverProc.kill();
  try { fs.unlinkSync(DATA_FILE); } catch (_) {}

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'─'.repeat(40)}`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
