// Builds the installer package for the computer this runs on.
//   Windows:  dist/VenueRouter-<version>-windows-x64-setup.exe   (needs Inno Setup 6)
//   Mac:      dist/VenueRouter-<version>-mac-<arm64|x64>.pkg      (uses pkgbuild, which comes with macOS)
// Usage: node deploy/build-package.js
//
// The package carries everything the app needs, including this computer's copy of Node.js, so the computer it is
// installed on needs nothing else. It carries no venue data: only the files listed below go in.
// Build each package on its own kind of computer, because one of the libraries has a part made for each system.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync, spawn } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const stage = path.join(dist, 'stage');
const version = require(path.join(root, 'package.json')).version;
const win = process.platform === 'win32', mac = process.platform === 'darwin';
const inCI = !!process.env.CI;

// Everything that goes into the package. Nothing else in the folder is ever included.
const APP_FILES = ['server.js', 'data-dir.js', 'capture.js', 'atem-read.js', 'venue-router.html', 'venue.example.json', 'package.json', 'package-lock.json', 'README.md'];

const say = msg => console.log(msg);
const run = (cmd, argv, opts) => execFileSync(cmd, argv, { stdio: 'inherit', ...opts });
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let text = ''; res.setEncoding('utf8'); res.on('data', d => (text += d)); res.on('end', () => resolve(text));
    }).on('error', reject).setTimeout(20000, function () { this.destroy(new Error('timed out')); });
  });
}

// Starts the staged app exactly as the installed one will run and checks that it serves its first-time setup page.
function smokeTest() {
  return new Promise((resolve, reject) => {
    const data = fs.mkdtempSync(path.join(require('os').tmpdir(), 'venue-router-test-'));
    const port = 20000 + Math.floor(Math.random() * 20000);
    const node = path.join(stage, win ? 'node.exe' : 'node');
    const child = spawn(node, ['server.js', '--data=' + data], { cwd: stage, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', done = false;
    const finish = err => { if (done) return; done = true; child.kill(); try { fs.rmSync(data, { recursive: true, force: true }); } catch (e) {} err ? reject(new Error(err + '\n' + out)) : resolve(); };
    child.stdout.on('data', d => (out += d)); child.stderr.on('data', d => (out += d));
    child.on('exit', code => finish('The packaged app stopped by itself (exit ' + code + ').'));
    let tries = 0;
    const poll = () => {
      require('http').get({ host: '127.0.0.1', port, path: '/' }, res => {
        let body = ''; res.on('data', d => (body += d));
        res.on('end', () => (res.statusCode === 200 && body.includes('Set up Venue Router') ? finish() : finish('The packaged app answered, but not with its setup page.')));
      }).on('error', () => (++tries > 40 ? finish('The packaged app never answered.') : setTimeout(poll, 250)));
    };
    setTimeout(poll, 300);
  });
}

function findInnoSetup() {
  const names = [
    process.env.ISCC,
    path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles || '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  ].filter(Boolean);
  return names.find(f => fs.existsSync(f)) || null;
}

(async () => {
  if (!win && !mac) { console.error('Packages are built on Windows or on a Mac.'); process.exit(1); }
  say(`Building Venue Router ${version} for ${win ? 'Windows' : 'Mac'} (${process.arch}), with Node.js ${process.version}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  for (const f of APP_FILES) copy(path.join(root, f), path.join(stage, f));
  if (win) {
    copy(path.join(root, 'deploy', 'windows', 'run.cmd'), path.join(stage, 'run.cmd'));
    copy(path.join(root, 'deploy', 'windows', 'service.ps1'), path.join(stage, 'deploy', 'windows', 'service.ps1'));
    // Batch files need Windows line endings whatever the checkout used
    const cmd = path.join(stage, 'run.cmd');
    fs.writeFileSync(cmd, fs.readFileSync(cmd, 'utf8').replace(/\r?\n/g, '\r\n'));
  } else {
    copy(path.join(root, 'deploy', 'mac', 'uninstall.sh'), path.join(stage, 'uninstall.sh'));
    fs.chmodSync(path.join(stage, 'uninstall.sh'), 0o755);
  }

  say('Installing the libraries...');
  require('child_process').execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: stage, stdio: 'inherit' });

  // The app runs on this exact copy of Node.js, so the computer it is installed on needs none of its own.
  const node = path.join(stage, win ? 'node.exe' : 'node');
  fs.copyFileSync(process.execPath, node);
  if (!win) fs.chmodSync(node, 0o755);
  try {
    fs.writeFileSync(path.join(stage, 'NODE-LICENSE.txt'), await fetchText(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`));
  } catch (e) {
    const msg = 'Could not fetch the Node.js licence text that has to ship with it: ' + e.message;
    if (inCI) { console.error(msg); process.exit(1); }
    say('Warning: ' + msg + '. Do not hand this build to anyone else.');
  }

  say('Checking that the packaged app starts...');
  await smokeTest();
  say('It starts and shows its setup page.');

  if (win) {
    const iscc = findInnoSetup();
    if (!iscc) {
      const msg = 'Inno Setup 6 was not found, so the setup program was not made. The files it would install are in ' + stage;
      if (inCI) { console.error(msg); process.exit(1); }
      say(msg); say('Install Inno Setup 6 from https://jrsoftware.org/isdl.php and run this again, or let the GitHub workflow build it.');
      return;
    }
    run(iscc, ['/Qp', '/DAppVersion=' + version, '/DStage=' + stage, '/DOutDir=' + dist, path.join(root, 'deploy', 'windows', 'venue-router.iss')]);
    say('Made ' + path.join(dist, `VenueRouter-${version}-windows-x64-setup.exe`));
  } else {
    const pkgRoot = path.join(dist, 'pkgroot'), scripts = path.join(dist, 'pkgscripts');
    fs.rmSync(pkgRoot, { recursive: true, force: true }); fs.rmSync(scripts, { recursive: true, force: true });
    const appDir = path.join(pkgRoot, 'Library', 'Application Support', 'Venue Router', 'app');
    fs.mkdirSync(path.dirname(appDir), { recursive: true });
    run('ditto', [stage, appDir]);
    copy(path.join(root, 'deploy', 'mac', 'com.venuerouter.plist'), path.join(pkgRoot, 'Library', 'LaunchDaemons', 'com.venuerouter.plist'));
    for (const s of ['preinstall', 'postinstall']) {
      const to = path.join(scripts, s);
      fs.mkdirSync(scripts, { recursive: true });
      fs.writeFileSync(to, fs.readFileSync(path.join(root, 'deploy', 'mac', 'scripts', s), 'utf8').replace(/\r\n/g, '\n'));
      fs.chmodSync(to, 0o755);
    }
    const out = path.join(dist, `VenueRouter-${version}-mac-${process.arch}.pkg`);
    run('pkgbuild', ['--root', pkgRoot, '--scripts', scripts, '--identifier', 'com.venuerouter', '--version', version, '--ownership', 'recommended', '--install-location', '/', out]);
    say('Made ' + out);
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });
