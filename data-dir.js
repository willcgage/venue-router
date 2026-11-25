// Where this copy keeps what it saves: the venue setup, spaces, floor plan, PIN, config.json and logs.
// By default that is the app's own folder. The installer packages keep it apart from the program files, so an
// update never touches it, by starting the app with --data=<folder> (or VENUE_ROUTER_DATA in the environment).
const path = require('path');
const flag = process.argv.find(a => a.startsWith('--data='));
const DATA = path.resolve(flag ? flag.slice(7) : process.env.VENUE_ROUTER_DATA || __dirname);
// The command line without options: [router-ip, switcher-ip]
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
module.exports = { DATA, args, file: name => path.join(DATA, name) };
