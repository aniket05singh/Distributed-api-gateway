import http from 'node:http';

let isFailing = false;

export function createMockBackend() {
  const server = http.createServer((req, res) => {
    // Failure toggle endpoint
    if (req.url === '/toggle-fail' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          isFailing = parsed.fail !== undefined ? parsed.fail : !isFailing;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ isFailing }));
        } catch {
          res.writeHead(400).end();
        }
      });
      return;
    }

    // Health check
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', isFailing }));
      return;
    }

    // Mock API endpoint
    if (req.url === '/data') {
      if (isFailing) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: 'service response' }));
      }
      return;
    }

    res.writeHead(404).end();
  });

  return {
    server,
    setFailing: (fail) => { isFailing = fail; },
    getFailing: () => isFailing
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { server } = createMockBackend();
  server.listen(3001, () => {
    console.log('Mock backend listening on port 3001');
  });
}