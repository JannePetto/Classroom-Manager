# Setup Guide

## Requirements

- Node.js 18 or newer
- Python 3.12 or newer
- Windows for the student agent features
- PowerShell for the commands below

## 1. Install and start the dashboard

```powershell
cd master
npm install
$env:CLASSROOM_ADMIN_USERNAME="admin"
$env:CLASSROOM_ADMIN_PASSWORD="change-this-password"
npm start
```

Open `http://localhost:3000` after the server starts.

## 2. Run the student agent from source

The agent can auto-discover the dashboard on the local network, so the shortest startup command is:

```powershell
cd slave
py -m pip install -r requirements.txt
py slave.py
```

If you want to point the agent at a specific dashboard manually, use:

```powershell
cd slave
py -m pip install -r requirements.txt
py slave.py http://<teacher-pc-ip>:3000
```

## 3. Build the Windows executable

```powershell
cd slave
.\build.bat
```

The packaged executable is written to `slave\dist\`.

## 4. First-run checklist

1. Start the dashboard.
2. Sign in with the primary admin account.
3. Start one agent on a student machine.
4. Confirm the device appears in the dashboard.
5. Create teacher accounts, classes, and shared presets as needed.

## 5. Troubleshooting

- If the agent does not appear, verify that port `3000` is reachable from the student device.
- If discovery does not work on your network, launch the agent with an explicit dashboard URL.
- If the dashboard download button shows unavailable, build the agent executable first.
