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

  // Which ports are on a wall plate is worked out from the labels until someone says otherwise:
  // a port already named after its plate, or one carrying its own port number
  assert.equal(p.portsText(p.platePorts('in')), '3-4, 6, 10-16');
  assert.equal(p.portsText(p.platePorts('out')), '8, 10-16');

  // On a wall plate: the plate, then what it is for
  assert.equal(target(ins, 3), 'RTR-IN-3 Podium', 'a leading port number is dropped');
  assert.equal(target(ins, 4), 'RTR-IN-4 Stage camera');
  assert.equal(needsRename(ins, 4), false);
  assert.equal(target(ins, 6), 'RTR-IN-6 Handheld camera', 'what the register says is connected is used');
  assert.equal(target(ins, 10), 'RTR-IN-10');
  assert.equal(needsRename(ins, 10), false);
  assert.equal(target(outs, 8), 'RTR-OUT-8 Foyer');
  assert.equal(row(outs, 8).plate, 'RTR-OUT-8');

  // Anywhere else, such as equipment in the rack: just what it is for, with no plate name put in front
  assert.equal(target(ins, 5), 'Playback 2', 'a status note is dropped');
  assert.equal(needsRename(ins, 5), true);
  assert.equal(target(ins, 9), 'Camera A');
  assert.equal(needsRename(ins, 9), false);
  assert.equal(target(outs, 7), 'Lobby TV');
  assert.equal(needsRename(outs, 7), false);
  assert.equal(row(outs, 7).plate, '');

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

  // A port not known to feed a recorder, and not on a plate, keeps its own name
  const loose = loadPage(fixture.snapshot({ deviceLinks: false }));
  assert.equal(target(loose.portRows('rtr', 'out'), 5), 'REC-IN-01');
});

test('an engineer can say which ports have wall plates', () => {
  const reg = fixture.ports();
  reg.plates.outOn = '1-7';      // includes ties and a recorder input, which are never plates
  reg.plates.inOn = 'none';
  const p = loadPage({ ...fixture.snapshot(), ports: reg });
  const ins = p.portRows('rtr', 'in'), outs = p.portRows('rtr', 'out');
  assert.equal(target(outs, 7), 'RTR-OUT-7 Lobby TV', 'a port in the range gets its plate name');
  assert.equal(target(outs, 8), 'Foyer', 'a port left out of the range loses it, even if its label looks like a plate port');
  assert.equal(target(outs, 1), 'SW IN 1 - Camera 1', 'a tie stays a tie inside a plate range');
  assert.equal(row(outs, 1).plate, '');
  assert.equal(target(outs, 5), 'REC-IN-01', 'a recorder port stays as it is inside a plate range');
  assert.equal(target(ins, 4), 'Stage camera', 'with no input plates, a plate name is taken off');
  assert.equal(p.portsText(p.platePorts('in')), '');

  assert.equal(p.portsText(p.parsePorts('66-96, 113–120; 5 5  200 9-7', 120)), '5, 7-9, 66-96, 113-120', 'either dash, any separator, reversed ranges, nothing past the last port');
  assert.equal(p.portsText(p.parsePorts('none', 120)), '');
  assert.equal(p.portsText(p.parsePorts('camera, stage', 120)), '');
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

test('a patch panel is one more step in a path, and its open jacks are counted', () => {
  const panels = [{ id: 'a', name: 'Video patch A', place: 'Rack room', jacks: [
    { label: 'TV1', to: 'Wall plate behind the lobby TV', patch: { dir: 'out', port: 6 } },   // router out 7, Lobby TV
    { label: 'STAGE-L', to: 'Stage left floor box', patch: { dir: 'in', port: 8 } },          // router in 9, Camera A
    { label: 'TV2', to: '', patch: null },
    { label: '', to: '', patch: { dir: 'out', port: 6 } },                                    // a second jack on the same port
  ] }];
  const p = loadPage({ ...fixture.snapshot(), panels });

  assert.equal(p.patchOf('out', 6).jack.label, 'TV1');
  assert.equal(p.patchOf('out', 9), null);
  assert.deepEqual(plain(p.panelStats(p.patchOf('out', 6).panel)), { open: 1, clash: 2, diff: 0 });

  // The port list says where a patched port really goes
  assert.equal(row(p.portRows('rtr', 'out'), 7).auto, 'Video patch A · TV1, to Wall plate behind the lobby TV');
  assert.equal(row(p.portRows('rtr', 'in'), 9).auto, 'Video patch A · STAGE-L, to Stage left floor box');
  assert.equal(row(p.portRows('rtr', 'out'), 1).auto, 'Switcher in 1 · Camera 1', 'a tie is still a tie');

  // Foyer (out 8) shows Camera A, which comes in through the panel: source, panel, router, screen
  const foyer = plain(p.chainBoxes(p.trace(7), { d: 7 }));
  assert.deepEqual(foyer.map(b => b.title), ['Camera A', 'Video patch A', 'Router', '8: Foyer'].map((t, i) => (i === 3 ? foyer[3].title : t)));
  assert.deepEqual(foyer[1].lines, ['Jack 2 · STAGE-L', 'To Stage left floor box']);
  // Lobby TV (out 7) leaves through the panel: the panel is the last step before the screen
  const lobby = plain(p.chainBoxes(p.trace(6), { d: 6 }));
  assert.equal(lobby[lobby.length - 2].title, 'Video patch A');
  assert.deepEqual(lobby[lobby.length - 2].lines, ['Jack 1 · TV1', 'To Wall plate behind the lobby TV']);

  // With no panels recorded, nothing changes
  const none = loadPage(fixture.snapshot());
  assert.equal(plain(none.chainBoxes(none.trace(7), { d: 7 })).length, foyer.length - 1);
});

test('a panel with a saved normal marks every jack that is patched differently', () => {
  const out = port => ({ dir: 'out', port }), inp = port => ({ dir: 'in', port });
  const panels = [{ id: 'a', name: 'Video patch A', place: 'Rack room',
    jacks: [
      { label: 'TV1', to: 'Lobby TV plate', patch: out(6) },        // as normal
      { label: 'TV2', to: 'Foyer TV plate', patch: out(8) },        // moved: normally out 8 (index 7)
      { label: 'TV3', to: '', patch: null },                        // unplugged: normally out 10
      { label: 'STAGE-L', to: 'Stage left', patch: inp(8) },        // plugged in where nothing normally goes
      { label: 'SPARE', to: '', patch: null },                      // open, as normal
    ],
    normal: [out(6), out(7), out(9), null, null] }];
  const p = loadPage({ ...fixture.snapshot(), panels });
  const panel = p.patchOf('out', 6).panel;
  assert.deepEqual([0, 1, 2, 3, 4].map(k => p.jackDiffers(panel, k)), [false, true, true, true, false]);
  assert.deepEqual(plain(p.panelStats(panel)), { open: 2, clash: 0, diff: 3 });
  assert.ok(plain(p.findings()).some(f => f.nav === 'panels' && /Video patch A: 3 jacks are not patched as normal/.test(f.t)));

  // In a path, a jack that is not as normal says so
  const moved = plain(p.chainBoxes(p.trace(8), { d: 8 }));
  const box = moved.filter(b => b.title === 'Video patch A')[0];
  assert.ok(box.lines.indexOf('Not the normal patch') >= 0);
  assert.equal(box.warn, true);
  const fine = plain(p.chainBoxes(p.trace(6), { d: 6 })).filter(b => b.title === 'Video patch A')[0];
  assert.equal(fine.lines.indexOf('Not the normal patch'), -1);

  // Until a normal is saved, nothing is marked
  const unsaved = loadPage({ ...fixture.snapshot(), panels: [{ ...panels[0], normal: undefined }] });
  assert.equal(unsaved.panelStats(unsaved.patchOf('out', 6).panel).diff, 0);
  assert.ok(!plain(unsaved.findings()).some(f => f.nav === 'panels'));
});

test('patch panels are drawn on the whole-system view, on the side their patches are on', () => {
  const panels = [{ id: 'a', name: 'Video patch A', place: 'Rack room', jacks: [
    { label: 'TV1', to: 'Lobby TV plate', patch: { dir: 'out', port: 6 } },
    { label: 'TV2', to: '', patch: { dir: 'out', port: 7 } },
    { label: 'STAGE-L', to: 'Stage left', patch: { dir: 'in', port: 8 } },
    { label: 'SPARE', to: '', patch: null },
  ], normal: [{ dir: 'out', port: 6 }, null, { dir: 'in', port: 8 }, null] }, { id: 'b', name: 'Empty panel', place: '', jacks: [{ label: '', to: '', patch: null }] }];
  const m = loadPage({ ...fixture.snapshot(), panels }).sysModel();
  const left = plain(m.L.filter(b => b.title === 'Video patch A')), right = plain(m.R.filter(b => b.title === 'Video patch A'));
  assert.equal(left.length, 1);
  assert.equal(right.length, 1);
  assert.equal(left[0].ret, 'In 9');
  assert.equal(left[0].feed, undefined);
  assert.equal(right[0].feed, 'Out 7, 8');
  assert.equal(right[0].warn, true, 'TV2 is not as normal');
  assert.equal(left[0].warn, false);
  assert.ok(right[0].lines.some(l => /1 jack is not as normal/.test(l)));
  assert.ok(right[0].lines.some(l => /1 jack open/.test(l)));
  assert.equal(right[0].detail.length, 2);
  assert.ok(!plain(m.L.concat(m.R)).some(b => b.title === 'Empty panel'), 'a panel with nothing patched has nothing to draw');

  // An input that comes in through a panel is shown on the panel, not counted again as a loose source
  const without = loadPage(fixture.snapshot()).sysModel();
  assert.equal(parseInt(m.L[0].title, 10), parseInt(without.L[0].title, 10) - 1);
});

test('a wall plate can carry its own marking', () => {
  const reg = fixture.ports();
  reg.plates.outOn = '7-9, 12';
  reg.rtr.out[6] = { plate: 'TV-LOBBY', room: 'Lobby' };          // router out 7, labelled "Lobby TV"
  reg.rtr.out[7] = { plate: 'FOYER' };                            // router out 8, labelled "8: Foyer"
  reg.rtr.out[8] = { plate: 'GR1', connected: 'GR1 confidence' }; // router out 9, labelled "Green Room"
  const p = loadPage({ ...fixture.snapshot(), ports: reg });
  const outs = p.portRows('rtr', 'out');

  assert.equal(row(outs, 7).plate, 'TV-LOBBY');
  assert.equal(target(outs, 7), 'TV-LOBBY Lobby TV', 'its own marking goes in front, like any plate name');
  assert.equal(target(outs, 8), 'FOYER', 'when the marking and the description say the same thing, it is said once');
  assert.equal(target(outs, 9), 'GR1 confidence', 'a description that already starts with the marking is not given it twice');
  assert.equal(row(outs, 12).plate, 'RTR-OUT-12', 'a plate with no marking of its own uses the usual one');

  // The sheet for the label maker: every wall plate, then every patch panel jack with something recorded
  const withPanel = loadPage({ ...fixture.snapshot(), ports: reg, panels: [{ id: 'a', name: 'Video patch A', place: 'Rack room', jacks: [
    { label: 'TV-LOBBY', to: 'Lobby TV plate', patch: { dir: 'out', port: 6 } }, { label: '', to: '', patch: null }, { label: 'SPARE-2', to: '', patch: null }] }] });
  const sheet = plain(withPanel.plateSheetRows());
  assert.deepEqual(sheet.plates.filter(r => r.own).map(r => r.mark).sort(), ['FOYER', 'GR1', 'TV-LOBBY']);
  assert.equal(sheet.plates[0].where, 'Lobby', 'plates with a place recorded come first');
  const lobby = sheet.plates.filter(r => r.mark === 'TV-LOBBY')[0];
  assert.deepEqual([lobby.what, lobby.port], ['Lobby TV', 'Router out 7']);
  assert.ok(sheet.plates.some(r => r.mark === 'RTR-IN-4' && r.what === 'Stage camera' && r.port === 'Router in 4'));
  assert.deepEqual(sheet.jacks.map(j => [j.jack, j.label, j.patch]), [[1, 'TV-LOBBY', 'Router out 7 · Lobby TV'], [3, 'SPARE-2', 'Open']], 'a jack with nothing recorded is left off');
});

test('an information button carries its text and says what it is about', () => {
  const p = loadPage(fixture.snapshot());
  const html = p.info('demo', 'About the demo', ['First point.', 'Second point.']);
  assert.ok(html.includes('<button type="button" class="infobtn" data-info="demo" aria-expanded="false" aria-label="About the demo">i</button>'));
  assert.match(html, /role="note"/);
  assert.equal(html.split('class="ip"').length - 1, 2);
  assert.ok(!/<p[ >]/.test(html), 'no paragraph tags, because the button often sits inside a paragraph or heading');
  assert.equal(p.info('demo', 'About the demo', 'One sentence.').split('class="ip"').length - 1, 1);
});

test('labels can be saved as a file for a label maker, and sized to fit when printed', () => {
  const reg = fixture.ports();
  reg.plates.outOn = '7';
  reg.rtr.out[6] = { room: 'Lobby', connected: 'Lobby TV', plate: 'TV-LOBBY' };
  const p = loadPage({ ...fixture.snapshot(), ports: reg, panels: [{ id: 'a', name: 'Video patch A', place: 'Rack room', jacks: [
    { label: 'MON1', to: 'Control room', patch: { dir: 'out', port: 6 } }, { label: '', to: 'Somewhere', patch: null }] }] });
  const rows = p.parseCsv(p.labelsCsv(false));
  assert.deepEqual(plain(rows[0]), ['Label', 'Kind', 'Where', 'For', 'Wired to']);
  assert.deepEqual(plain(rows.filter(r => r[0] === 'TV-LOBBY')), [['TV-LOBBY', 'Wall plate', 'Lobby', 'Lobby TV', 'Router out 7']]);
  assert.deepEqual(plain(rows.filter(r => r[1] === 'Patch panel jack')), [['MON1', 'Patch panel jack', 'Video patch A, Rack room, jack 1', 'Control room', 'Router out 7 · Lobby TV']], 'a jack with no label is left out: there is nothing to print');
  const own = p.parseCsv(p.labelsCsv(true)).filter(r => r[1] === 'Wall plate');
  assert.deepEqual(plain(own.map(r => r[0])), ['TV-LOBBY'], 'only plates with their own marking, when asked');

  // text fills the height of a short marking and shrinks to the width for a long one
  assert.ok(Math.abs(p.labelFont('MON1', 38, 13) - 13 * 0.62) < 0.01);
  const long = p.labelFont('RTR-OUT-120 STAGE LEFT', 38, 13);
  assert.ok(long < 13 * 0.62 && long * 0.62 * 'RTR-OUT-120 STAGE LEFT'.length <= 34.01, 'a long marking still fits across the label');
});

test('the Plate column of a spreadsheet is read back in, only for ports that have a plate', () => {
  const p = loadPage(fixture.snapshot());
  const file = cells => 'Device,Direction,Port,Plate\r\n' + cells.map(c => c.join(',')).join('\r\n') + '\r\n';
  const got = p.readPortsCsv(file([['Router', 'Output', 8, 'FOYER'], ['Router', 'Output', 12, 'RTR-OUT-12'], ['Router', 'Output', 13, ''], ['Router', 'Output', 1, 'WRONG']]), 'x.csv');
  assert.equal(got.error, undefined);
  assert.deepEqual(plain(got.changes.map(c => [c.dir, c.port, c.rec.plate, c.diffs])), [['out', 7, 'FOYER', [{ name: 'Plate', from: 'RTR-OUT-8', to: 'FOYER' }]]],
    'the usual marking and an empty cell change nothing');
  assert.ok(got.warn.some(w => /no wall plate/.test(w)), 'a marking on a port tied to the switcher is left out, and said so');

  // the usual marking clears an own one
  const reg = fixture.ports();
  reg.rtr.out[7] = { plate: 'FOYER' };
  const back = loadPage({ ...fixture.snapshot(), ports: reg }).readPortsCsv(file([['Router', 'Output', 8, 'RTR-OUT-8']]), 'x.csv');
  assert.deepEqual(plain(back.changes.map(c => [c.port, c.rec.plate])), [[7, '']]);
});

test('the rename card stays off the page until it has something to say', () => {
  const fresh = loadPage(fixture.snapshot({ withPorts: false }));
  assert.equal(fresh.renameShown('rtr'), false, 'no plates set up: nothing is proposed, so no card');
  assert.equal(fresh.renameShown('sw'), false);
  const setUp = loadPage(fixture.snapshot());
  assert.equal(setUp.renameShown('rtr'), true, 'with the naming check on, the router card is there');
  assert.equal(setUp.renameShown('sw'), false, 'no switcher input has a new label waiting');
  const reg = fixture.ports();
  reg.sw = { in: { 1: { want: 'Cam 1 wide' } }, out: {} };
  assert.equal(loadPage({ ...fixture.snapshot(), ports: reg }).renameShown('sw'), true);
  const undoable = loadPage({ ...fixture.snapshot({ withPorts: false }), renames: [{ id: 'a', t: 1, dev: 'rtr', undo: false, changes: [{ dir: 'in', port: 2, from: 'a', to: 'b' }] }] });
  assert.equal(undoable.renameShown('rtr'), true, 'a rename that can be undone keeps the card');
});

test('a snapshot that only knows where recorders and converters are still puts them on the whole-system map', () => {
  const snap = fixture.snapshot();
  snap.decks = [{ id: 'rec-1', place: 'Rack', feed: 4, returns: [6] }];
  snap.convs = [{ id: 'conv-1', place: 'Rack', feeds: [5], returns: [7] }];
  const keys = JSON.stringify(plain(loadPage(snap).sysModel()));
  assert.ok(keys.includes('sys:rec-1') && keys.includes('sys:conv-1'));
});
