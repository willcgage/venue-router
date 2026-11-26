// Starts a real copy of the server against pretend devices, with its own throwaway data folder.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), net = require('net');
const { startHub } = require('./pretend-hub');
const fixture = require('./fixture');

const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

function request(base, method, url, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(base + url, { method, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, res => {
      let text = '';
      res.on('data', d => (text += d));
      res.on('end', () => resolve({ status: res.statusCode, text, cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// The first state the live feed sends. Engineers and everyone else get different versions of it.
function feed(base, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + '/events', { headers: cookie ? { Cookie: cookie } : {} }, res => {
      let text = '';
      res.on('data', d => {
        text += d;
        const m = /^data: (.*)$/m.exec(text);
        if (m && text.includes(m[0] + '\n\n')) { req.destroy(); resolve(JSON.parse(m[1])); }
      });
    });
    req.on('error', e => { if (e.code !== 'ECONNRESET') reject(e); });
    setTimeout(() => { req.destroy(); reject(new Error('The feed sent nothing in 8 seconds.')); }, 8000).unref();
  });
}

async function startApp({ ports = fixture.ports() } = {}) {
  const rtr = await startHub(fixture.router()), sw = await startHub(fixture.switcher());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-router-test-'));
  fs.writeFileSync(path.join(dir, 'venue.json'), JSON.stringify({
    places: { rtr: 'Rack', sw: 'Rack' }, core: { router: '127.0.0.1:' + rtr.port, switcher: '127.0.0.1:' + sw.port },
    ties: fixture.ties, rooms: [], decks: [], convs: [], mons: [], ndis: [], links: [],
  }));
  fs.writeFileSync(path.join(dir, 'spaces.json'), JSON.stringify(fixture.spaces()));
  if (ports) fs.writeFileSync(path.join(dir, 'ports.json'), JSON.stringify(ports));
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), '--data=' + dir], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', d => (log += d));
  child.stderr.on('data', d => (log += d));
  let exited = false;
  child.once('exit', () => { exited = true; });
  const cleanUp = async () => {
    if (!exited) { child.kill(); await new Promise(r => child.once('exit', r)); }
    await rtr.close(); await sw.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  // Ready once the feed has the router's labels in it. If the server stops or never answers, say so and leave nothing running.
  const until = Date.now() + 15000;
  for (;;) {
    try { const f = await feed(base); if (f.rtr && f.rtr.inL.length) break; } catch (e) {}
    if (exited || Date.now() > until) {
      await cleanUp();
      throw new Error((exited ? 'The server stopped as soon as it started. Has "npm ci" been run?' : 'The server did not start in 15 seconds.') + '\n' + log);
    }
    await new Promise(r => setTimeout(r, 150));
  }
  return {
    base, dir, rtr, sw,
    log: () => log,
    get: (url, opts) => request(base, 'GET', url, opts),
    post: (url, body, opts) => request(base, 'POST', url, { body, ...opts }),
    feed: cookie => feed(base, cookie),
    file: name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')),
    stop: cleanUp,
  };
}

module.exports = { startApp };
