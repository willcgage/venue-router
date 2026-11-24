// Read-only: connects to the ATEM, reads its state once, disconnects. Sends no commands.
const { Atem } = require('atem-connection');
const ip = process.argv[2];
const atem = new Atem();
const timer = setTimeout(() => { console.error('Timed out connecting to ' + ip); process.exit(1); }, 15000);
atem.on('error', e => console.error(String(e)));
atem.on('connected', async () => {
  clearTimeout(timer);
  const s = atem.state;
  const name = id => (s.inputs[id] ? s.inputs[id].longName : 'Source ' + id);
  const src = id => ({ id, name: name(id) });
  const out = {
    model: s.info.productIdentifier,
    me: s.video.mixEffects.filter(Boolean).map(m => ({
      pgm: src(m.programInput), pvw: src(m.previewInput),
      keys: Object.values(m.upstreamKeyers || {}).filter(Boolean).map(k => ({ n: k.upstreamKeyerId + 1, onAir: !!k.onAir, fill: src(k.fillSource) })),
    })),
    dsk: Object.values(s.video.downstreamKeyers || {}).filter(Boolean).map((k, i) => ({ n: i + 1, onAir: !!k.onAir, fill: k.sources ? src(k.sources.fillSource) : null })),
  };
  console.log(JSON.stringify(out));
  await atem.disconnect();
  process.exit(0);
});
atem.connect(ip);
