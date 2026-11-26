// A small made-up venue shared by the tests: a 16x16 router tied to a switcher, one recorder and one converter.
// Port numbers in comments are as people say them (from 1); the arrays count from 0.
const pad = (list, n, make) => list.concat(Array.from({ length: n - list.length }, (_, i) => make(list.length + i + 1)));

const router = () => ({
  name: 'TEST-RTR',
  inL: pad([
    'SW Out 1 - PGM out',        // 1  back from switcher output 1
    'SW Out 2',                  // 2  back from switcher output 2, not described
    '3: Podium',                 // 3
    'RTR-IN-4 Stage camera',     // 4  already in the standard style
    'Playback 2 (Not Working)',  // 5
    'RTR-IN-6',                  // 6  plate name only
    'REC-OUT-01-1',              // 7  recorder playback
    'TRNX-OUT-1A',               // 8  converter return
    'Camera A',                  // 9
  ], 16, n => 'RTR-IN-' + n),
  outL: pad([
    'SW IN 1 - Camera 1',        // 1  to switcher input 1
    'Camera 2',                  // 2  to switcher input 2, named without the switcher port
    'SW IN 3 - Gfx',             // 3  to switcher input 3, which the switcher calls Graphics
    'SW IN 4',                   // 4  to switcher input 4, not described
    'REC-IN-01',                 // 5  recorder input
    'TRNX-IN-1A',                // 6  converter input
    'Lobby TV',                  // 7
    '8: Foyer',                  // 8
    'Green Room',                // 9
  ], 16, n => 'RTR-OUT-' + n),
  // out 1 <- Camera A, out 2 <- Stage camera, out 3 <- Podium, out 5 and 7 <- switcher out 1,
  // out 8 <- Camera A direct, out 9 <- switcher out 2, everything else <- in 16
  route: [8, 3, 2, 15, 0, 15, 0, 8, 1, 15, 15, 15, 15, 15, 15, 15],
});

const switcher = () => ({
  name: 'TEST-SW',
  inL: ['Black', 'Camera 1', 'Camera 2', 'Graphics', 'Input 4', 'Color Bars', 'ME 1 PGM', 'ME 1 PVW'],
  outL: ['PGM out', 'Output 2'],
  // output 1 <- ME 1 PGM (made in the switcher), output 2 <- input 1 (Camera 1)
  route: [6, 1],
});

const ties = { routerToSwitcher: 4, switcherToRouter: 2 };
const spaces = () => [{ id: 'lobby', name: 'Lobby', dests: [6, 7, 8], confirm: false, hidden: false, modes: [] }];
const ports = () => ({ plates: { in: 'RTR-IN-{n}', out: 'RTR-OUT-{n}' }, rtr: { in: { 5: { connected: 'Handheld camera', notes: 'engineers only' } }, out: {} } });

// What the page is given, in snapshot form. deviceLinks adds a recorder and a converter with their cabling set.
function snapshot({ deviceLinks = true, withPorts = true } = {}) {
  const r = router(), s = switcher();
  return {
    taken: '2026-01-01T00:00:00.000Z', version: '0.0.0',
    rtr: { model: 'Pretend Videohub', name: r.name, inL: r.inL, outL: r.outL, route: r.route, lock: r.route.map(() => false) },
    sw: { model: 'Pretend Switcher', name: s.name, inL: s.inL, outL: s.outL, route: s.route, lock: [false, false], mix: null },
    conn: { rtr: true, sw: true, mix: false }, normal: null, pin: false,
    places: { rtr: 'Rack', sw: 'Rack' }, links: [], addr: {}, ties, common: null, names: null,
    floor: { pins: {}, hasImage: false, v: 0 }, spaces: spaces(), prefs: { hideRooms: [], hideFloor: false, hideGear: false },
    ports: withPorts ? ports() : undefined, renames: [],
    decks: [{ id: 'rec-1', place: 'Rack', name: 'REC-A', model: 'Pretend Deck', feed: deviceLinks ? 4 : null, returns: deviceLinks ? [6] : [], status: 'stopped', up: true }],
    convs: [{ id: 'conv-1', place: 'Rack', name: 'CONV-A', model: 'Pretend Converter', feeds: deviceLinks ? [5] : [], returns: deviceLinks ? [7] : [], src: 'SDI1', inMode: '1080p60', outMode: '1080p60', signal: true, up: true }],
    mons: [], ndis: [], rooms: [],
  };
}

module.exports = { router, switcher, ties, spaces, ports, snapshot };
