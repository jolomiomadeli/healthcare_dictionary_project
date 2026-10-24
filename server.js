// Minimal same-origin proxy for Wordwell Health.
// Run with: node server.js, then open http://localhost:4173
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4173;
const API_ORIGIN = 'https://api.dictionaryapi.dev';

function send(res, status, body, contentType = 'application/json; charset=utf-8', allowFileOrigin = false) {
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
  if (allowFileOrigin) headers['Access-Control-Allow-Origin'] = '*';
  res.writeHead(status, headers);
  res.end(body);
}

function proxyDictionary(req, res, encodedWord) {
  let word;
  try {
    word = decodeURIComponent(encodedWord).trim();
  } catch (error) {
    console.error('[Wordwell proxy] Invalid encoded word:', error, req.url);
    send(res, 400, JSON.stringify({ message: 'Invalid word.' }), undefined, true);
    return;
  }
  if (!word || word.length > 100 || /[\u0000-\u001f\u007f]/.test(word)) {
    send(res, 400, JSON.stringify({ message: 'Enter a valid word.' }), undefined, true);
    return;
  }

  const upstreamUrl = `${API_ORIGIN}/api/v2/entries/en/${encodeURIComponent(word)}`;
  const upstream = https.get(upstreamUrl, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const body = Buffer.concat(chunks);
      send(res, response.statusCode || 502, body, response.headers['content-type'] || 'application/json; charset=utf-8', true);
    });
  });

  upstream.setTimeout(15000, () => {
    const error = new Error('Dictionary upstream timed out');
    console.error('[Wordwell proxy] Upstream timeout:', error, 'URL:', upstreamUrl);
    upstream.destroy(error);
    if (!res.headersSent) send(res, 504, JSON.stringify({ message: 'Dictionary request timed out.' }), undefined, true);
  });
  upstream.on('error', error => {
    console.error('[Wordwell proxy] Upstream request failed:', error, 'URL:', upstreamUrl);
    if (!res.headersSent) send(res, 502, JSON.stringify({ message: 'Dictionary service unavailable.' }), undefined, true);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const dictionaryMatch = requestUrl.pathname.match(/^\/api\/dictionary\/en\/([^/]+)$/);
  if (dictionaryMatch) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600'
      });
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET, OPTIONS');
      send(res, 405, JSON.stringify({ message: 'Method not allowed.' }), undefined, true);
      return;
    }
    proxyDictionary(req, res, dictionaryMatch[1]);
    return;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    send(res, 405, JSON.stringify({ message: 'Method not allowed.' }));
    return;
  }

  if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
    fs.readFile(path.join(ROOT, 'index.html'), (error, html) => {
      if (error) {
        console.error('[Wordwell server] Could not read index.html:', error);
        send(res, 500, 'Could not load Wordwell Health.', 'text/plain; charset=utf-8');
        return;
      }
      send(res, 200, html, 'text/html; charset=utf-8');
    });
    return;
  }

  send(res, 404, JSON.stringify({ message: 'Not found.' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Wordwell Health is running at http://localhost:${PORT}`);
});

server.on('error', error => {
  console.error('[Wordwell server] Failed to start:', error);
  process.exitCode = 1;
});
