// Read-only snapshot of a VideoHub router and an ATEM switcher over the Videohub Ethernet Protocol (TCP 9990).
// It connects, reads the status dump each device sends on connect, and disconnects. It never sends a command.
// Usage: node capture.js [router-ip] [switcher-ip]
// The addresses can be left out when venue.json already holds them. Writes venue-snapshot.html, an offline copy of
// the app with the snapshot inside it, and venue-snapshot.json. Neither is tracked by git.
const net = require('net');
const fs = require('fs');
const path = require('path');
const { args, file: dataFile } = require('./data-dir');

function read(ip) {
  return new Promise((resolve, reject) => {
    let text = '';
    const sock = net.connect({ host: ip, port: 9990 });
    const done = () => { sock.destroy(); resolve(text); };
    sock.setTimeout(8000, () => (text ? done() : (sock.destroy(), reject(new Error('Timed out reading ' + ip)))));
    sock.on('data', d => { text += d.toString('utf8'); if (text.includes('END PRELUDE:')) done(); });
    sock.on('error', reject);
  });
}

function parse(text) {
  const blocks = {};
  let name = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) { name = null; continue; }
    if (name === null) { name = line.replace(/:$/, ''); blocks[name] = []; continue; }
    blocks[name].push(line);
  }
  const indexed = (b, asNumber) => {
    const out = [];
    for (const l of blocks[b] || []) {
      const m = l.match(/^(\d+) (.*)$/);
      if (m) out[+m[1]] = asNumber ? +m[2] : m[2];
    }
    return out;
  };
  const info = Object.fromEntries((blocks['VIDEOHUB DEVICE'] || []).map(l => l.split(/: (.*)/).slice(0, 2)));
  return {
    model: info['Model name'], name: info['Friendly name'],
    inL: indexed('INPUT LABELS'), outL: indexed('OUTPUT LABELS'),
    route: indexed('VIDEO OUTPUT ROUTING', true), lock: indexed('VIDEO OUTPUT LOCKS').map(v => v !== 'U'),
  };
}

(async () => {
  let venueCfg = {};
  try { venueCfg = JSON.parse(fs.readFileSync(dataFile('venue.json'), 'utf8')); } catch (e) {}
  const routerIp = args[0] || (venueCfg.core || {}).router, switcherIp = args[1] || (venueCfg.core || {}).switcher;
  if (!routerIp || !switcherIp) { console.error('Usage: node capture.js <router-ip> <switcher-ip>'); process.exit(1); }
  const snap = { taken: new Date().toISOString(), rtr: parse(await read(routerIp)), sw: parse(await read(switcherIp)) };
  // Rooms with their own switcher, and where things are, come from venue.json.
  try {
    const cfg = JSON.parse(fs.readFileSync(dataFile('venue.json'), 'utf8'));
    snap.places = cfg.places || {}; snap.links = cfg.links || []; snap.rooms = [];
    snap.ties = cfg.ties || null; snap.common = cfg.common || null; snap.names = cfg.niceNames || null;
    for (const r of cfg.rooms || []) {
      const p = parse(await read(r.ip));
      snap.rooms.push({ id: r.id, place: r.place, model: p.model, name: p.name, inL: p.inL, outL: p.outL, route: p.route });
      console.log(`${r.place}: ${p.model}`);
    }
  } catch (e) { console.log('Rooms not read: ' + e.message); }
  // Floor plan pin positions, if any have been saved. The plan image itself is not embedded.
  try { snap.floor = { pins: JSON.parse(fs.readFileSync(dataFile('floor.json'), 'utf8')).pins || {}, hasImage: false, v: 0 }; } catch (e) {}
  // Spaces set up by an engineer, if any have been saved.
  try { snap.spaces = JSON.parse(fs.readFileSync(dataFile('spaces.json'), 'utf8')); } catch (e) {}
  try { snap.prefs = JSON.parse(fs.readFileSync(dataFile('prefs.json'), 'utf8')); } catch (e) {}
  // The port register: plates, what is connected and the names ports should carry. Notes stay out of a file that may be passed on.
  try {
    const reg = JSON.parse(fs.readFileSync(dataFile('ports.json'), 'utf8'));
    const bare = m => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, { ...v, notes: '' }]));
    const dev = d => ({ in: bare(d && d.in), out: bare(d && d.out) });
    snap.ports = { plates: reg.plates || {}, rtr: dev(reg.rtr), sw: dev(reg.sw), rooms: Object.fromEntries(Object.entries(reg.rooms || {}).map(([id, d]) => [id, dev(d)])) };
  } catch (e) {}
  try { snap.version = String(require('./package.json').version || ''); } catch (e) {}
  // Mix state (what is on each M/E) needs the ATEM's own protocol; atem-read.js reads it once, read-only.
  try {
    const out = require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'atem-read.js'), switcherIp], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] });
    snap.sw.mix = JSON.parse(out.split(/\r?\n/).filter(l => l.startsWith('{')).pop());
    console.log('Mix state: ' + snap.sw.mix.me.map((m, i) => `ME${i + 1} on ${m.pgm.name}`).join(', '));
  } catch (e) { snap.sw.mix = null; console.log('Mix state not read: ' + e.message.split('\n')[0]); }
  const json = JSON.stringify(snap);
  fs.writeFileSync(dataFile('venue-snapshot.json'), json);
  console.log(`Router: ${snap.rtr.model}, ${snap.rtr.inL.length} in, ${snap.rtr.outL.length} out`);
  console.log(`Switcher: ${snap.sw.model}, ${snap.sw.inL.length} in, ${snap.sw.outL.length} out`);
  const html = fs.readFileSync(path.join(__dirname, 'venue-router.html'), 'utf8');
  const re = /(<script id="snap" type="application\/json">)[\s\S]*?(<\/script>)/;
  if (!re.test(html)) { console.error('No snapshot block found in venue-router.html'); process.exit(1); }
  const outFile = dataFile('venue-snapshot.html');
  fs.writeFileSync(outFile, html.replace(re, (_, a, b) => a + json.replace(/</g, '\\u003c') + b));
  console.log('Wrote ' + outFile);
})().catch(e => { console.error(e.message); process.exit(1); });
