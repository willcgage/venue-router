// Live, watch-only server for Venue Router.
// Holds one connection to the router and two to the ATEM (routing and mix state), and pushes every change to the page.
// It never changes a device. Routers and switchers are only listened to. HyperDeck recorders are asked for their
// status, because they report nothing unless asked. Teranex converters and SmartView monitors are only listened to.
// Magewell NDI converters are asked only for what they answer without signing in: that they are there, and on newer
// units the picture format. The app never signs in to them and stores no password for them.
// No route, record, play or settings command is ever sent.
// Usage: node server.js [router-ip] [switcher-ip] [--data=folder]     (PORT and HOST can be set in the environment)
// The two addresses can be left out. If none are saved yet, the app shows a first-time setup page that asks for them.
// --data says where the saved setup lives. Without it, that is this folder.
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Atem } = require('atem-connection');
const crypto = require('crypto');
const { DATA, args, file: dataFile } = require('./data-dir');

// Where to listen. config.json (written by the install scripts) can set host and port; the environment overrides it.
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(dataFile('config.json'), 'utf8').replace(/^﻿/, '')); } catch (e) {}
const PORT = +(process.env.PORT || cfg.port || 8787);
const HOST = process.env.HOST || cfg.host || '127.0.0.1';
const log = msg => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19) + '  ' + msg);

// Videohub Ethernet Protocol listener. Reads the status dump and every later update block.
function hub(ip, onChange) {
  const st = { model: null, name: null, inL: [], outL: [], route: [], lock: [], up: false };
  let buf = '', closed = false, sock = null;
  Object.defineProperty(st, 'stop', { enumerable: false, value: () => { closed = true; if (sock) sock.destroy(); } });
  function block(lines) {
    const head = lines[0].replace(/:$/, '');
    const each = fn => lines.slice(1).forEach(l => { const m = l.match(/^(\d+) (.*)$/); if (m) fn(+m[1], m[2]); });
    if (head === 'INPUT LABELS') each((i, v) => (st.inL[i] = v));
    else if (head === 'OUTPUT LABELS') each((i, v) => (st.outL[i] = v));
    else if (head === 'VIDEO OUTPUT ROUTING') each((i, v) => (st.route[i] = +v));
    else if (head === 'VIDEO OUTPUT LOCKS') each((i, v) => (st.lock[i] = v !== 'U'));
    else if (head === 'VIDEOHUB DEVICE') lines.slice(1).forEach(l => {
      const m = l.match(/^(.*?): (.*)$/);
      if (m && m[1] === 'Model name') st.model = m[2];
      if (m && m[1] === 'Friendly name') st.name = m[2];
    });
    else return;
    onChange();
  }
  function connect() {
    if (closed) return;
    const s = sock = net.connect({ host: ip, port: 9990 });
    s.setKeepAlive(true, 10000);
    s.on('connect', () => { st.up = true; buf = ''; onChange(); });
    s.on('data', d => {
      buf += d.toString('utf8').replace(/\r/g, '');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const lines = buf.slice(0, i).split('\n').filter(Boolean);
        buf = buf.slice(i + 2);
        if (lines.length) block(lines);
      }
    });
    s.on('error', () => {});
    s.on('close', () => { st.up = false; if (closed) return; onChange(); setTimeout(connect, 3000); });
  }
  connect();
  return st;
}

// HyperDeck recorders, over the HyperDeck Ethernet Protocol (TCP 9993).
// Unlike a router, a HyperDeck says nothing unless asked. This sends status questions and a request to be told
// about changes. It never sends record, play, stop or any other command that changes the recorder.
function deck(ip, onChange) {
  const st = { model: null, name: null, status: null, clip: null, format: null, inFormat: null, slot: null, remainSec: null, remainBytes: null, totalBytes: null, up: false };
  let buf = '', closed = false, sock = null;
  const poll = setInterval(() => { if (sock && st.up) sock.write('slot info\r\ntransport info\r\n'); }, 20000);
  Object.defineProperty(st, 'stop', { enumerable: false, value: () => { closed = true; clearInterval(poll); if (sock) sock.destroy(); } });
  function block(lines) {
    while (lines.length && !/:$/.test(lines[0])) lines.shift();   // one-line replies such as "200 ok"
    const m = /^(\d{3}) /.exec(lines[0] || '');
    if (!m) return;
    const kv = {};
    lines.slice(1).forEach(l => { const i = l.indexOf(': '); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 2).trim(); });
    if (m[1] === '204' || m[1] === '500') { if (kv.model) st.model = kv.model; if (kv.name) st.name = kv.name; }
    else if (m[1] === '208' || m[1] === '508') {
      if (kv.status) st.status = kv.status;
      if ('clip id' in kv) st.clip = kv['clip id'];
      if (kv['video format']) st.format = kv['video format'];
      if (kv['input video format']) st.inFormat = kv['input video format'];
      if (kv['slot name']) st.slot = kv['slot name'];
    } else if (m[1] === '202' || m[1] === '502') {
      if (kv['recording time']) st.remainSec = +kv['recording time'];
      if (kv['remaining size']) st.remainBytes = +kv['remaining size'];
      if (kv['total size']) st.totalBytes = +kv['total size'];
    } else return;
    onChange();
  }
  function connect() {
    if (closed) return;
    const s = sock = net.connect({ host: ip, port: 9993 });
    s.setKeepAlive(true, 10000);
    s.on('connect', () => { st.up = true; buf = ''; s.write('notify: transport: true slot: true\r\ndevice info\r\ntransport info\r\nslot info\r\n'); onChange(); });
    s.on('data', d => {
      buf += d.toString('utf8').replace(/\r/g, '');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const lines = buf.slice(0, i).split('\n').filter(Boolean);
        buf = buf.slice(i + 2);
        if (lines.length) block(lines);
      }
    });
    s.on('error', () => {});
    s.on('close', () => { st.up = false; if (closed) return; onChange(); setTimeout(connect, 3000); });
  }
  connect();
  return st;
}

// Teranex converters, over the Teranex Ethernet Protocol (TCP 9800). Listen only: a Teranex sends its whole state
// on connect and each change after that, so nothing is ever sent to it.
function teranex(ip, onChange) {
  const st = { model: null, name: null, src: null, inMode: null, signal: null, outMode: null, pattern: null, locked: null, up: false };
  let buf = '', closed = false, sock = null;
  Object.defineProperty(st, 'stop', { enumerable: false, value: () => { closed = true; if (sock) sock.destroy(); } });
  function block(lines) {
    const head = lines[0].replace(/:$/, ''), kv = {};
    lines.slice(1).forEach(l => { const i = l.indexOf(': '); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 2).trim(); });
    const nm = kv['Friendly name'] || kv.Label;
    if (nm) st.name = nm;
    if (head === 'TERANEX DEVICE') { if (kv['Model name']) st.model = kv['Model name']; }
    else if (head === 'VIDEO INPUT') {
      if (kv['Video source']) st.src = kv['Video source'];
      if (kv['Video mode']) st.inMode = kv['Video mode'];
      if ('Signal present' in kv) st.signal = kv['Signal present'] === 'true';
    } else if (head === 'VIDEO OUTPUT') { if (kv['Video mode']) st.outMode = kv['Video mode']; }
    else if (head === 'TEST PATTERN') { if ('Output' in kv) st.pattern = kv.Output === 'None' ? null : kv.Output; }
    else if (head === 'GENLOCK') { if ('Signal locked' in kv) st.locked = kv['Signal locked'] === 'true'; }
    else if (!nm) return;
    onChange();
  }
  function connect() {
    if (closed) return;
    const s = sock = net.connect({ host: ip, port: 9800 });
    s.setKeepAlive(true, 10000);
    s.on('connect', () => { st.up = true; buf = ''; onChange(); });
    s.on('data', d => {
      buf += d.toString('utf8').replace(/\r/g, '');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const lines = buf.slice(0, i).split('\n').filter(Boolean);
        buf = buf.slice(i + 2);
        if (lines.length) block(lines);
      }
    });
    s.on('error', () => {});
    s.on('close', () => { st.up = false; if (closed) return; onChange(); setTimeout(connect, 3000); });
  }
  connect();
  return st;
}

// SmartView monitors, over the SmartView Ethernet Protocol (TCP 9992). Listen only: a SmartView sends its state on
// connect and each change after that, so nothing is ever sent to it.
function smartview(ip, onChange) {
  const st = { model: null, name: null, input: null, brightness: null, border: null, lut: null, up: false };
  let buf = '', closed = false, sock = null;
  Object.defineProperty(st, 'stop', { enumerable: false, value: () => { closed = true; if (sock) sock.destroy(); } });
  function block(lines) {
    const head = lines[0].replace(/:$/, ''), kv = {};
    lines.slice(1).forEach(l => { const i = l.indexOf(': '); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 2).trim(); });
    if (head === 'SMARTVIEW DEVICE') { if (kv.Model) st.model = kv.Model; if (kv.Name) st.name = kv.Name; }
    else if (head === 'MONITOR A') {
      if (kv.MonitorInput) st.input = kv.MonitorInput;
      if ('Brightness' in kv) st.brightness = +kv.Brightness;
      if ('Border' in kv) st.border = /^none$/i.test(kv.Border) ? null : kv.Border;
      if ('Lut' in kv) st.lut = /^none$/i.test(kv.Lut) ? null : kv.Lut;
    } else return;
    onChange();
  }
  function connect() {
    if (closed) return;
    const s = sock = net.connect({ host: ip, port: 9992 });
    s.setKeepAlive(true, 10000);
    s.on('connect', () => { st.up = true; buf = ''; onChange(); });
    s.on('data', d => {
      buf += d.toString('utf8').replace(/\r/g, '');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const lines = buf.slice(0, i).split('\n').filter(Boolean);
        buf = buf.slice(i + 2);
        if (lines.length) block(lines);
      }
    });
    s.on('error', () => {});
    s.on('close', () => { st.up = false; if (closed) return; onChange(); setTimeout(connect, 3000); });
  }
  connect();
  return st;
}

let mix = null, mixUp = false;
function readMix(s) {
  const name = id => (s.inputs[id] ? s.inputs[id].longName : 'Source ' + id);
  const src = id => ({ id, name: name(id) });
  return {
    me: s.video.mixEffects.filter(Boolean).map(m => ({
      pgm: src(m.programInput), pvw: src(m.previewInput),
      keys: Object.values(m.upstreamKeyers || {}).filter(Boolean).map(k => ({ n: k.upstreamKeyerId + 1, onAir: !!k.onAir, fill: src(k.fillSource) })),
    })),
    dsk: Object.values(s.video.downstreamKeyers || {}).filter(Boolean).map((k, i) => ({ n: i + 1, onAir: !!k.onAir, fill: k.sources ? src(k.sources.fillSource) : null })),
  };
}

// Streaming and recording state of an ATEM that has those features, such as an ATEM Mini Pro.
// The stream address and stream key are deliberately never read out of the switcher's state.
function readLive(s) {
  const SS = { 1: 'idle', 2: 'connecting', 4: 'streaming', 32: 'stopping' }, RS = { 0: 'idle', 1: 'recording', 128: 'stopping' };
  const st = s.streaming, rc = s.recording;
  return {
    stream: st && st.status ? { state: SS[st.status.state] || 'unknown', error: !!st.status.error, service: st.service ? st.service.serviceName || null : null, bitrate: st.stats ? Math.round((st.stats.encodingBitrate || 0) / 100000) / 10 : 0 } : null,
    rec: rc && rc.status ? { state: RS[rc.status.state] || 'unknown', error: !!rc.status.error, disk: !!(rc.disks && Object.keys(rc.disks).length) } : null,
  };
}

// venue.json says where each device is, which rooms have their own switcher, and how rooms are cabled to the core.
const VENUE_FILE = dataFile('venue.json');
let venue = { places: {}, core: {}, rooms: [], decks: [], convs: [], mons: [], ndis: [], links: [] };
try { venue = { ...venue, ...JSON.parse(fs.readFileSync(VENUE_FILE, 'utf8')) }; } catch (e) { console.log('No venue.json found, so no rooms are shown.'); }
const core = { router: args[0] || (venue.core || {}).router, switcher: args[1] || (venue.core || {}).switcher };
// Nothing saved yet: show the first-time setup page instead of the app. Once it has saved the two addresses it
// starts the app again in a fresh process and this one only waits for it.
if (!core.router || !core.switcher) { firstTimeSetup(); return; }
function saveVenue() {
  fs.writeFileSync(VENUE_FILE, JSON.stringify({ ...venue, core }, null, 2) + '\n');
}
// Addresses given on the command line are remembered, so later starts (and the install scripts) need none.
if (args[0] && args[1]) saveVenue();
// Reads a SmartView monitor's greeting on its own port. Sends nothing.
function probeMon(ip, ms) {
  return new Promise(resolve => {
    let text = '', done = false;
    const s = net.connect({ host: ip, port: 9992 });
    const finish = () => {
      if (done) return; done = true; s.destroy();
      const m = text.match(/^Model: (.*)$/m), n = text.match(/^Name: (.*)$/m);
      resolve({ ip, model: /SMARTVIEW DEVICE/.test(text) && m ? m[1].trim() : null, name: n ? n[1].trim() : null });
    };
    s.setTimeout(ms, finish);
    s.on('data', d => { text += d.toString('utf8'); if (/Name: .*\r?\n/.test(text)) finish(); });
    s.on('error', finish); s.on('close', finish);
  });
}
// Reads a HyperDeck's greeting on its own port. Sends nothing.
function probeDeck(ip, ms) {
  return new Promise(resolve => {
    let text = '', done = false;
    const s = net.connect({ host: ip, port: 9993 });
    const finish = () => { if (done) return; done = true; s.destroy(); const m = text.match(/^model: (.*)$/m); resolve({ ip, model: m ? m[1].trim() : null }); };
    s.setTimeout(ms, finish);
    s.on('data', d => { text += d.toString('utf8'); if (/model: .*\r?\n/.test(text)) finish(); });
    s.on('error', finish); s.on('close', finish);
  });
}
const isDeck = d => !!d.model && /hyperdeck/i.test(d.model);
// Reads a Teranex converter's greeting on its own port. Sends nothing.
function probeConv(ip, ms) {
  return new Promise(resolve => {
    let text = '', done = false;
    const s = net.connect({ host: ip, port: 9800 });
    const finish = () => { if (done) return; done = true; s.destroy(); const m = text.match(/^Model name: (.*)$/m); resolve({ ip, model: /TERANEX DEVICE/.test(text) && m ? m[1].trim() : null }); };
    s.setTimeout(ms, finish);
    s.on('data', d => { text += d.toString('utf8'); if (/Model name: .*\r?\n/.test(text)) finish(); });
    s.on('error', finish); s.on('close', finish);
  });
}

// Magewell Pro Convert (an NDI encoder or decoder). Everything here is a plain web request that needs no sign-in.
function mwGet(ip, pathName, ms, raw) {
  return new Promise(resolve => {
    const q = http.get({ host: ip, port: 80, path: pathName, timeout: ms }, res => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', d => { if (b.length < 20000) b += d; });
      res.on('end', () => { if (raw) return resolve({ server: String(res.headers.server || ''), body: b }); try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
    });
    q.on('error', () => resolve(null)); q.on('timeout', () => { q.destroy(); resolve(null); });
  });
}
// Is there a Magewell at this address? Asks its "ping", then reads its front page to be sure of the make.
async function probeNdi(ip, ms) {
  const ping = await mwGet(ip, '/mwapi?method=ping', ms);
  if (!ping || ping.status !== 0) return { ip, model: null };
  const page = await mwGet(ip, '/', ms, true);
  const yes = page && (/magewell/i.test(page.server) || /pro convert|magewell/i.test(page.body));
  return { ip, model: yes ? 'Magewell Pro Convert' : null };
}
// Watches one unit: asks every ten seconds whether it is there and what picture it reports.
function magewell(ip, onChange) {
  const st = { model: 'Magewell Pro Convert', signal: null, up: false };
  let closed = false, timer = null, last = '', misses = 0;
  Object.defineProperty(st, 'stop', { enumerable: false, value: () => { closed = true; clearTimeout(timer); } });
  async function poll() {
    if (closed) return;
    const ping = await mwGet(ip, '/mwapi?method=ping', 4000);
    const ok = !!ping && ping.status === 0;
    misses = ok ? 0 : misses + 1;
    let signal = st.signal;
    if (ok) {
      const s = await mwGet(ip, '/mwapi?method=get-signal-info', 4000), v = s && s['video-info'];
      signal = v && +v.width ? { w: +v.width, h: +v.height, scan: v.scan === 'interlaced' ? 'i' : 'p', rate: +v['field-rate'] || 0 } : null;
    }
    if (closed) return;
    // One missed answer is not treated as the unit going away
    st.up = ok || (st.up && misses < 2);
    st.signal = st.up ? signal : null;
    const now = JSON.stringify([st.up, st.signal]);
    if (now !== last) { last = now; onChange(); }
    timer = setTimeout(poll, 10000);
  }
  poll();
  return st;
}

// Finding devices. A probe connects to the Videohub port, reads the greeting and disconnects. It sends nothing.
function isPrivate(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip || '');
  if (!m) return false;
  const a = m.slice(1).map(Number);
  if (a.some(x => x > 255)) return false;
  return a[0] === 10 || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && a[1] === 168);
}
function probe(ip, ms) {
  return new Promise(resolve => {
    let text = '', done = false;
    const s = net.connect({ host: ip, port: 9990 });
    const finish = () => {
      if (done) return; done = true; s.destroy();
      const get = k => { const m = text.match(new RegExp('^' + k + ': (.*)$', 'm')); return m ? m[1].trim() : null; };
      resolve({ ip, answered: text.includes('PROTOCOL PREAMBLE'), present: get('Device present') === 'true', model: get('Model name'), name: get('Friendly name'), inputs: +get('Video inputs') || 0, outputs: +get('Video outputs') || 0 });
    };
    s.setTimeout(ms, finish);
    s.on('data', d => { text += d.toString('utf8'); if (text.includes('END PRELUDE:') || /Video outputs: \d+/.test(text)) finish(); });
    s.on('error', finish); s.on('close', finish);
  });
}
let scanning = false;

// First-time setup. Runs instead of the app while no main router and switcher are saved. It can only be used from
// the computer the app runs on, and it only reads each device's greeting to check the address. It sends nothing.
function firstTimeSetup() {
  const local = req => { const a = req.socket.remoteAddress || ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; };
  const page = body => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Venue Router setup</title>'
    + '<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:0 auto;padding:2rem 1rem;line-height:1.5;color:#1a1d21;background:#f6f7f9}'
    + '@media(prefers-color-scheme:dark){body{color:#e8eaed;background:#16181c}input{background:#22252b;color:inherit;border-color:#444}}'
    + 'h1{font-size:1.3rem}label{display:block;font-weight:600;margin-top:1rem}input{display:block;width:100%;box-sizing:border-box;font:inherit;padding:.5rem;margin-top:.25rem;border:1px solid #9aa0a6;border-radius:6px}'
    + 'small{display:block;opacity:.75}button{font:inherit;font-weight:600;padding:.55rem 1rem;margin:1.25rem .5rem 0 0;border-radius:6px;border:1px solid #2456c8;background:#2456c8;color:#fff;cursor:pointer}'
    + 'button.alt{background:transparent;color:inherit;border-color:#9aa0a6}#msg{margin-top:1rem;font-weight:600}</style></head><body>' + body + '</body></html>';
  const form = '<h1>Set up Venue Router</h1><p>Venue Router watches your video router and switcher. It never changes them. Enter the network address of each to start.</p>'
    + '<form id="f"><label for="r">Main video router<small>The Blackmagic Videohub. For example 10.0.0.12</small><input id="r" inputmode="decimal" autocomplete="off" required></label>'
    + '<label for="s">Main switcher<small>The ATEM. For example 10.0.0.11</small><input id="s" inputmode="decimal" autocomplete="off" required></label>'
    + '<button type="submit">Check and save</button><button type="button" class="alt" id="force" hidden>Save without checking</button></form><p id="msg" role="status"></p>'
    + '<script>var $=function(i){return document.getElementById(i)};function send(force){$("msg").textContent="Checking the two addresses...";'
    + 'fetch("/setup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({router:$("r").value.trim(),switcher:$("s").value.trim(),force:!!force})})'
    + '.then(function(x){return x.json()}).then(function(j){$("msg").textContent=j.message;$("force").hidden=!j.canForce;if(j.ok)setTimeout(function(){location.reload()},4000)})'
    + '.catch(function(){$("msg").textContent="Could not reach the app. Try again."})}'
    + '$("f").addEventListener("submit",function(e){e.preventDefault();send(false)});$("force").addEventListener("click",function(){send(true)})</script>';
  const away = '<h1>Venue Router is not set up yet</h1><p>Open it on the computer it is installed on to finish setting it up. This page will work once that is done.</p>';
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  let saved = false;
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'POST' && url === '/setup') {
      if (!local(req)) return json(res, 403, { ok: false, message: 'Setup can only be done on the computer the app is installed on.' });
      if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') return json(res, 415, { ok: false, message: 'Bad request.' });
      if (saved) return json(res, 200, { ok: true, message: 'Saved. Starting Venue Router...' });
      let raw = '';
      req.on('data', d => { raw += d; if (raw.length > 2000) req.destroy(); });
      req.on('end', async () => {
        let b = {};
        try { b = JSON.parse(raw); } catch (e) {}
        let r = String(b.router || ''), s = String(b.switcher || '');
        if (!isPrivate(r) || !isPrivate(s)) return json(res, 400, { ok: false, message: 'Enter two addresses on your own network, such as 10.0.0.12 or 192.168.1.20.' });
        if (r === s) return json(res, 400, { ok: false, message: 'The router and the switcher need different addresses.' });
        let note = '';
        if (!b.force) {
          const [pr, ps] = await Promise.all([probe(r, 2500), probe(s, 2500)]);
          const isAtem = p => /atem/i.test(p.model || '');
          if (pr.answered && ps.answered && isAtem(pr) && !isAtem(ps)) { [r, s] = [s, r]; note = ' The two were the other way round, so they were swapped: the router is ' + r + ' and the switcher is ' + s + '.'; }
          else if (!pr.answered || !ps.answered) {
            const dead = [!pr.answered ? r : null, !ps.answered ? s : null].filter(Boolean).join(' and ');
            return json(res, 200, { ok: false, canForce: true, message: 'Nothing answered at ' + dead + '. Check the address and that the device is on. If it is only switched off for now, you can save without checking.' });
          }
        }
        if (saved) return json(res, 200, { ok: true, message: 'Saved. Starting Venue Router...' });
        try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(VENUE_FILE, JSON.stringify({ ...venue, core: { router: r, switcher: s } }, null, 2) + '\n'); }
        catch (e) { return json(res, 500, { ok: false, message: 'Could not save the setup in ' + DATA + ': ' + e.message }); }
        saved = true;
        log('First-time setup saved: router ' + r + ', switcher ' + s + '. Starting the app.');
        json(res, 200, { ok: true, message: 'Saved.' + note + ' Starting Venue Router...' });
        srv.close(() => {
          const child = require('child_process').spawn(process.execPath, process.argv.slice(1), { stdio: 'inherit' });
          child.on('exit', code => process.exit(code == null ? 1 : code));
          const stop = () => { child.kill(); };
          process.on('SIGTERM', stop); process.on('SIGINT', stop);
        });
        if (srv.closeAllConnections) setTimeout(() => srv.closeAllConnections(), 500);
      });
      return;
    }
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(page(local(req) ? form : away));
      return;
    }
    res.writeHead(404); res.end('Not set up yet');
  });
  srv.listen(PORT, HOST, () => {
    log('Venue Router is not set up yet. Open http://localhost:' + PORT + ' on this computer and enter the router and switcher addresses.');
  });
}
function knownIps() { return [core.router, core.switcher].concat(rooms.map(r => r.ip), decks.map(d => d.ip), convs.map(c => c.ip), mons.map(m => m.ip), ndis.map(n => n.ip)); }

// Floor plan: pin positions live in floor.json, the plan image in floor-image.bin. Both are local files only.
const FLOOR_FILE = dataFile('floor.json');
const FLOOR_IMG = dataFile('floor-image.bin');
const IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
let floor = { pins: {}, imageType: null, v: 0 };
try { floor = { ...floor, ...JSON.parse(fs.readFileSync(FLOOR_FILE, 'utf8')) }; } catch (e) {}
function saveFloor() { fs.writeFileSync(FLOOR_FILE, JSON.stringify(floor)); push(); }
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Spaces: the room names, their screens and presets, set up by an engineer and shared with every viewer.
const SPACES_FILE = dataFile('spaces.json');
let spaces = null;
try { spaces = JSON.parse(fs.readFileSync(SPACES_FILE, 'utf8')); } catch (e) {}
function cleanSpaces(raw) {
  if (!Array.isArray(raw) || raw.length > 50) throw new Error('bad list');
  const seen = new Set(), int = v => Number.isInteger(v) && v >= 0 && v < 1000;
  return raw.map(s => {
    if (!s || typeof s.id !== 'string' || !/^[\w-]{1,40}$/.test(s.id) || seen.has(s.id)) throw new Error('bad id');
    seen.add(s.id);
    const name = String(s.name || '').trim().slice(0, 60);
    if (!name) throw new Error('bad name');
    const dests = (Array.isArray(s.dests) ? s.dests : []).filter(int).slice(0, 200);
    const modes = (Array.isArray(s.modes) ? s.modes : []).slice(0, 30).map(m => ({
      name: String(m.name || '').trim().slice(0, 60) || 'Preset',
      set: (Array.isArray(m.set) ? m.set : []).filter(e => Array.isArray(e) && (e[0] === 'rtr' || e[0] === 'sw') && int(e[1]) && int(e[2])).slice(0, 400).map(e => [e[0], e[1], e[2]]),
    }));
    return { id: s.id, name, dests, confirm: !!s.confirm, hidden: !!s.hidden, modes };
  });
}

// What volunteers are allowed to see beyond the spaces themselves.
const PREFS_FILE = dataFile('prefs.json');
let prefs = { hideRooms: [], hideFloor: false, hideGear: false };
try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')) }; } catch (e) {}

// Engineer PIN. Only a salted hash is kept, in auth.json. Without a PIN, Engineer view is open to anyone.
const AUTH_FILE = dataFile('auth.json');
const SESSION_MS = 12 * 60 * 60 * 1000;
let authCfg = null;
try { authCfg = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch (e) {}
const sessions = new Map();
let pinFails = 0, pinLockedUntil = 0;
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
function pinMatches(pin) {
  if (!authCfg) return false;
  const a = Buffer.from(hashPin(pin, authCfg.salt), 'hex'), b = Buffer.from(authCfg.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sessionOf(req) {
  const m = /(?:^|;\s*)vr_eng=([a-f0-9]{48})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const exp = sessions.get(m[1]);
  if (!exp || exp < Date.now()) { sessions.delete(m[1]); return null; }
  return m[1];
}
// Until a PIN is set, Engineer view only works from the computer running the server. That makes it safe to open the
// app to a network before choosing a PIN: other devices can watch, and only this computer can change the setup.
// (Behind a reverse proxy every request looks local, so set a PIN before putting one in front.)
const isLocal = req => { const a = req.socket.remoteAddress || ''; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; };
function isEngineer(req) { return authCfg ? !!sessionOf(req) : isLocal(req); }
function startSession(res) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  res.setHeader('Set-Cookie', `vr_eng=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
}
const clearCookie = res => res.setHeader('Set-Cookie', 'vr_eng=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
const GUARDED = ['/normal', '/spaces', '/prefs', '/devices', '/floor-image', '/floor-pins'];

const clients = new Map();
let lastBody = '', lastJson = null, lastPublic = null, timer = null;
// Normal service is a saved copy of the routes, kept in a local file. Saving it never touches the hardware.
const NORMAL_FILE = dataFile('normal-service.json');
let normal = null;
try { normal = JSON.parse(fs.readFileSync(NORMAL_FILE, 'utf8')); } catch (e) {}
const upSeen = {};
function changed() { clearTimeout(timer); timer = setTimeout(push, 80); }
function push() {
  if (!rtr.route.length || !sw.route.length) return;
  rooms.forEach(ensureLive);
  const ups = { 'The main router': rtr.up, 'The main switcher': sw.up && mixUp };
  rooms.forEach(r => { ups['The ' + r.place + ' switcher' + (rooms.filter(x => x.place === r.place).length > 1 ? ' at ' + r.ip : '')] = r.st.up; });
  decks.forEach(d => { ups['Recorder ' + (d.st.name || d.id)] = d.st.up; });
  convs.forEach(c => { ups['Converter ' + (c.st.name || c.id)] = c.st.up; });
  mons.forEach(m => { ups['Monitor ' + (m.st.name || m.id)] = m.st.up; });
  ndis.forEach(n => { ups['NDI converter ' + (n.name || n.id)] = n.st.up; });
  for (const k of Object.keys(ups)) { if (upSeen[k] !== undefined && upSeen[k] !== ups[k]) log(k + (ups[k] ? ' is answering again.' : ' stopped answering.')); upSeen[k] = ups[k]; }
  const strip = ({ up, ...rest }) => rest;
  const data = { rtr: strip(rtr), sw: { ...strip(sw), mix }, conn: { rtr: rtr.up, sw: sw.up, mix: mixUp }, normal, pin: !!authCfg,
    places: venue.places, links: venue.links, addr: { rtr: core.router, sw: core.switcher },
    ties: venue.ties || null, common: venue.common || null, names: venue.niceNames || null,
    floor: { pins: floor.pins, hasImage: !!floor.imageType, v: floor.v },
    spaces, prefs,
    decks: decks.map(d => ({ id: d.id, place: d.place, ip: d.ip, feed: d.feed, returns: d.returns, ...d.st, up: d.st.up })),
    convs: convs.map(c => ({ id: c.id, place: c.place, ip: c.ip, feeds: c.feeds, returns: c.returns, ...c.st, up: c.st.up })),
    mons: mons.map(m => ({ id: m.id, place: m.place, ip: m.ip, feeds: m.feeds, ...m.st, up: m.st.up })),
    ndis: ndis.map(n => ({ id: n.id, place: n.place, name: n.name, ip: n.ip, ...n.st, up: n.st.up })),
    rooms: rooms.filter(r => r.st.route.length).map(r => ({ id: r.id, place: r.place, ip: r.ip, model: r.st.model, name: r.st.name, inL: r.st.inL, outL: r.st.outL, route: r.st.route, up: r.st.up, live: r.live || null })) };
  const body = JSON.stringify(data);
  if (body === lastBody) return;
  lastBody = body;
  // Device addresses only go to engineers. Everyone else gets the same state without them.
  const taken = '{"taken":"' + new Date().toISOString() + '",';
  lastJson = taken + body.slice(1);
  lastPublic = taken + JSON.stringify({ ...data, addr: {}, rooms: data.rooms.map(({ ip, ...r }) => r), decks: data.decks.map(({ ip, ...d }) => d), convs: data.convs.map(({ ip, ...c }) => c), mons: data.mons.map(({ ip, ...m }) => m), ndis: data.ndis.map(({ ip, ...n }) => n) }).slice(1);
  for (const [res, eng] of clients) res.write('data: ' + (eng ? lastJson : lastPublic) + '\n\n');
}

let rtr = hub(core.router, changed);
let sw = hub(core.switcher, changed);
let rooms = venue.rooms.map(r => ({ id: r.id, place: r.place, ip: r.ip, st: hub(r.ip, changed) }));
let decks = (venue.decks || []).map(d => ({ id: d.id, place: d.place, ip: d.ip, feed: d.feed, returns: d.returns || [], st: deck(d.ip, changed) }));
const saveDecks = () => { venue.decks = decks.map(d => ({ id: d.id, place: d.place, ip: d.ip, feed: d.feed, returns: d.returns })); };
let convs = (venue.convs || []).map(c => ({ id: c.id, place: c.place, ip: c.ip, feeds: c.feeds || [], returns: c.returns || [], st: teranex(c.ip, changed) }));
const saveConvs = () => { venue.convs = convs.map(c => ({ id: c.id, place: c.place, ip: c.ip, feeds: c.feeds, returns: c.returns })); };
let mons = (venue.mons || []).map(m => ({ id: m.id, place: m.place, ip: m.ip, feeds: m.feeds || [], st: smartview(m.ip, changed) }));
const saveMons = () => { venue.mons = mons.map(m => ({ id: m.id, place: m.place, ip: m.ip, feeds: m.feeds })); };
let ndis = (venue.ndis || []).map(n => ({ id: n.id, place: n.place, name: n.name || '', ip: n.ip, st: magewell(n.ip, changed) }));
const saveNdis = () => { venue.ndis = ndis.map(n => ({ id: n.id, place: n.place, name: n.name, ip: n.ip })); };
// Works out which router output feeds a monitor from its name: a monitor named MON-12 matches a label such as "MON 12".
function guessMonFeeds(name) {
  const num = (String(name || '').match(/(\d{3,})/) || [])[1];
  if (!num) return [];
  const re = new RegExp('MON\\W*' + num + '(\\D|$)', 'i'), out = [];
  rtr.outL.forEach((l, i) => { if (re.test(l || '') && !/SCOPE/i.test(l)) out.push(i); });
  return out;
}
// Works out a converter's cabling from router labels such as TRNX-IN-1A and TRNX-OUT-1A. Inputs are kept in label order.
function guessConvLinks(n) {
  const pick = (labels, word) => labels.map((l, i) => [l || '', i]).filter(x => new RegExp('TRNX-?' + word + '-?0?' + n + '[A-Z]?$', 'i').test(x[0])).sort((a, b) => a[0].localeCompare(b[0])).map(x => x[1]);
  return { feeds: pick(rtr.outL, 'IN'), returns: pick(rtr.inL, 'OUT') };
}
// Works out a recorder's cabling from the router's own labels, such as REC-IN-01 and REC-OUT-01-1.
function guessDeckLinks(n) {
  const num = '0?' + n, feed = rtr.outL.findIndex(l => new RegExp('REC-?IN-?' + num + '(\\D|$)', 'i').test(l || ''));
  const returns = [];
  rtr.inL.forEach((l, i) => { if (new RegExp('REC-?OUT-?' + num + '(\\D|$)', 'i').test(l || '')) returns.push(i); });
  return { feed: feed >= 0 ? feed : null, returns };
}
const atem = new Atem();
atem.on('error', () => {});
atem.on('connected', () => { mixUp = true; mix = readMix(atem.state); changed(); });
atem.on('disconnected', () => { mixUp = false; changed(); });
atem.on('stateChanged', state => { mix = readMix(state); changed(); });
atem.connect(core.switcher);

// A room switcher that is an ATEM gets a second, ATEM-protocol connection for its streaming and recording state.
// Like the main switcher's, it only listens to the state the switcher sends.
function ensureLive(r) {
  if (r.atem || !/atem/i.test(r.st.model || '')) return;
  const a = r.atem = new Atem();
  const update = s => { const next = readLive(s); if (JSON.stringify(next) !== JSON.stringify(r.live || null)) { r.live = next; changed(); } };
  a.on('error', () => {});
  a.on('connected', () => update(a.state));
  a.on('stateChanged', s => update(s));
  a.on('disconnected', () => { if (r.live) { r.live = null; changed(); } });
  a.connect(r.ip);
}

// Changing the device list. Each change is saved to venue.json and takes effect at once.
async function deviceChange(body) {
  const place = String(body.place || '').trim().slice(0, 60);
  // NDI converters: their place, the name you give them (they report none without signing in), and removing them
  const nd = ndis.find(x => x.id === body.id);
  if (nd && (body.action === 'place' || body.action === 'ndi-name' || body.action === 'remove')) {
    if (body.action === 'place') { if (!place) throw new Error('Enter where the device is.'); nd.place = place; }
    else if (body.action === 'ndi-name') nd.name = String(body.name || '').trim().slice(0, 60);
    else { nd.st.stop(); ndis = ndis.filter(x => x !== nd); }
    saveNdis(); saveVenue(); lastBody = ''; changed();
    return;
  }
  if (body.action === 'place') {
    if (!place) throw new Error('Enter where the device is.');
    const dk = decks.find(x => x.id === body.id);
    if (body.id === 'rtr' || body.id === 'sw') venue.places[body.id] = place;
    else if (dk) { dk.place = place; saveDecks(); }
    else if (convs.some(x => x.id === body.id)) { convs.find(x => x.id === body.id).place = place; saveConvs(); }
    else if (mons.some(x => x.id === body.id)) { mons.find(x => x.id === body.id).place = place; saveMons(); }
    else { const r = rooms.find(x => x.id === body.id); if (!r) throw new Error('That device is no longer in the list.'); r.place = place; venue.rooms.find(x => x.id === r.id).place = place; }
  } else if (body.action === 'deck-feed' || body.action === 'deck-ret-add' || body.action === 'deck-ret-rm') {
    const dk = decks.find(x => x.id === body.id);
    if (!dk) throw new Error('That recorder is no longer in the list.');
    const port = body.port === null || body.port === '' ? null : +body.port;
    if (port !== null && !(Number.isInteger(port) && port >= 0 && port < 1000)) throw new Error('Choose a router port.');
    if (body.action === 'deck-feed') dk.feed = port;
    else if (port === null) throw new Error('Choose a router port.');
    else if (body.action === 'deck-ret-add') { if (!dk.returns.includes(port)) dk.returns.push(port); }
    else dk.returns = dk.returns.filter(x => x !== port);
    saveDecks();
  } else if (body.action === 'mon-link') {
    const mn = mons.find(x => x.id === body.id), port = +body.port;
    if (!mn) throw new Error('That monitor is no longer in the list.');
    if (!(Number.isInteger(port) && port >= 0 && port < 1000)) throw new Error('Choose a router port.');
    if (body.op === 'rm') mn.feeds = mn.feeds.filter(x => x !== port);
    else if (!mn.feeds.includes(port)) mn.feeds.push(port);
    saveMons();
  } else if (body.action === 'remove' && mons.some(x => x.id === body.id)) {
    const mn = mons.find(x => x.id === body.id);
    mn.st.stop();
    mons = mons.filter(x => x !== mn);
    saveMons();
  } else if (body.action === 'conv-link') {
    const cv = convs.find(x => x.id === body.id), list = body.list === 'feeds' ? 'feeds' : 'returns', port = +body.port;
    if (!cv) throw new Error('That converter is no longer in the list.');
    if (!(Number.isInteger(port) && port >= 0 && port < 1000)) throw new Error('Choose a router port.');
    if (body.op === 'rm') cv[list] = cv[list].filter(x => x !== port);
    else if (!cv[list].includes(port)) cv[list].push(port);
    saveConvs();
  } else if (body.action === 'remove' && convs.some(x => x.id === body.id)) {
    const cv = convs.find(x => x.id === body.id);
    cv.st.stop();
    convs = convs.filter(x => x !== cv);
    saveConvs();
  } else if (body.action === 'remove' && decks.some(x => x.id === body.id)) {
    const dk = decks.find(x => x.id === body.id);
    dk.st.stop();
    decks = decks.filter(x => x !== dk);
    saveDecks();
  } else if (body.action === 'room-link') {
    // Which router output feeds a room's switcher, and which of its inputs that lands on
    const r = rooms.find(x => x.id === body.id);
    if (!r) throw new Error('That device is no longer in the list.');
    const port = v => (v === null || v === '' || v === undefined ? null : +v);
    const out = port(body.rtrOut), inp = port(body.input);
    if (out !== null && !(Number.isInteger(out) && out >= 0 && out < 1000)) throw new Error('Choose a router output.');
    if (inp !== null && !(Number.isInteger(inp) && inp >= 0 && inp < 1000)) throw new Error('Choose a switcher input.');
    const at = venue.links.findIndex(l => l.room === r.id);
    if (out === null) { if (at >= 0) venue.links.splice(at, 1); }
    else if (at >= 0) venue.links[at] = { room: r.id, rtrOut: out, input: inp };
    else venue.links.push({ room: r.id, rtrOut: out, input: inp });
  } else if (body.action === 'remove') {
    const r = rooms.find(x => x.id === body.id);
    if (!r) throw new Error('That device is no longer in the list.');
    r.st.stop();
    if (r.atem) r.atem.disconnect().catch(() => {});
    rooms = rooms.filter(x => x !== r);
    venue.rooms = venue.rooms.filter(x => x.id !== r.id);
    venue.links = venue.links.filter(l => l.room !== r.id);
    prefs.hideRooms = prefs.hideRooms.filter(x => x !== r.id);
  } else if (body.action === 'add') {
    const ip = String(body.ip || '').trim();
    if (!isPrivate(ip)) throw new Error('Enter an address on your own network, such as 10.0.0.20.');
    if (knownIps().includes(ip)) throw new Error('That device is already in the list.');
    if (body.role === 'ndi') {
      const m = await probeNdi(ip, 3000);
      if (!m.model) throw new Error('No Magewell converter answered at that address.');
      let n = 1; while (ndis.some(x => x.id === 'ndi-' + n)) n++;
      ndis.push({ id: 'ndi-' + n, place: place || '', name: String(body.name || '').trim().slice(0, 60), ip, st: magewell(ip, changed) });
      saveNdis(); saveVenue(); lastBody = ''; changed();
      return;
    }
    if (body.role === 'mon') {
      const m = await probeMon(ip, 2500);
      if (!m.model) throw new Error('No SmartView monitor answered at that address.');
      let n = 1; while (mons.some(x => x.id === 'mon-' + n)) n++;
      mons.push({ id: 'mon-' + n, place: place || '', ip, feeds: guessMonFeeds(m.name), st: smartview(ip, changed) });
      saveMons(); saveVenue(); lastBody = ''; changed();
      return;
    }
    if (body.role === 'conv') {
      const c = await probeConv(ip, 2500);
      if (!c.model) throw new Error('No Teranex converter answered at that address.');
      let n = 1; while (convs.some(x => x.id === 'conv-' + n)) n++;
      const links = guessConvLinks(n);
      convs.push({ id: 'conv-' + n, place: place || venue.places.rtr || '', ip, feeds: links.feeds, returns: links.returns, st: teranex(ip, changed) });
      saveConvs(); saveVenue(); lastBody = ''; changed();
      return;
    }
    if (body.role === 'deck') {
      const d = await probeDeck(ip, 2500);
      if (!isDeck(d)) throw new Error(d.model ? 'That address answered as ' + d.model + ', which is not a HyperDeck recorder.' : 'No recorder answered at that address.');
      let n = 1; while (decks.some(x => x.id === 'rec-' + n)) n++;
      const links = guessDeckLinks(n);
      decks.push({ id: 'rec-' + n, place: place || venue.places.rtr || '', ip, feed: links.feed, returns: links.returns, st: deck(ip, changed) });
      saveDecks(); saveVenue(); lastBody = ''; changed();
      return;
    }
    const found = await probe(ip, 2500);
    if (!found.present) throw new Error(found.answered ? 'Something answered at that address, but it is not a router or switcher.' : 'Nothing answered at that address.');
    if (body.role === 'router') { rtr.stop(); core.router = ip; rtr = hub(ip, changed); if (place) venue.places.rtr = place; }
    else if (body.role === 'switcher') {
      sw.stop(); core.switcher = ip; sw = hub(ip, changed); mix = null; mixUp = false; if (place) venue.places.sw = place;
      atem.disconnect().catch(() => {}).then(() => atem.connect(ip));
    } else {
      if (!place) throw new Error('Enter where the device is.');
      const base = 'room-' + (place.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'device');
      let id = base, n = 2;
      while (rooms.some(x => x.id === id)) id = base + '-' + n++;
      venue.rooms.push({ id, place, ip });
      rooms.push({ id, place, ip, st: hub(ip, changed) });
    }
  } else throw new Error('Unknown request.');
  saveVenue();
  lastBody = '';
  changed();
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (((req.method === 'POST' && GUARDED.includes(url)) || url === '/scan') && !isEngineer(req)) { res.writeHead(401); res.end('Engineer view is locked.'); return; }
  if (url === '/events') {
    const eng = isEngineer(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    if (lastJson) res.write('data: ' + (eng ? lastJson : lastPublic) + '\n\n');
    clients.set(res, eng);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url === '/auth' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ pinSet: !!authCfg, ok: !!authCfg && !!sessionOf(req), open: !authCfg && isLocal(req) }));
    return;
  }
  if (url === '/auth/login' && req.method === 'POST') {
    readBody(req, 1024).then(buf => {
      const wait = Math.ceil((pinLockedUntil - Date.now()) / 1000);
      if (wait > 0) { res.writeHead(429); res.end(`Too many wrong tries. Wait ${wait} seconds and try again.`); return; }
      const pin = (JSON.parse(buf.toString('utf8')) || {}).pin;
      if (pinMatches(pin)) { pinFails = 0; startSession(res); res.writeHead(204); res.end(); return; }
      if (++pinFails >= 5) { pinFails = 0; pinLockedUntil = Date.now() + 30000; log('Five wrong PIN tries in a row. PIN entry is paused for 30 seconds.'); }
      res.writeHead(403); res.end('That PIN is not right.');
    }).catch(() => { res.writeHead(400); res.end('Bad request'); });
    return;
  }
  if (url === '/auth/logout' && req.method === 'POST') {
    const t = sessionOf(req); if (t) sessions.delete(t);
    clearCookie(res); res.writeHead(204); res.end();
    return;
  }
  if (url === '/auth/pin' && req.method === 'POST') {
    if (!isEngineer(req)) { res.writeHead(401); res.end('Engineer view is locked.'); return; }
    readBody(req, 1024).then(buf => {
      const pin = String((JSON.parse(buf.toString('utf8')) || {}).pin || '');
      if (pin && !/^\d{4,8}$/.test(pin)) { res.writeHead(422); res.end('Use 4 to 8 digits.'); return; }
      sessions.clear();
      log(pin ? 'The Engineer PIN was set or changed.' : 'The Engineer PIN was removed.');
      if (!pin) { authCfg = null; try { fs.unlinkSync(AUTH_FILE); } catch (e) {} clearCookie(res); }
      else {
        const salt = crypto.randomBytes(16).toString('hex');
        authCfg = { salt, hash: hashPin(pin, salt) };
        fs.writeFileSync(AUTH_FILE, JSON.stringify(authCfg));
        startSession(res);
      }
      // Every open page drops back to the public feed; the one that set the PIN reconnects with its new session.
      for (const res2 of clients.keys()) clients.set(res2, false);
      res.writeHead(204); res.end();
      lastBody = ''; push();
    }).catch(() => { res.writeHead(400); res.end('Bad request'); });
    return;
  }
  if (url === '/normal' && req.method === 'POST') {
    if (!rtr.up || !sw.up || !rtr.route.length || !sw.route.length) { res.writeHead(503); res.end('Devices not connected'); return; }
    normal = { RR: rtr.route.slice(), SR: sw.route.slice(), saved: new Date().toISOString() };
    fs.writeFileSync(NORMAL_FILE, JSON.stringify(normal));
    res.writeHead(204); res.end();
    push();
    return;
  }
  if (url === '/scan' && req.method === 'GET') {
    const asked = (new URL(req.url, 'http://x').searchParams.get('subnet') || '').trim().replace(/\.$/, '');
    const prefixes = asked ? [asked] : [...new Set(knownIps().map(ip => ip.split('.').slice(0, 3).join('.')))].slice(0, 3);
    if (!prefixes.length || prefixes.some(p => !isPrivate(p + '.1'))) { res.writeHead(400); res.end('Enter the first three numbers of a network of your own, such as 10.0.0'); return; }
    if (scanning) { res.writeHead(429); res.end('A search is already running. Wait for it to finish.'); return; }
    scanning = true;
    const jobs = [];
    const deckJobs = [], convJobs = [], monJobs = [], ndiJobs = [];
    prefixes.forEach(p => { for (let i = 1; i < 255; i++) { jobs.push(probe(p + '.' + i, 1800)); deckJobs.push(probeDeck(p + '.' + i, 1800)); convJobs.push(probeConv(p + '.' + i, 1800)); monJobs.push(probeMon(p + '.' + i, 1800)); ndiJobs.push(probeNdi(p + '.' + i, 2500)); } });
    Promise.all([Promise.all(jobs), Promise.all(deckJobs), Promise.all(convJobs), Promise.all(monJobs), Promise.all(ndiJobs)]).then(([all, dks, cvs, mns, nds]) => {
      scanning = false;
      const known = knownIps();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        searched: prefixes,
        found: all.filter(d => d.present).map(d => ({ ip: d.ip, model: d.model, name: d.name, inputs: d.inputs, outputs: d.outputs, known: known.includes(d.ip) }))
          .concat(dks.filter(isDeck).map(d => ({ ip: d.ip, model: d.model, kind: 'deck', known: known.includes(d.ip) })))
          .concat(cvs.filter(c => c.model).map(c => ({ ip: c.ip, model: c.model, kind: 'conv', known: known.includes(c.ip) })))
          .concat(mns.filter(m => m.model).map(m => ({ ip: m.ip, model: m.model, name: m.name, kind: 'mon', known: known.includes(m.ip) })))
          .concat(nds.filter(n => n.model).map(n => ({ ip: n.ip, model: n.model, kind: 'ndi', known: known.includes(n.ip) }))),
        other: all.filter(d => d.answered && !d.present).length,
      }));
    });
    return;
  }
  if (url === '/devices' && req.method === 'POST') {
    readBody(req, 4096).then(buf => deviceChange(JSON.parse(buf.toString('utf8')) || {}))
      .then(() => { res.writeHead(204); res.end(); })
      .catch(e => { res.writeHead(422, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(e && e.message ? e.message : 'That did not work.'); });
    return;
  }
  if (url === '/spaces' && req.method === 'POST') {
    readBody(req, 256 * 1024).then(buf => {
      spaces = cleanSpaces(JSON.parse(buf.toString('utf8')));
      fs.writeFileSync(SPACES_FILE, JSON.stringify(spaces, null, 1));
      res.writeHead(204); res.end(); push();
    }).catch(() => { res.writeHead(400); res.end('Bad spaces'); });
    return;
  }
  if (url === '/prefs' && req.method === 'POST') {
    readBody(req, 16 * 1024).then(buf => {
      const raw = JSON.parse(buf.toString('utf8')) || {};
      prefs = {
        hideRooms: (Array.isArray(raw.hideRooms) ? raw.hideRooms : []).filter(x => typeof x === 'string' && /^[\w-]{1,40}$/.test(x)).slice(0, 50),
        hideFloor: !!raw.hideFloor, hideGear: !!raw.hideGear,
      };
      fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs));
      res.writeHead(204); res.end(); push();
    }).catch(() => { res.writeHead(400); res.end('Bad settings'); });
    return;
  }
  if (url === '/floor-image' && req.method === 'GET') {
    if (!floor.imageType || !fs.existsSync(FLOOR_IMG)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': floor.imageType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(FLOOR_IMG).pipe(res);
    return;
  }
  if (url === '/floor-image' && req.method === 'POST') {
    const type = (req.headers['content-type'] || '').split(';')[0];
    if (!IMG_TYPES.includes(type)) { res.writeHead(415); res.end('Use a PNG, JPEG or WebP image'); return; }
    readBody(req, 8 * 1024 * 1024).then(buf => {
      if (buf.length) { fs.writeFileSync(FLOOR_IMG, buf); floor.imageType = type; }
      else { try { fs.unlinkSync(FLOOR_IMG); } catch (e) {} floor.imageType = null; }
      floor.v++; saveFloor(); res.writeHead(204); res.end();
    }).catch(() => { res.writeHead(413); res.end('Image is too large'); });
    return;
  }
  if (url === '/floor-pins' && req.method === 'POST') {
    readBody(req, 64 * 1024).then(buf => {
      const raw = JSON.parse(buf.toString('utf8')), pins = {};
      for (const k of Object.keys(raw).slice(0, 300)) {
        const p = raw[k];
        if (/^[\w:-]{1,64}$/.test(k) && p && Number.isFinite(p.x) && Number.isFinite(p.y)) pins[k] = { x: Math.min(100, Math.max(0, p.x)), y: Math.min(100, Math.max(0, p.y)) };
      }
      floor.pins = pins; saveFloor(); res.writeHead(204); res.end();
    }).catch(() => { res.writeHead(400); res.end('Bad layout'); });
    return;
  }
  if (url === '/' || url === '/index.html') {
    // The page file carries no venue data. The current state is put into it here, at the moment it is served.
    const snapNow = isEngineer(req) ? lastJson : lastPublic;
    if (!snapNow) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="2"><title>Venue Router</title></head><body style="font-family:system-ui,sans-serif;padding:2rem"><h1 style="font-size:1.2rem">Connecting to the router and switcher</h1><p>This page will load by itself once both answer. If it stays here, check that they are switched on and reachable from this computer.</p></body></html>');
      return;
    }
    const html = fs.readFileSync(path.join(__dirname, 'venue-router.html'), 'utf8')
      .replace(/<script id="snap" type="application\/json">[\s\S]*?<\/script>/, () => '<script>window.VENUE_LIVE=1</script><script id="snap" type="application/json">' + snapNow.replace(/</g, '\\u003c') + '</script>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">' + html + '</body></html>');
    return;
  }
  res.writeHead(404); res.end('Not found');
}).listen(PORT, HOST, () => {
  const shared = HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1';
  log(`Venue Router is watching ${core.router} and ${core.switcher} at http://${HOST}:${PORT}`);
  log(shared ? 'Open to the network: other devices can reach it at this computer\'s address on port ' + PORT + '.' : 'Only reachable from this computer. Set HOST=0.0.0.0 to open it to the network.');
  if (shared && !authCfg) log('No Engineer PIN is set. Until one is, Engineer view only works on this computer.');
});
process.on('uncaughtException', e => { log('Unexpected error, carrying on: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); });
setInterval(() => { for (const res of clients.keys()) res.write(': keep-alive\n\n'); }, 20000);
