// A stand-in for the atem-connection library, for the tests. There is no pretend ATEM to connect to, so the server is
// given this in place of the real library (see VENUE_ATEM_MODULE in server.js). It "connects" at once, holds input
// names, and writes every call it receives to a log file so a test can check exactly what the server asked for.
const { EventEmitter } = require('events');
const fs = require('fs');

const note = entry => { if (process.env.VENUE_TEST_ATEM_LOG) fs.appendFileSync(process.env.VENUE_TEST_ATEM_LOG, JSON.stringify(entry) + '\n'); };

class Atem extends EventEmitter {
  constructor() { super(); this.state = null; }
  connect() {
    const names = JSON.parse(process.env.VENUE_TEST_ATEM_INPUTS || '[]');
    this.state = { inputs: {}, video: { mixEffects: [{ programInput: 1, previewInput: 2, upstreamKeyers: {} }], downstreamKeyers: {} } };
    names.forEach((n, i) => { this.state.inputs[i] = { inputId: i, longName: n, shortName: n.slice(0, 4) }; });
    setTimeout(() => this.emit('connected'), 10);
    return Promise.resolve();
  }
  disconnect() { return Promise.resolve(); }
  // A real switcher can accept a command and still not apply it. A name starting "IGNORED" stands for that.
  setInputSettings(props, input) {
    note({ call: 'setInputSettings', props, input });
    if (!/^IGNORED/.test(props.longName || '')) { Object.assign(this.state.inputs[input], props); this.emit('stateChanged', this.state, []); }
    return Promise.resolve();
  }
}
// Anything else the server might call on a switcher is a mistake worth failing on
module.exports = { Atem: new Proxy(Atem, { construct(T, args) { return new Proxy(new T(...args), { get(o, k) { if (k in o || typeof k === 'symbol') return o[k]; if (k === 'then') return undefined; note({ call: String(k), unexpected: true }); throw new Error('The server called ' + String(k) + ' on the switcher, which the tests do not allow.'); } }); } }) };
