import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

const PORT_START = 7891;
const PORT_END = 7899;
const TELEMETRY_REPLAY_LINES = 50;

function log(msg: string): void {
  if (process.env.NODE_ENV !== 'production') {
    process.stdout.write(`[ws-server] ${msg}\n`);
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(): Promise<number> {
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port in range ${PORT_START}-${PORT_END}`);
}

function readTelemetryReplay(projectRoot: string): object[] {
  const telemetryPath = path.join(projectRoot, '.planning', 'telemetry', 'agent-runs.jsonl');
  try {
    const raw = fs.readFileSync(telemetryPath, 'utf-8');
    const lines = raw.trim().split('\n').filter((l) => l.trim().length > 0);
    const lastLines = lines.slice(-TELEMETRY_REPLAY_LINES);
    return lastLines.map((line) => {
      try {
        return JSON.parse(line) as object;
      } catch {
        return { raw: line };
      }
    });
  } catch {
    return [];
  }
}

function writePortFile(projectRoot: string, port: number): void {
  const citadelDir = path.join(projectRoot, '.citadel');
  try {
    fs.mkdirSync(citadelDir, { recursive: true });
    fs.writeFileSync(path.join(citadelDir, 'ui-server.port'), String(port), 'utf-8');
  } catch {
    // Non-fatal
  }
}

export interface WsServerHandle {
  port: number;
  broadcast: (event: object) => void;
  close: () => void;
}

export async function startWsServer(projectRoot: string): Promise<WsServerHandle> {
  const port = await findAvailablePort();
  writePortFile(projectRoot, port);

  const wss = new WebSocketServer({ host: '127.0.0.1', port });
  log(`Listening on port ${port}`);

  const replayEvents = readTelemetryReplay(projectRoot);

  wss.on('connection', (ws: WebSocket) => {
    log('Client connected');
    // Replay recent telemetry to new client
    for (const event of replayEvents) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(event));
        } catch {
          // Skip failed sends
        }
      }
    }
  });

  function broadcast(event: object): void {
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch {
          // Skip disconnected clients
        }
      }
    }
  }

  function close(): void {
    wss.close();
    log('Server closed');
  }

  return { port, broadcast, close };
}
