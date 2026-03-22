# Configuration

## Dashboard environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server port for the dashboard |
| `CLASSROOM_CONNECT_HOST` | auto-detected LAN URL | Preferred host shown in dashboard connection instructions |
| `CLASSROOM_DISCOVERY_PORT` | `3100` | UDP discovery port used by agents |
| `CLASSROOM_ADMIN_USERNAME` | `admin` | Bootstrap username for the primary admin account |
| `CLASSROOM_ADMIN_PASSWORD` | `change-me` | Bootstrap password for the primary admin account |

## Agent configuration order

The student agent resolves the dashboard URL in this order:

1. Command-line argument
2. `CLASSROOM_MASTER_URL`
3. `CLASSROOM_MASTER_HOST`
4. UDP discovery on the local network
5. The last cached dashboard URL

## Agent environment variables

| Variable | Purpose |
| --- | --- |
| `CLASSROOM_MASTER_URL` | Full dashboard URL such as `http://192.168.1.20:3000` |
| `CLASSROOM_MASTER_HOST` | Hostname or IP only; the agent assumes port `3000` |

## Runtime files

| Path | Purpose |
| --- | --- |
| `master/data/classroom-state.json` | Persistent dashboard state, account hashes, groups, and policies |
| `%LOCALAPPDATA%\ClassroomAgent\agent-id.txt` | Stable device identifier for the agent |
| `%LOCALAPPDATA%\ClassroomAgent\last-master-url.txt` | Last successfully used dashboard URL |

## Network ports

| Port | Protocol | Purpose |
| --- | --- | --- |
| `3000` | HTTP / WebSocket | Dashboard UI, dashboard websocket, agent websocket, download route |
| `3100` | UDP | Local network dashboard discovery |
