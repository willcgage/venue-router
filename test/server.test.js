// The server, run for real against pretend devices: what it reads, what it saves, and above all what it will and
// will not write to a router.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers');
const fixture = require('./fixture');

const rename = (port, from, to, dir = 'in') => ({ dir, port, from, to });

test('the feed carries what the devices report', async t => {
  const app = await startApp();
  t.after(app.stop);
  const f = await app.feed();
  assert.equal(f.rtr.name, 'TEST-RTR');
  assert.deepEqual(f.rtr.inL, fixture.router().inL);
  assert.deepEqual(f.rtr.outL, fixture.router().outL);
  assert.deepEqual(f.rtr.route, fixture.router().route);
  assert.deepEqual(f.sw.inL, fixture.switcher().inL);
  assert.deepEqual(f.ties, fixture.ties);
  assert.equal(f.conn.rtr, true);
  assert.match(f.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(f.ports.plates, { in: 'RTR-IN-{n}', out: 'RTR-OUT-{n}' });
  assert.deepEqual(app.rtr.state.writes, [], 'reading must not send anything to the router');
});

test('the port register is saved, cleaned, and kept from people without the PIN', async t => {
  const app = await startApp();
  t.after(app.stop);

  // Before a PIN exists, the computer running the app is the engineer
  let r = await app.post('/ports', { set: [{ dev: 'rtr', dir: 'in', port: 8, room: '  Stage left  ', connected: 'Camera A', status: 'nonsense', notes: 'spare cable in rack', want: '' },
    { dev: 'sw', dir: 'in', port: 1, want: 'Cam 1' }, { dev: 'no-such-room', dir: 'in', port: 1, want: 'x' }, { dev: 'rtr', dir: 'sideways', port: 1, want: 'x' }] });
  assert.equal(r.status, 204);
  const saved = app.file('ports.json');
  assert.deepEqual(saved.rtr.in[8], { room: 'Stage left', connected: 'Camera A', status: '', notes: 'spare cable in rack', want: '' });
  assert.equal(saved.sw.in[1].want, 'Cam 1');
  assert.deepEqual(saved.rooms, {}, 'a device that is not set up is ignored');
  assert.equal(saved.rtr.in[5].connected, 'Handheld camera', 'ports that were not sent are left alone');

  // A plate's own marking is kept with its port, and only when there is one
  await app.post('/ports', { set: [{ dev: 'rtr', dir: 'out', port: 6, plate: '  TV-LOBBY ' }, { dev: 'rtr', dir: 'out', port: 7, plate: '' }] });
  assert.deepEqual(app.file('ports.json').rtr.out[6], { room: '', connected: '', status: '', notes: '', want: '', plate: 'TV-LOBBY' });
  assert.equal(app.file('ports.json').rtr.out[7], undefined);

  // Which ports have wall plates is saved beside the plate patterns, and only as port numbers
  r = await app.post('/ports', { plates: { inOn: '3-5, 9' } });
  assert.equal(r.status, 204);
  assert.deepEqual(app.file('ports.json').plates, { in: 'RTR-IN-{n}', out: 'RTR-OUT-{n}', inOn: '3-5, 9' }, 'the patterns are kept when only the ports are sent');
  await app.post('/ports', { plates: { outOn: 'none', inOn: '<b>not ports</b>' } });
  assert.deepEqual(app.file('ports.json').plates, { in: 'RTR-IN-{n}', out: 'RTR-OUT-{n}', outOn: 'none' }, 'anything that is not port numbers is dropped');

  r = await app.post('/auth/pin', { pin: '482915' });
  assert.equal(r.status, 204);
  const cookie = r.cookie;
  assert.ok(cookie, 'setting the PIN signs that browser in');

  r = await app.post('/ports', { set: [{ dev: 'rtr', dir: 'in', port: 8, connected: 'Someone else' }] });
  assert.equal(r.status, 401, 'no PIN, no save');
  assert.equal(app.file('ports.json').rtr.in[8].connected, 'Camera A');

  const open = await app.feed(), eng = await app.feed(cookie);
  assert.equal(open.ports.rtr.in[8].notes, '', 'notes are for engineers');
  assert.equal(open.ports.rtr.in[8].connected, 'Camera A');
  assert.equal(eng.ports.rtr.in[8].notes, 'spare cable in rack');
  assert.deepEqual(app.rtr.state.writes, [], 'saving the register must not send anything to the router');
});

test('renaming: who may, what is sent, and what is refused', async t => {
  const app = await startApp();
  t.after(app.stop);
  const before = fixture.router();

  // No PIN set: refused even from the computer running the app
  let r = await app.post('/labels', { dev: 'rtr', changes: [rename(2, '3: Podium', 'RTR-IN-3 Podium')] });
  assert.equal(r.status, 422);
  assert.match(r.text, /PIN/);

  r = await app.post('/auth/pin', { pin: '482915' });
  const cookie = r.cookie;

  // PIN set, not signed in
  r = await app.post('/labels', { dev: 'rtr', changes: [rename(2, '3: Podium', 'RTR-IN-3 Podium')] });
  assert.equal(r.status, 401);
  assert.deepEqual(app.rtr.state.writes, [], 'nothing reached the router before an engineer asked');

  // Only the main router and the main switcher
  r = await app.post('/labels', { dev: 'some-room', changes: [rename(1, 'Camera 1', 'Cam 1')] }, { cookie });
  assert.equal(r.status, 422);

  // A mixed batch from a signed-in engineer
  r = await app.post('/labels', { dev: 'rtr', changes: [
    rename(2, '3: Podium', 'RTR-IN-3 Podium'),
    rename(4, 'Playback 2 (Not Working)', 'RTR-IN-5 Playback 2'),
    rename(6, 'Lobby TV', 'RTR-OUT-7 Lobby TV', 'out'),
    rename(5, 'not what the router says', 'RTR-IN-6 X'),   // the list is out of date for this port
    rename(8, 'Camera A', 'Café camera'),                  // not plain characters
    rename(9, 'RTR-IN-10', 'x'.repeat(61)),                // too long
    rename(99, 'x', 'y'),                                  // no such port
    rename(3, 'RTR-IN-4 Stage camera', 'RTR-IN-4 Stage camera'), // already right
  ] }, { cookie });
  assert.equal(r.status, 200);
  const out = JSON.parse(r.text);
  assert.equal(out.done, 3);
  assert.deepEqual(out.failed.map(f => f.port).sort(), [5, 8, 9]);

  const now = app.rtr.state;
  assert.equal(now.inL[2], 'RTR-IN-3 Podium');
  assert.equal(now.inL[4], 'RTR-IN-5 Playback 2');
  assert.equal(now.outL[6], 'RTR-OUT-7 Lobby TV');
  assert.equal(now.inL[5], before.inL[5]);
  assert.equal(now.inL[8], before.inL[8]);
  assert.equal(now.inL[9], before.inL[9]);
  assert.deepEqual(now.route, before.route, 'no route was changed');
  assert.deepEqual([...new Set(now.writes)].sort(), ['INPUT LABELS', 'OUTPUT LABELS'], 'only label blocks were ever sent');
  assert.deepEqual(app.sw.state.writes, [], 'the switcher was not written to');
  assert.deepEqual(app.sw.state.inL, fixture.switcher().inL);
  assert.deepEqual(app.atemCalls(), [], 'and nothing was asked of it over its own protocol either');

  // The app's own picture follows the router, and the batch is kept for undo
  const eng = await app.feed(cookie), open = await app.feed();
  assert.equal(eng.rtr.inL[2], 'RTR-IN-3 Podium');
  assert.equal(eng.renames.length, 1);
  assert.equal(eng.renames[0].changes.length, 3);
  assert.deepEqual(open.renames, [], 'rename history is for engineers');
  assert.equal(app.file('label-history.json').length, 1);

  // Undo is the same request the other way round. A port renamed again since then is left alone.
  r = await app.post('/labels', { dev: 'rtr', changes: [rename(4, 'RTR-IN-5 Playback 2', 'RTR-IN-5 Deck B')] }, { cookie });
  assert.equal(JSON.parse(r.text).done, 1);
  r = await app.post('/labels', { dev: 'rtr', undo: true, changes: eng.renames[0].changes.map(c => ({ dir: c.dir, port: c.port, from: c.to, to: c.from })) }, { cookie });
  const undone = JSON.parse(r.text);
  assert.equal(undone.done, 2);
  assert.equal(undone.failed.length, 1);
  assert.equal(now.inL[2], '3: Podium');
  assert.equal(now.outL[6], 'Lobby TV');
  assert.equal(now.inL[4], 'RTR-IN-5 Deck B');
  assert.deepEqual(now.route, before.route);
});

test('patch panels are saved, cleaned, and kept from people without the PIN', async t => {
  const app = await startApp();
  t.after(app.stop);

  let r = await app.post('/panels', [{ id: 'a', name: '  Video patch A ', place: 'Rack room', jacks: [
    { label: 'TV1', to: 'Lobby TV plate', patch: { dir: 'out', port: 6 } },
    { label: 'x'.repeat(100), to: 5, patch: { dir: 'sideways', port: 2 } },
    { patch: { dir: 'in', port: -1 } },
  ] }, { id: 'a', jacks: 'not a list' }, 'not a panel']);
  assert.equal(r.status, 204);
  const saved = app.file('panels.json');
  assert.equal(saved.length, 3);
  assert.deepEqual(saved[0], { id: 'a', name: 'Video patch A', place: 'Rack room', jacks: [
    { label: 'TV1', to: 'Lobby TV plate', patch: { dir: 'out', port: 6 } },
    { label: 'x'.repeat(40), to: '', patch: null },
    { label: '', to: '', patch: null },
  ] });
  assert.notEqual(saved[1].id, 'a', 'two panels never share an id');
  assert.equal('normal' in saved[0], false, 'no normal until one is saved');

  // A saved normal is kept as one entry per jack, cleaned the same way as a patch
  await app.post('/panels', [{ id: 'a', name: 'A', jacks: [{ patch: { dir: 'out', port: 6 } }, {}, {}], normal: [{ dir: 'out', port: 6 }, { dir: 'nowhere', port: 1 }] }]);
  assert.deepEqual(app.file('panels.json')[0].normal, [{ dir: 'out', port: 6 }, null, null]);
  await app.post('/panels', saved);
  assert.equal(saved[1].name, 'Patch panel');
  assert.deepEqual((await app.feed()).panels[0].jacks[0].patch, { dir: 'out', port: 6 });

  r = await app.post('/auth/pin', { pin: '482915' });
  const cookie = r.cookie;
  r = await app.post('/panels', []);
  assert.equal(r.status, 401, 'no PIN, no save');
  assert.equal(app.file('panels.json').length, 3);
  r = await app.post('/panels', [], { cookie });
  assert.equal(r.status, 204);
  assert.deepEqual(app.file('panels.json'), []);
  assert.deepEqual(app.rtr.state.writes, [], 'recording patches must not send anything to the router');
});

test('renaming switcher inputs: only names, only real inputs, only for an engineer', async t => {
  const app = await startApp();
  t.after(app.stop);
  const sw = (port, from, to) => ({ dir: 'in', port, from, to });

  let r = await app.post('/labels', { dev: 'sw', changes: [sw(1, 'Camera 1', 'Wide')] });
  assert.equal(r.status, 422, 'no PIN set: refused');
  r = await app.post('/auth/pin', { pin: '482915' });
  const cookie = r.cookie;
  r = await app.post('/labels', { dev: 'sw', changes: [sw(1, 'Camera 1', 'Wide')] });
  assert.equal(r.status, 401, 'PIN set, not signed in: refused');
  assert.deepEqual(app.atemCalls(), [], 'nothing reached the switcher before an engineer asked');

  r = await app.post('/labels', { dev: 'sw', changes: [
    sw(1, 'Camera 1', 'Wide'),
    sw(3, 'Graphics', 'Lyrics'),
    sw(2, 'not what the switcher says', 'Close'),         // the list is out of date for this input
    sw(4, 'Input 4', 'A name that is far too long'),      // over 20 characters
    sw(5, 'Color Bars', 'Bars'),                          // made by the switcher, not a real input
    sw(0, 'Black', 'Dark'),                               // likewise
    { dir: 'out', port: 1, from: 'PGM out', to: 'Main' }, // outputs cannot be renamed from here
  ] }, { cookie });
  assert.equal(r.status, 200);
  const out = JSON.parse(r.text);
  assert.equal(out.done, 2);
  // Everything else is reported with a reason
  assert.deepEqual(out.failed.map(f => f.port).sort(), [0, 1, 2, 4, 5]);
  assert.deepEqual(app.atemCalls(), [
    { call: 'setInputSettings', props: { longName: 'Wide' }, input: 1 },
    { call: 'setInputSettings', props: { longName: 'Lyrics' }, input: 3 },
  ], 'only the long name is sent, and only for the inputs that passed every check');
  assert.deepEqual(app.rtr.state.writes, [], 'the router was not written to');

  const eng = await app.feed(cookie);
  assert.equal(eng.renames[0].dev, 'sw');
  assert.equal(eng.renames[0].changes.length, 2);

  // A switcher can accept a command and not apply it. That is reported, not counted as done.
  r = await app.post('/labels', { dev: 'sw', changes: [sw(2, 'Camera 2', 'IGNORED name')] }, { cookie });
  const ignored = JSON.parse(r.text);
  assert.equal(ignored.done, 0);
  assert.match(ignored.failed[0].why, /reports "Camera 2" instead/);

  // Undo is the same request the other way round
  r = await app.post('/labels', { dev: 'sw', undo: true, changes: eng.renames[0].changes.map(c => ({ dir: c.dir, port: c.port, from: c.to, to: c.from })) }, { cookie });
  assert.equal(JSON.parse(r.text).done, 2);
  assert.deepEqual(app.atemCalls().slice(-2), [
    { call: 'setInputSettings', props: { longName: 'Camera 1' }, input: 1 },
    { call: 'setInputSettings', props: { longName: 'Graphics' }, input: 3 },
  ]);
  assert.ok(app.atemCalls().every(c => c.call === 'setInputSettings' && Object.keys(c.props).join() === 'longName'), 'nothing but input names was ever sent to the switcher');
});
