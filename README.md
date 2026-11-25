# Venue Router

A web console that shows what every screen in a building is displaying and traces each picture back to its source. It is built for a Blackmagic Videohub router and an ATEM switcher, and designed so volunteers can read it without understanding a routing table.

There is no installer yet. See [Download and install](#download-and-install) for the steps to set it up by hand.

**It is watch-only.** Nothing in this project sends a command that changes a device. Routers and switchers are only listened to, and recorders are only asked for their status. Changes made in the page are either refused (Live) or pretend (Sandbox).

## What it does

- **Overview**: says whether every screen matches a saved "Normal service", and lists the ones that differ.
- **Rooms**: groups of screens with one-tap presets such as "Lyrics on wall" and "IMAG".
- **System map**: every screen and the full chain feeding it: source, router, switcher, router again, screen. Select a screen to follow its picture from source to screen, or a source to see every screen it is on. It can also show every input and output of each device (see below).
- **Floor plan**: screens and equipment pinned on a plan of the building.
- **Full patch** (Engineer): every router output and what feeds it, plus naming problems worth a look.
- **Devices**: what is connected, where it is, and what each switcher mix is on.

### Volunteer and Engineer

The app opens in **Volunteer** view, which is a separate, much simpler interface:

- One status line: everything looks right, some screens are different, or equipment is not answering.
- A list of spaces. Tap one to see its screens.
- Inside a space: large quick-setting buttons, then each screen with what it is showing. Tap a screen to choose a source from a short list.
- "Put it back" appears only when something in view has been changed.

Volunteer view has no menu, map, port numbers, filters or search. If a floor plan has been set up, it is offered as one extra tile.

**Engineer** view is everything described above: the menu, System map, Floor plan setup, Full patch and Devices. "Engineer view" at the bottom of the Volunteer page switches to it, and the Volunteer / Engineer switch in the top bar switches back.

### Engineer PIN

Engineer view can be protected with a PIN of 4 to 8 digits. Set, change or remove it at the bottom of the **Spaces** page.

- With a PIN set, "Engineer view" asks for it. Switching back to Volunteer locks it again.
- The server enforces it. Without the PIN, saving spaces, visibility, devices, Normal service or the floor plan is refused, and so is searching the network.
- Device addresses are only sent to an unlocked Engineer view.
- Five wrong tries in a row pause PIN entry for 30 seconds.
- An unlocked session lasts up to 12 hours or until the server restarts.

Only a salted hash of the PIN is stored, in `auth.json` next to the server. If the PIN is forgotten, delete that file and restart the server.

What the PIN does not do: it does not hide what screens are showing, which every viewer can see, and it does not encrypt anything. The app is served over plain HTTP, so on a shared network the PIN could be read in transit. Keep the server on a network you trust.

### Working in one space

The **Space** selector in the top bar narrows the app to one room:

| View | With a space chosen |
|---|---|
| Overview | Becomes that room's control page: its status, screens, presets and source list |
| System map | "Room screens" shows only that room's screens |
| Floor plan, Full patch, Devices | Unchanged; these are whole-building views |

The choice is remembered per browser, so a tablet left in a room stays on that room. It is a filter, not a lock: anyone can pick another space.

In the sandbox, the reset button on the Overview puts back only the chosen space. With "All spaces" it resets everything.

### System map views

The **Show** selector on the System map chooses what is drawn:

| Show | What it draws |
|---|---|
| Room screens | The grouped screens and what feeds them |
| Every router output | All router outputs, traced through the switcher to their source |
| Router: inputs to outputs | The router by itself, each input joined to the outputs it feeds |
| Switcher: inputs to outputs | The switcher by itself |
| A room switcher: inputs to outputs | One entry per room listed in `venue.json` |

The first two views draw the whole chain in five columns: Sources, Router, Switcher, Router, Screens. The first Router column is the crosspoint that feeds the switcher, such as "Router in 41 → out 11". The second is the router input each screen is switched to, such as "Router in 10". A route that never touches the switcher skips the middle columns.

These controls go with it:

- **Include unused inputs** adds inputs that feed nothing, drawn as dashed boxes.
- **Named only** hides ports that still have a default label such as `RTR-OUT-83`.
- **The filter box** narrows the map by name.
- **Devices** hides the Router or Switcher columns when you only care about one of them.
- **Paths** keeps only routes that go through the switcher, or only routes that stay in the router.

The map is for looking, not routing. Selecting a port shows what it feeds or what feeds it.

### Following a signal path

Select a screen on the System map, or choose "Signal path" on any screen elsewhere in the app, to follow its picture:

- The route lights up on the map with moving arrows showing the direction of flow. You can also select a route by clicking its line.
- Every port on the way is on the map itself. The router boxes name their ports, and the selected switcher and screen boxes gain a second line with their port and room, such as "In 11 → out 10 · Rack Room".
- Selecting any box on the way, such as "Router in 2", shows every screen that passes through it.
- The top of the map card names what the screen is showing, with buttons to open its room or clear the selection, and lists any keys on air on its mix.

The **On now / Plumbing** switch chooses what "the path" means:

| | On now | Plumbing |
|---|---|---|
| Follows | The picture, through whatever the switcher is cut to | Only the fixed routing |
| Starts at | The camera or computer on air | The switcher mix |
| Changes when | Someone cuts a camera | Someone changes a route |

## Download and install

Use the installer for your computer. It carries everything the app needs, so there is nothing else to install first.

Get it from the [Releases page](https://github.com/willcgage/venue-router/releases/latest):

| Computer | File |
|---|---|
| Windows 10 or 11 | `VenueRouter-<version>-windows-x64-setup.exe` |
| Mac with Apple silicon | `VenueRouter-<version>-mac-arm64.pkg` |
| Mac with an Intel processor | `VenueRouter-<version>-mac-x64.pkg` |

Pick a computer that stays on and that can reach your devices on the ports listed under [What you need](#1-what-you-need).

### Windows

1. Run the setup file. Windows asks for an administrator, because the installer adds a start-up task and a firewall rule.
2. Leave **Let phones, tablets and other computers on the network open it** ticked, unless this is a booth computer nobody else connects to.
3. When it finishes, it opens the app at http://localhost:8787.

The installers are not signed yet. Windows may show "Windows protected your PC": choose **More info**, then **Run anyway**.

What it sets up:

- **The app** goes in `C:\Program Files\Venue Router`, with its own copy of Node.js.
- **Your setup** is kept apart in `C:\ProgramData\Venue Router`, so updating never touches it.
- **A "Venue Router" task** starts the app when Windows starts, before anyone signs in, and restarts it if it stops. It runs as the built-in Local Service account, which has no rights to the rest of the computer.
- **One firewall rule**, if you left the box ticked. It lets other devices reach this app only, on its port, on networks Windows treats as Private or Domain. If Windows treats your network as Public, other devices stay blocked until you change the network to Private or allow the port yourself.

To use another port, run the setup file from a terminal with `/PORT=9000`. To remove the app, use **Installed apps** in Windows Settings. Your setup is left in place.

**Moving from the install script.** If this computer already runs Venue Router from a downloaded folder with `install-windows.ps1`, just run the setup file. It stops the old copy, takes over its task, and copies your setup files from the old folder the first time. The old folder is left alone and can be deleted once you have checked the new one.

### Mac

1. Open the package. It is not signed yet, so macOS may refuse the first time: right-click it and choose **Open**, or allow it under **System Settings > Privacy & Security**.
2. Enter an administrator password when asked.
3. Open http://localhost:8787 on that Mac.

What it sets up:

- **The app** goes in `/Library/Application Support/Venue Router/app`, with its own copy of Node.js.
- **Your setup** is kept apart in `/Library/Application Support/Venue Router/data`. Reading it needs `sudo`.
- **A launch daemon** (`com.venuerouter`) starts the app when the Mac starts and restarts it if it stops. It runs as `nobody`, an account with no rights to the rest of the Mac.
- **Open to the network** on port 8787. To change that, edit `config.json` in the data folder and restart the Mac. If the macOS firewall is on, allow incoming connections for `node` when asked.

To remove it:

```bash
sudo "/Library/Application Support/Venue Router/app/uninstall.sh"
```

If this Mac already runs Venue Router from a downloaded folder, run `./install-mac.sh --uninstall` in that folder's `deploy` folder first, then copy your setup files into the data folder.

### First start

The first time, the app asks for the addresses of your main router and main switcher. It checks that both answer, and puts them the right way round if they were swapped. This page only works on the computer the app is installed on.

Then carry on from [Set it up](#6-set-it-up).

### Updating an installed copy

Download the newer installer and run it. Your setup is kept.

### Building the installers

The installers are built and tested by the **Installer packages** workflow in GitHub Actions. On every run it builds each one, installs it on a clean machine, checks that the app answers, installs it again over the top to check the setup survives, and uninstalls it. Pushing a version tag such as `v1.0.0` also attaches the three files to a release.

To build one yourself, on the kind of computer it is for:

```powershell
node deploy/build-package.js
```

The result goes in `dist`. The Windows build needs [Inno Setup 6](https://jrsoftware.org/isdl.php).

## Install by hand

These steps run the app straight from the source instead of from an installer. Use them to try a change, or on a system the installers do not cover. They take about ten minutes.

### 1. What you need

- **A computer that stays on**, running Windows 10 or 11 or macOS, on a network that can reach your devices.
- **[Node.js](https://nodejs.org/) 18 or later.** Install the LTS version, then open a new terminal window so it is picked up.
- **The addresses of your main router and main switcher**, such as `10.0.0.10` and `10.0.0.11`.
- **[Git](https://git-scm.com/)**, if you want to download with one command and update later. It is optional.

The computer must be able to reach these ports on your devices:

| Device | Port |
|---|---|
| Videohub router, ATEM switcher | TCP 9990 |
| ATEM switcher (mix, streaming and recording state) | UDP 9910 |
| HyperDeck recorder | TCP 9993 |
| Teranex converter | TCP 9800 |
| SmartView monitor | TCP 9992 |

### 2. Download it

With Git:

```powershell
git clone https://github.com/willcgage/venue-router.git
```

Without Git: on the [repository page](https://github.com/willcgage/venue-router), choose **Code**, then **Download ZIP**, and unzip it somewhere permanent, such as `C:\VenueRouter` or your home folder.

### 3. Install the libraries

In a terminal, inside the folder you downloaded:

```powershell
npm install
```

### 4. Start it once

```powershell
node server.js <router-ip> <switcher-ip>
```

Then open http://localhost:8787 on that computer. You should see the Volunteer page, with "No spaces yet".

The two addresses are saved in `venue.json`, so you only type them this once. If you leave them out, the app asks for them on a setup page instead. Stop the server with Ctrl+C before the next step.

If the page says it is still connecting, the computer cannot reach the router or the switcher. Check the addresses and the network.

### 5. Keep it running and open it to the network

Run the install script for your system, from the `deploy` folder.

**Windows**, in PowerShell:

```powershell
.\install-windows.ps1
```

If Windows says running scripts is disabled, run it this way instead, which allows this one script this one time:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

**Mac**, in Terminal:

```bash
./install-mac.sh
```

The script prints the addresses other devices can use. The options are described under [Keeping it running](#keeping-it-running).

### 6. Set it up

Do these on the computer that runs the app. Until a PIN is set, Engineer view only works there.

1. Open http://localhost:8787, choose **Engineer view**, go to **Spaces**, and set a PIN at the bottom.
2. Go to **Devices** and choose **Find devices** to add recorders, converters, monitors and room switchers.
3. Tell the app about your tie-lines by editing `ties` in `venue.json`, then restart. See [Set up your venue](#set-up-your-venue). Without this, paths are not followed through the switcher.
4. Go to **Spaces** and add your rooms and the screens in each.
5. During a service, when everything is set correctly, choose **Save as Normal service** on the Overview.

### Updating

With Git, inside the folder:

```powershell
git pull
```

```powershell
npm install
```

Then run the install script again. Your setup files are not touched.

Without Git, download the ZIP again into a new folder and copy your setup files across from the old one.

### Your setup files

Everything about your venue is in these files. An installed copy keeps them in its data folder (`C:ProgramDataVenue Router` on Windows, `/Library/Application Support/Venue Router/data` on a Mac). A copy installed by hand keeps them inside its own folder. None of them are part of the download, so back them up, and copy them to move to another computer:

`venue.json`, `spaces.json`, `prefs.json`, `floor.json`, `floor-image.bin`, `normal-service.json`

`auth.json` holds the PIN. Leave it behind when moving and set the PIN again.

### Trying it without installing

Steps 1 to 4 are enough to look around. Run that way, the app is only reachable from that computer and stops when you close the terminal.

## Keeping it running

This is step 5 of [Install by hand](#install-by-hand) in more detail. A copy put in by an installer already does all of this. To run all the time on a computer at the venue, use the install script for that computer. Each one installs the libraries, opens the app to the network, sets it to start by itself and restart if it stops, and prints the addresses to open.

**Windows 10 or 11**, in PowerShell from the `deploy` folder:

```powershell
.\install-windows.ps1
```

That runs the app whenever you sign in, with no administrator rights. Two options need an administrator PowerShell:

- `-AtStartup` starts it when Windows starts, before anyone signs in. Use it on a computer nobody signs in to. It runs as the SYSTEM account.
- `-OpenFirewall` adds a Windows Firewall rule so other devices on Domain and Private networks can reach it.

**Mac**, in Terminal from the `deploy` folder:

```bash
./install-mac.sh
```

That runs the app whenever you log in, with no administrator password. If macOS asks whether to let `node` accept incoming connections, choose Allow.

Both scripts accept a local-only option (`-LocalOnly` or `--local-only`) for a booth computer nobody else connects to, a port option, and an uninstall option (`-Uninstall` or `--uninstall`) that leaves your setup files alone.

### After installing

1. On that computer, open http://localhost:8787, switch to Engineer view, go to Spaces and set a PIN.
2. From a tablet or another computer, open the address the script printed.

Until a PIN is set, Engineer view only works on the computer running the app. Other devices can watch but cannot change the setup. That makes it safe to open the app to the network first and choose the PIN second.

### Things to know

- **Run one copy.** Spaces, the PIN, the floor plan and Normal service are files in this folder, so two computers running the app have two separate setups. Run a second copy only as a spare.
- **The log** is `logs/venue-router.log`. It records start-up, devices that stop or start answering, and PIN changes.
- **`config.json`** holds the listening address and port. The scripts write it, and it is not tracked by git.
- **No encryption.** The app is served over plain HTTP. Keep it on networks you trust.
- **Updating:** pull the new version into the folder, then run the install script again.

## Live and Sandbox

| Mode | What it shows | Changes |
|---|---|---|
| Live | The hardware, updated as it changes | Refused |
| Sandbox | The hardware as it was when you opened the sandbox | Pretend, discarded when you return to Live |

## Set up your venue

Nothing about a venue lives in the code. Everything is in files next to the server that are not tracked by git, so each venue keeps its own and the repository holds none.

`venue.json` describes the building. The server creates it the first time the Devices page saves a change, and writes most of it for you. A few parts are still edited by hand. `venue.example.json` shows the shape:

```json
{
  "places": { "rtr": "Rack Room", "sw": "Rack Room" },
  "core": { "router": "10.0.0.10", "switcher": "10.0.0.11" },
  "ties": { "routerToSwitcher": 20, "switcherToRouter": 8 },
  "common": [],
  "niceNames": { "out": {}, "src": {}, "mix": {} },
  "rooms": [{ "id": "room-chapel", "place": "Chapel", "ip": "10.0.0.50" }],
  "links": [{ "room": "room-chapel", "rtrOut": 15, "input": null }]
}
```

Written by the Devices page:

- `places`: where the router (`rtr`) and switcher (`sw`) are.
- `core`: the addresses of the main router and main switcher, used when none are given on the command line.
- `rooms`, `decks`, `convs`, `mons`: room switchers, recorders, converters and monitors, with their cabling.

Edited by hand:

- `ties`: the tie-lines between router and switcher. `routerToSwitcher: 20` means router outputs 1 to 20 feed switcher inputs 1 to 20. `switcherToRouter: 8` means switcher outputs 1 to 8 feed router inputs 1 to 8. Without this, paths are not traced through the switcher.
- `common`: the router inputs (counted from 0) offered first when choosing a source. Left empty, the first 16 named inputs are used.
- `niceNames`: optional friendlier names for router outputs (`out`, by number counted from 0), sources (`src`, by label) and switcher mixes (`mix`, by number). With any set, Engineer view gets a "Nice names" switch.
- `links`: which router output (counted from 0) feeds a room, and which input on that room's switcher it lands on. Use `null` if unknown.

Restart the server after editing `venue.json` by hand.

### Devices

The **Devices** page in the Engineer menu is where the app's routers and switchers are managed:

- **Find devices on the network** asks every address on a network who it is and lists the Blackmagic routers and switchers that answer. It reads each device's greeting and sends nothing else. Only private network ranges can be searched.
- **Add a device by address** adds one directly. The server checks that a router or switcher answers there first.
- Each device has a "Where it is" box, and room devices have a Remove button. Removing a device only takes it out of the app.

A device is added in one of three ways:

| Added as | What it means |
|---|---|
| Room switcher or extra device | Shown as its own space and in the System map's device views. Paths are not traced through it. |
| Main router | Replaces the current main router. |
| Main switcher | Replaces the current main switcher. |
| Recorder (HyperDeck) | Watched for recording status and disk space. See below. |
| Converter (Teranex) | Watched for its conversion and input signal, and traced through. See below. |
| Monitor (SmartView) | Tied to the router output that feeds it, and watched for which input it is on. See below. |

### Streaming and recording on a room switcher

A room switcher that is an ATEM with streaming built in, such as an ATEM Mini Pro, also reports:

- Whether it is streaming, connecting or stopped, the service it is set up for, and the bitrate while live.
- Whether it is recording, and whether a disk is attached.

This shows on the room's tile and page for volunteers, on the Overview and room page for engineers, and on the Devices page. Changes are added to Recent changes.

The state comes over the ATEM protocol on a second connection to that switcher, which only listens. The stream address and stream key are never read out of the switcher's state, so they are never sent to a browser.

A stream that leaves through a separate encoder is not covered. A Resi encoder, for example, reports nothing on the local network.

### Recorders

A HyperDeck added on the Devices page is watched over its own protocol (TCP 9993):

- Wherever its input appears in the app, the row says whether it is recording and how much disk time is left. Volunteers see this too.
- A path that comes back from the recorder ends at "playback", so a screen on a recorder's output reads as that recorder playing back.
- The Devices page shows each recorder's model, name, disk and state.

The app needs to know two things about each recorder's cabling: the router output it records from, and the router inputs it plays back on. When a recorder is added, these are guessed from router labels such as `REC-IN-01` and `REC-OUT-01-1`, and can be corrected on the Devices page.

### Converters

A Teranex added on the Devices page is watched over its own protocol (TCP 9800), listen only:

- A path that comes back from a converter carries on through it, to whatever is feeding the converter's selected input. The System map draws the converter in the middle column.
- A selected path says what the converter is doing, such as "1080p59.94 to 2160p59.94", and whether it has a signal on its input.
- A converter with no input signal, or with a test pattern switched on, is listed under "Worth a look" on the Full patch page.

This is the one place the app knows whether a picture is really present, because a Teranex reports it. Routers and switchers do not.

The app needs each converter's cabling: the router outputs that feed its inputs, in order with SDI 1 first, and the router inputs it returns on. These are guessed from labels such as `TRNX-IN-1A` and `TRNX-OUT-1A` and can be corrected on the Devices page. A converter set to an input that is not cabled through the router, such as HDMI, ends the path there.

### Monitors

A SmartView added on the Devices page is watched over its own protocol (TCP 9992), listen only:

- The router output that feeds it is marked with the monitor's name, so a path ends at a real monitor and not only a router port.
- If the monitor is switched to a different input from the one that feed arrives on, the row says so. This catches "the router is right but the monitor is on the wrong input".
- The Devices page shows each monitor's model, name, selected input, brightness and tally border.

The app needs to know which router outputs feed each monitor, in order with SDI 1 first. This is guessed from the monitor's name: a monitor named `MON-12` matches a router label such as `MON 12`. It can be set on the Devices page when there is no match.

A HyperDeck reports nothing unless asked, so for recorders the server sends status questions and a request to be told about changes. It never sends record, play or stop.

The app traces paths through one main router and one main switcher. Spaces, presets and Normal service refer to the main router's port numbers, so replacing it usually means setting those up again.

### Spaces

Spaces are the rooms volunteers see, each with its screens and quick settings. An engineer sets them up in the app, under **Spaces** in the Engineer menu:

- Rename a space, reorder spaces, add a new one or delete one.
- Add any router output to a space as a screen, or remove one.
- Delete a quick setting, and choose whether a space asks before changing.
- Choose what volunteers can see: each space has a "Volunteers can see this space" box, and a section at the bottom covers rooms with their own switcher, the floor plan, and the router and switcher pins on it. Engineers always see everything.

Changes are saved on the server in `spaces.json` (and `prefs.json` for the visibility choices) as they are made, and every open copy of the app picks them up, including the Volunteer view. Quick settings saved from a space's page are stored there too, so they survive a reload.

A new install has no spaces. Volunteers see "No spaces yet" until an engineer adds the first one.

## Normal service and the floor plan

- **Normal service**: in Live mode as an Engineer, choose "Save as Normal service" on the Overview when everything is set correctly. It records routes only, not which camera is on each mix.
- **Floor plan**: as an Engineer, open Floor plan, choose Arrange, add a plan image (PNG, JPEG or WebP up to 8 MB), then place each screen.

Both are saved as local files next to the server (`normal-service.json`, `floor.json`, `floor-image.bin`). Like `spaces.json`, they are not tracked by git, so back them up separately.

## Offline snapshot

`capture.js` reads the devices once and writes `venue-snapshot.html`, a copy of the app with that snapshot inside it. It can be opened or shared without the server:

```powershell
node capture.js <router-ip> <switcher-ip>
```

The addresses can be left off when `venue.json` already holds them. Opened this way the page behaves like a sandbox on that snapshot.

`venue-snapshot.html` contains your device labels and spaces. It is not tracked by git, and `venue-router.html` itself never holds any venue data: the server puts the current state into the page at the moment it serves it.

## Files

| File | Purpose |
|---|---|
| `server.js` | Watches the devices and serves the live page |
| `venue-router.html` | The whole interface, in one file |
| `capture.js` | Writes an offline copy of the app with a snapshot inside it |
| `atem-read.js` | Reads the ATEM's mix state once, used by `capture.js` |
| `venue.example.json` | The shape of `venue.json`, with made-up addresses |
| `data-dir.js` | Says where the setup files are kept |
| `deploy/` | Install scripts for Windows and Mac, and what builds the installers |
| `.github/workflows/package.yml` | Builds and tests the installers |

Created on each computer and not tracked: `venue.json`, `spaces.json`, `prefs.json`, `auth.json`, `floor.json`, `floor-image.bin`, `normal-service.json`, `config.json`, `logs/`, `venue-snapshot.html`.

## How it reads the hardware

- **Routes, labels and locks** come from the Videohub Ethernet Protocol on TCP 9990. The ATEM Constellation and ATEM Mini Pro answer this protocol too, which exposes their output routing.
- **Streaming and recording state** of a room switcher comes from the same ATEM protocol, on a listen-only connection.
- **Recorder state** comes from the HyperDeck Ethernet Protocol on TCP 9993, using status queries and change notifications only.
- **Converter state** comes from the Teranex Ethernet Protocol on TCP 9800, listen only.
- **Monitor state** comes from the SmartView Ethernet Protocol on TCP 9992, listen only.
- **Mix state** (what is on each M/E, and which keys are on air) comes from the ATEM's own protocol through the [atem-connection](https://www.npmjs.com/package/atem-connection) library.

## Known limits

- It cannot tell whether a picture is actually present, only how things are routed. The exception is the input of a Teranex converter.
- On the System map, a path that goes through both a converter and the switcher shows the converter but not the switcher. The heading above the map still names the true source.
- Clean feeds are not traced back to a mix.
- Downstream keys are listed as on air but not tied to a particular mix.
- Until a PIN is set, anyone at the computer running the app can use Engineer view. There are no individual accounts, so the PIN is shared.
- One floor plan only.
- Plumbing stops at a switcher mix; it does not draw the inputs available to that mix.
- The System map's device views show one device at a time; only the first two views trace across the router and switcher together.
- It has not been observed reacting to a route change made on the hardware during a service.

## Licence

Venue Router is released under the [MIT licence](LICENSE). You are free to use it, change it and share it. It comes with no warranty.

The installers include a copy of Node.js, which has its own licence (`NODE-LICENSE.txt` in the installed folder). Blackmagic Design, ATEM, Videohub, HyperDeck, Teranex and SmartView are trademarks of Blackmagic Design. This project is not affiliated with or endorsed by them.
