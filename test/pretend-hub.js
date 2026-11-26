// A pretend Videohub for the tests. It speaks enough of the Videohub Ethernet Protocol to stand in for a router or
// for a switcher's routing port: a status dump on connect, and label changes answered with ACK and reported back
// to every client. Nothing here ever talks to real hardware.
const net = require('net');

function startHub({ name, inL, outL, route }) {
  const state = { inL: inL.slice(), outL: outL.slice(), route: route.slice(), writes: [] };
  const clients = new Set();
  const block = (head, list) => head + ':\n' + list.map((l, i) => i + ' ' + l).join('\n') + '\n\n';
  const server = net.createServer(s => {
    clients.add(s);
    s.on('close', () => clients.delete(s));
    s.on('error', () => {});
    s.write('PROTOCOL PREAMBLE:\nVersion: 2.8\n\nVIDEOHUB DEVICE:\nDevice present: true\nModel name: Pretend Videohub\nFriendly name: ' + name
      + '\nVideo inputs: ' + state.inL.length + '\nVideo outputs: ' + state.outL.length + '\n\n'
      + block('INPUT LABELS', state.inL) + block('OUTPUT LABELS', state.outL)
      + 'VIDEO OUTPUT LOCKS:\n' + state.route.map((_, i) => i + ' U').join('\n') + '\n\n'
      + block('VIDEO OUTPUT ROUTING', state.route) + 'END PRELUDE:\n\n');
    let buf = '';
    s.on('data', d => {
      buf += d.toString('utf8').replace(/\r/g, '');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const lines = buf.slice(0, i).split('\n').filter(Boolean);
        buf = buf.slice(i + 2);
        const head = (lines[0] || '').replace(/:$/, '');
        state.writes.push(head);
        const target = head === 'INPUT LABELS' ? state.inL : head === 'OUTPUT LABELS' ? state.outL : null;
        if (!target || lines.length < 2) { s.write('NAK\n\n'); continue; }
        const changed = [];
        for (const l of lines.slice(1)) {
          const m = l.match(/^(\d+) (.*)$/);
          if (m && +m[1] < target.length) { target[+m[1]] = m[2]; changed.push(+m[1]); }
        }
        s.write('ACK\n\n');
        const report = head + ':\n' + changed.map(p => p + ' ' + target[p]).join('\n') + '\n\n';
        for (const c of clients) c.write(report);
      }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    state,
    close: () => new Promise(done => { for (const c of clients) c.destroy(); server.close(() => done()); }),
  })));
}

module.exports = { startHub };
