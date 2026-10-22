# Switch Botbase MCP

[![CI](https://github.com/makp0/switch-botbase-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/makp0/switch-botbase-mcp/actions/workflows/ci.yml)

Let an AI see and control a USB-connected Nintendo Switch through
[USB Botbase](https://github.com/Koi-3088/usb-botbase). Built with **Bun and
TypeScript**, using the MCP SDK and native USB access. No Python bridge,
network service, or AI API key is required by this server. Your MCP client
supplies the AI; use a model/client that can view image tool results.

## Set up the Switch

Requires a Switch running compatible custom firmware with USB Botbase installed,
enabled, and configured for `usb` mode. Connect it with a data-capable USB cable.
This server targets USB Botbase's device `057e:3000`; it does not install firmware
or connect over Wi-Fi.

**Recommended installer: [switchpack](https://github.com/makp0/switchpack)**,
a declarative homebrew installer with pinned versions, checksums, and USB MTP or
mounted-SD installation. Use a switchpack version with **sysmodule package and
7z support** and follow its USB Botbase manifest instructions. Older versions
restricted to `switch/` cannot install Botbase; upgrade when those features are
available. Alternatively, use the
[upstream Botbase installation instructions](https://github.com/Koi-3088/usb-botbase#installation).
Reboot after enabling the sysmodule, leave any MTP responder, and close other
Botbase clients before connecting this server.

## Install the server

Requires [Bun](https://bun.sh) 1.3.14+ and Git:

```sh
git clone https://github.com/makp0/switch-botbase-mcp.git
cd switch-botbase-mcp
bun install --frozen-lockfile
bun run typecheck
bun test
```

Native USB binaries come from the `usb` dependency. macOS USB control was tested
on Apple silicon with Bun 1.3.14 and USB Botbase 2.5. CI checks macOS and Linux
without a console; other hardware/OS combinations remain unverified.

## Connect your AI client

The client launches the server over **stdio**. Run the TypeScript source directly;
no build step is needed. Use absolute paths for both Bun and the entry point,
especially for desktop apps with a different PATH. Find Bun's actual executable
with `bun -e 'console.log(process.execPath)'`.

For clients using `mcpServers` JSON, merge this into their configuration:

```json
{
  "mcpServers": {
    "switch": {
      "command": "/absolute/path/to/bun",
      "args": ["/absolute/path/to/switch-botbase-mcp/src/index.ts"]
    }
  }
}
```

For Codex, add this to the Nintendo Switch project's `.codex/config.toml`:

```toml
[mcp_servers.switch]
command = "/absolute/path/to/bun"
args = ["/absolute/path/to/switch-botbase-mcp/src/index.ts"]
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Open a new Codex session in that project after saving the configuration. See
the [official MCP configuration docs](https://developers.openai.com/codex/mcp).
The client should discover four tools:

| Tool | Purpose |
| --- | --- |
| `switch_status` | Connect and read Botbase's version. |
| `switch_screenshot` | Return the current screen as a JPEG image. |
| `switch_act` | Run timed button chords, stick movements, and waits; return a screenshot by default. |
| `switch_stop` | Cancel running/queued actions and detach the virtual controller. |

Try: “Take a screenshot of my Switch and describe what is selected.”
Then: “Move the HOME selection one tile right, check it, and move it back.”

## Actions and key combinations

Example `switch_act` arguments to open a Tesla-style overlay with
**L + right-stick press + D-pad down** (your overlay may use another shortcut):

```json
{
  "actions": [
    { "type": "buttons", "buttons": ["L", "RSTICK", "DDOWN"], "durationMs": 200 }
  ],
  "settleMs": 500,
  "screenshot": true
}
```

Buttons in one action form a **chord**: each is pressed while previous buttons
remain held, then all are released. Separate actions run in order. `LSTICK` and
`RSTICK` mean clicking the sticks; they are different from moving a stick.
Botbase processes commands sequentially, so chord presses have a small stagger.

Supported buttons: `A`, `B`, `X`, `Y`, `L`, `R`, `ZL`, `ZR`, `PLUS`, `MINUS`,
`DUP`, `DDOWN`, `DLEFT`, `DRIGHT`, `LSTICK`, `RSTICK`, `HOME`, `CAPTURE`.

Example movement and a wait:

```json
{
  "actions": [
    { "type": "stick", "stick": "LEFT", "x": 32767, "y": 0, "durationMs": 500 },
    { "type": "wait", "durationMs": 300 }
  ]
}
```

Stick coordinates are signed integers from -32768 to 32767. Positive X moves
right; positive Y moves up. Sticks return to center after each action.
Buttons default to 100ms; sticks default to 200ms. Button/stick durations are
50–5000ms; waits are 0–5000ms. Each call accepts 1–30 actions with at most
15 seconds of requested duration. USB/Botbase processing adds latency.
`settleMs` waits 0–2000ms before the optional screenshot (default 250ms).

Prefer short observe → act → observe loops. The server exposes controller
operations, not an autonomous game-playing model, and does not expose memory
read/write commands. AI actions operate a real console; review consequential
actions like purchases, deletions, and save changes.

## Verification and recovery

`bun test` uses simulated USB and MCP transports and does not touch a console.
Hardware tests are explicitly enabled:

```sh
# Read version and capture a screenshot through the real stdio MCP server.
SWITCH_HARDWARE_TEST=1 bun test test/hardware.test.ts

# Only with HOME visible: move right once, then restore left and call stop.
SWITCH_HARDWARE_TEST=1 SWITCH_CONTROL_TEST=1 bun test test/hardware.test.ts
```

Optionally set `SWITCH_SCREENSHOT_PATH=/absolute/path/screen.jpg` to save test
images. Control testing also saves `.right.jpg` and `.restored.jpg` images.
Live verification on 2026-10-22 confirmed version 2.5, JPEG screenshots,
right/left HOME navigation, and stop. Chord and cancellation behavior are
covered by simulated tests; overlay shortcuts were not tested on hardware.
Long-running gameplay stability has not been established.

All tool calls share one queue to prevent interleaved USB frames. Stop aborts
active waits and queued operations, releases active inputs, then detaches the
controller. Cancellation takes effect between transfers; each transfer times
out after five seconds. Graceful shutdown releases/detaches inputs too.

A USB/protocol error faults the connection and never replays an input. Check
the console and restart the server before proceeding; stale USB replies may
require restarting Botbase/the console. If the cable is disconnected or the
process is force-killed, cleanup cannot be guaranteed. Reconnect and use stop;
check the Switch directly if inputs remain held.

If no device is found, check the cable, module boot flag, USB mode, and competing
clients. Linux may need a udev rule granting your user/group access to
`057e:3000`; consult [node-usb's setup guide](https://github.com/node-usb/node-usb).
Windows may require WinUSB via Zadig and has not been tested here.

## Releases

CI runs typechecking and tests on macOS and Linux for main, PRs, and `v*` tags.
Push a version tag after updating `package.json` and `bun.lock`:

```sh
git tag v0.1.0
git push origin v0.1.0
```

After checks pass, CI creates a GitHub release with generated notes and GitHub's
source archives. Install releases from source with Bun as above. Standalone
binaries are not distributed because the USB native addon must remain available
for the host platform. The project is MIT licensed; dependencies retain their
own licenses (including libusb's LGPL license).
