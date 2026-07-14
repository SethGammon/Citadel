#!/usr/bin/env node

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
if (args.includes('--background')) {
  const childArgs = args.filter((arg) => arg !== '--background');
  const child = spawn(process.execPath, [__filename, ...childArgs], {
    cwd: process.cwd(), detached: true, stdio: 'ignore', windowsHide: true,
  });
  process.stdout.write(`${child.pid}\n`);
  child.unref();
  process.exit(0);
}
function value(flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const root = fs.realpathSync(path.resolve(value('--root', 'docs')));
const port = Number(value('--port', '4191'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('Invalid preview port');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const relative = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  const target = path.resolve(root, relative);
  const inside = target === root || (!path.relative(root, target).startsWith('..') && !path.isAbsolute(path.relative(root, target)));
  if (!inside || !fs.existsSync(target)) { response.writeHead(404).end('not found'); return; }
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) { response.writeHead(404).end('not found'); return; }
  response.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(target).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Citadel site preview: http://127.0.0.1:${port}\n`);
});
