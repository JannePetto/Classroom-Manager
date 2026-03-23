# Classroom Device Dashboard

Classroom Device Dashboard is a teacher-facing web dashboard plus a Windows classroom agent for student devices. The dashboard handles sign-in, class management, restrictions, live device status, and teacher actions, while each student device connects back to the dashboard over WebSocket.

## Features

- Live device list with online state, battery, activity, and recent history
- Screen-share sessions with live previews and remote input controls
- Class-based and per-device program/website restrictions
- Teacher announcements, picture overlays, and blackout controls
- Power actions such as lock, restart, and shutdown
- Admin accounts, teacher accounts, classes, and shared restriction presets
- UDP dashboard discovery so agents can find the teacher machine on the local network

## Tech Stack

- Dashboard: Node.js, Express, `ws`
- Agent: Python, `websockets`, Tkinter, Windows APIs

## Repository Layout

```text
.
|-- docs/
|-- master/
|   |-- package.json
|   |-- server.js
|   `-- public/
`-- slave/
    |-- build.bat
    |-- requirements.txt
    |-- slave.py
    `-- slave.spec
```

## Requirements

- Node.js 18 or newer
- Python 3.12 or newer
- Windows for the student agent

## Quick Start

### Clone the project

```powershell
git clone https://github.com/JannePetto/Classroom-Manager
cd Classroom-Manager
```

### Start the dashboard

```powershell
cd master
npm install
$env:CLASSROOM_ADMIN_USERNAME="admin"
$env:CLASSROOM_ADMIN_PASSWORD="change-this-password"
npm start
```

Open `http://localhost:3000` in the teacher browser.

### Start the student agent from source

```powershell
cd slave
py -m pip install -r requirements.txt
py slave.py
```

If discovery is not available on your network, point the agent at the dashboard directly:

```powershell
cd slave
py -m pip install -r requirements.txt
py slave.py http://<teacher-pc-ip>:3000
```

### Build the Windows executable

```powershell
cd slave
.\build.bat
```

## Default Ports and State

- Dashboard HTTP/WebSocket port: `3000`
- UDP discovery port: `3100`
- Persistent dashboard state: `master/data/classroom-state.json`

## Documentation

- [Setup guide](docs/SETUP.md)
- [Configuration reference](docs/CONFIGURATION.md)
- [Architecture overview](docs/ARCHITECTURE.md)
- [Teacher account manual](docs/teacher-account-manual.html)

## GitHub Notes

- Generated folders and runtime state are ignored with the root `.gitignore`.
- Set the admin username and password before the first public/demo deployment.
- The packaged agent download route only works after building the executable in `slave/dist/`.

## No Warranty

This software is provided "as is", without any warranty of any kind, express or implied, including but not limited to merchantability, fitness for a particular purpose, and non-infringement. Use it at your own risk.

To the maximum extent permitted by applicable law, the authors and contributors are not liable for any claim, damages, or other liability arising from or related to the software or its use.

## License

This project is licensed under MIT. See the [LICENSE](LICENSE) file.
