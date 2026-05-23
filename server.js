import express from 'express';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const app = express();
const PORT = process.env.PORT || 3000;

const PROXY_HOST = process.env.CLAUDE_PROXY_HOST || 'http://192.168.10.126:80';
const PROXY_USER = process.env.CLAUDE_PROXY_USER || 'Admin';
const PROXY_PASS = process.env.CLAUDE_PROXY_PASS || 'm@dnansAdi14664300';
const PROXY_HOST_HEADER = process.env.CLAUDE_PROXY_HOST_HEADER || 'claude.coolify.codemods.com';

const proxyAuth = 'Basic ' + Buffer.from(`${PROXY_USER}:${PROXY_PASS}`).toString('base64');
const MODEL = process.env.MODEL || 'claude-sonnet-4-20250514';

app.use(express.json({ limit: '10mb' }));

app.use(express.static('public'));

app.post('/api/chat', async (req, res) => {
  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const body = {
    model: MODEL,
    max_tokens: 8192,
    messages,
    system: system || '',
    stream: false,
  };

  try {
    const proxyRes = await fetch(`${PROXY_HOST}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': proxyAuth,
        'Host': PROXY_HOST_HEADER,
      },
      body: JSON.stringify(body),
    });

    if (!proxyRes.ok) {
      const err = await proxyRes.text();
      return res.status(proxyRes.status).json({ error: err });
    }

    const data = await proxyRes.json();
    const text = data.content?.map(c => c.text).filter(Boolean).join('') || '';
    res.json({ content: text, model: data.model, usage: data.usage });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/chat/stream', async (req, res) => {
  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const body = {
    model: MODEL,
    max_tokens: 8192,
    messages,
    system: system || '',
    stream: true,
  };

  try {
    const proxyRes = await fetch(`${PROXY_HOST}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': proxyAuth,
        'Host': PROXY_HOST_HEADER,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!proxyRes.ok) {
      const err = await proxyRes.text();
      return res.status(proxyRes.status).json({ error: err });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = proxyRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
          } else {
            res.write(`data: ${data}\n\n`);
          }
        }
      }
    }

    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6).trim();
      if (data === '[DONE]') {
        res.write('data: [DONE]\n\n');
      } else {
        res.write(`data: ${data}\n\n`);
      }
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: err.message });
    }
    res.end();
  }
});

const server = createServer(app);
server.listen(PORT, () => {
  console.log(`Chat Claude listening on port ${PORT}`);
});
