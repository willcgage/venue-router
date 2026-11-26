// The page's own logic, run outside a browser on a made-up venue: following a picture, naming ports, the cabling
// read from labels, and the spreadsheet round trip.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage } = require('./page');
const fixture = require('./fixture');

const plain = x => JSON.parse(JSON.stringify(x));          // values made inside the page belong to another realm
const row = (rows, no) => rows.filter(r => r.no === no)[0];
const target = (rows, no) => row(rows, no).target;
const needsRename = (rows, no) => row(rows, no).checks.indexOf('Rename') >= 0;

test('a picture is followed from screen back to source', () => {
  const p = loadPage(fixture.snapshot());
  // Green Room (out 9) takes switcher output 2, which is on switcher input 1, which is fed by Camera A
  assert.deepEqual(plain(p.trace(8).map(h => h.port)), ['Router out 9', 'Router in 2', 'Switcher out 2', 'Switcher in 1', 'Router out 1', 'Router in 9']);
  assert.equal(p.describe(8).title, 'Camera A');
  // Foyer (out 8) takes Camera A straight from the router
  assert.deepEqual(plain(p.trace(7).map(h => h.port)), ['Router out 8', 'Router in 9']);
  assert.equal(p.describe(7).title, 'Camera A');
  // Lobby TV (out 7) takes switcher output 1, which is a mix made in the switcher
  const lobby = plain(p.trace(6));
  assert.equal(lobby[lobby.length - 1].internal, true);
  // A recorder's playback is where a path ends
  const viaDeck = loadPage({ ...fixture.snapshot(), rtr: { ...fixture.snapshot().rtr, route: fixture.router().route.map((v, o) => (o === 9 ? 6 : v)) } });
  const hops = plain(viaDeck.trace(9));
  assert.equal(hops[hops.length - 1].deck, 'rec-1');
});

test('the standard name follows where the cable goes', () => {
  const p = loadPage(fixture.snapshot());
  const ins = p.portRows('rtr', 'in'), outs = p.portRows('rtr', 'out');

  // Tied to the switcher: the switcher port, then the switcher's own name for it
  assert.equal(target(ins, 1), 'SW Out 1 - PGM out');
  assert.equal(needsRename(ins, 1), false);
  assert.equal(target(ins, 2), 'SW Out 2', 'a switcher output with no name of its own adds nothing');
  assert.equal(target(outs, 1), 'SW IN 1 - Camera 1');
  assert.equal(needsRename(outs, 1), false);
  assert.equal(target(outs, 2), 'SW IN 2 - Camera 2', 'a tie named without its switcher port gets one');
  assert.equal(needsRename(outs, 2), true);
  assert.equal(target(outs, 3), 'SW IN 3 - Graphics', 'the switcher is the master for a tie');
  assert.equal(target(outs, 4), 'SW IN 4');

  // To a recorder or converter: left as it is
  for (const [rows, no] of [[ins, 7], [ins, 8], [outs, 5], [outs, 6]]) {
    assert.equal(target(rows, no), row(rows, no).l);
    assert.equal(needsRename(rows, no), false);
  }

  // On a wall plate: the plate, then what it is for
  assert.equal(target(ins, 3), 'RTR-IN-3 Podium', 'a leading port number is dropped');
  assert.equal(target(ins, 4), 'RTR-IN-4 Stage camera');
  assert.equal(needsRename(ins, 4), false);
  assert.equal(target(ins, 5), 'RTR-IN-5 Playback 2', 'a status note is dropped');
  assert.equal(target(ins, 6), 'RTR-IN-6 Handheld camera', 'what the register says is connected is used');
  assert.equal(target(ins, 9), 'RTR-IN-9 Camera A');
  assert.equal(target(ins, 10), 'RTR-IN-10');
  assert.equal(needsRename(ins, 10), false);
  assert.equal(target(outs, 7), 'RTR-OUT-7 Lobby TV');
  assert.equal(target(outs, 8), 'RTR-OUT-8 Foyer');

  assert.equal(p.renameCount(), ins.concat(outs).filter(r => r.checks.indexOf('Rename') >= 0).length);
  assert.ok(plain(p.findings()).some(f => /not named to the standard/.test(f.t)));
});

test('the standard can be overridden, and is off until plates are set', () => {
  const reg = fixture.ports();
  reg.rtr.out[6] = { want: 'Lobby' };
  reg.rtr.in[8] = { want: 'Same' };
  reg.rtr.in[9] = { want: 'same' };
  reg.sw = { in: { 1: { want: 'A camera name that is far too long' } }, out: {} };
  const p = loadPage({ ...fixture.snapshot(), ports: reg });
  assert.equal(target(p.portRows('rtr', 'out'), 7), 'Lobby', 'a new label replaces the standard name');
  const ins = p.portRows('rtr', 'in');
  assert.ok(row(ins, 9).checks.indexOf('Name used twice') >= 0);
  assert.ok(row(ins, 10).checks.indexOf('Name used twice') >= 0);
  assert.ok(row(p.portRows('sw', 'in'), 1).checks.indexOf('Over 20 characters') >= 0);
  assert.equal(p.portRows('sw', 'in').length, 4, 'a switcher lists its real inputs only');

  const off = loadPage(fixture.snapshot({ withPorts: false }));
  assert.equal(off.renameCount(), 0);
  assert.ok(off.portRows('rtr', 'in').every(r => r.target === ''));

  // A port that is not known to feed a recorder is an ordinary plate port
  const loose = loadPage(fixture.snapshot({ deviceLinks: false }));
  assert.equal(target(loose.portRows('rtr', 'out'), 5), 'RTR-OUT-5 REC-IN-01');
});

test('a plate with something recorded on it is a named port', () => {
  const p = loadPage(fixture.snapshot());
  assert.equal(p.plainIn('RTR-IN-6'), false);
  assert.equal(p.inName(5), 'Handheld camera');
  assert.equal(p.plainIn('RTR-IN-10'), true);
  assert.equal(p.plainOut('RTR-OUT-12'), true);
  assert.equal(p.plainOut('SW IN 4'), true);
});

test('cabling is read from the router labels', () => {
  const unset = loadPage(fixture.snapshot({ deviceLinks: false }));
  const rec = plain(unset.devRows().filter(r => r.id === 'rec-1')[0].sug), conv = plain(unset.devRows().filter(r => r.id === 'conv-1')[0].sug);
  assert.equal(rec.fresh, true);
  assert.deepEqual(rec.posts, [{ action: 'deck-feed', id: 'rec-1', port: 4 }, { action: 'deck-ret-add', id: 'rec-1', port: 6 }]);
  assert.deepEqual(conv.posts, [{ action: 'conv-link', id: 'conv-1', list: 'feeds', op: 'add', port: 5 }, { action: 'conv-link', id: 'conv-1', list: 'returns', op: 'add', port: 7 }]);

  const set = loadPage(fixture.snapshot());
  assert.equal(set.devRows().filter(r => r.id === 'rec-1')[0].sug.match, true);
  assert.equal(set.devRows().filter(r => r.id === 'conv-1')[0].sug.match, true);
});

test('the whole-system view has every device in it', () => {
  const m = loadPage(fixture.snapshot()).sysModel();
  const left = plain(m.L.map(b => b.title)), right = plain(m.R.map(b => b.title));
  assert.ok(left.indexOf('TEST-SW') >= 0 && left.indexOf('CONV-A') >= 0 && left.indexOf('REC-A') >= 0);
  assert.ok(right.indexOf('Lobby') >= 0);
  assert.equal(m.rtr.title, 'TEST-RTR');
  assert.equal(m.L.filter(b => b.title === 'REC-A')[0].feed, 'Out 5');
  assert.equal(m.L.filter(b => b.title === 'CONV-A')[0].ret, 'In 8');
});

test('the port list survives a trip through a spreadsheet', () => {
  const p = loadPage(fixture.snapshot());
  const csv = p.portsCsv(), rows = plain(p.parseCsv(csv));
  assert.deepEqual(rows[0].slice(0, 5), ['Device', 'Direction', 'Port', 'Plate', 'Hardware label']);
  assert.equal(rows.length, 1 + 16 + 16 + 4 + 2, 'router inputs and outputs, switcher real inputs and outputs');
  assert.equal(plain(p.readPortsCsv(csv, 'same.csv')).changes.length, 0, 'an untouched export changes nothing');

  // Edit it the way a spreadsheet would: sorted differently, one field with a comma, one mangled into a date
  const head = rows[0], col = name => head.indexOf(name);
  const body = rows.slice(1).reverse();
  const find = (dev, dir, port) => body.filter(r => r[0] === dev && r[1] === dir && r[2] === String(port))[0];
  find('Router', 'Input', 9)[col('Plate is in')] = 'Stage, left side';
  find('Router', 'Input', 9)[col('Status')] = 'Spare';
  find('Router', 'Output', 7)[col('New label')] = '1-Feb';
  find('Switcher', 'Input', 2)[col('Connected')] = 'Wide shot';
  find('Router', 'Input', 3)[col('Hardware label')] = 'typed into the wrong column';
  find('Router', 'Input', 4)[col('Status')] = 'Broken';
  body.push(['Router', 'Sideways', '3'], ['Nowhere', 'Input', '1']);
  const edited = [head].concat(body).map(r => r.map(p.csvCell).join(';')).join('\n');   // semicolons and bare newlines, as some spreadsheets save

  const back = plain(p.readPortsCsv(edited, 'edited.csv'));
  assert.equal(back.error, undefined);
  assert.deepEqual(back.changes.map(c => c.label).sort(), ['Router input 9', 'Router output 7', 'Switcher input 2']);
  const cam = back.changes.filter(c => c.label === 'Router input 9')[0];
  assert.equal(cam.rec.room, 'Stage, left side');
  assert.equal(cam.rec.status, 'spare');
  assert.equal(cam.port, 8);
  assert.equal(back.changes.filter(c => c.label === 'Switcher input 2')[0].dev, 'sw');
  assert.equal(back.warn.length, 4, 'skipped rows, a changed hardware label, a date, an unknown status');

  assert.ok(p.readPortsCsv('just,some,text\n1,2,3', 'x.csv').error);
});

test('sorting and port lists read naturally', () => {
  const p = loadPage(fixture.snapshot());
  assert.equal(p.ranges([0, 1, 2, 5, 8, 9]), '1–3, 6, 9, 10');
  const list = [{ v: 'Camera 10' }, { v: '' }, { v: 'Camera 2' }, { v: 'camera 1' }], get = x => x.v;
  assert.deepEqual(plain(p.sortRows(list, { k: 'v', dir: 1 }, get)).map(get), ['camera 1', 'Camera 2', 'Camera 10', '']);
  assert.deepEqual(plain(p.sortRows(list, { k: 'v', dir: -1 }, get)).map(get), ['Camera 10', 'Camera 2', 'camera 1', ''], 'empty stays last either way');
  assert.equal(p.sortRows(list, null, get), list);
});
