import express from 'express';
import { createServer } from 'node:http';

const app = express();
const PORT = process.env.PORT || 3000;

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || '';
const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
const MODEL = process.env.MODEL || 'meta/llama-3.2-3b-instruct';

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.post('/api/chat', async (req, res) => {
  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const openaiMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  const body = { model: MODEL, max_tokens: 8192, messages: openaiMessages, stream: false };

  try {
    const apiRes = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!apiRes.ok) {
      const err = await apiRes.text();
      return res.status(apiRes.status).json({ error: err });
    }

    const data = await apiRes.json();
    const text = data.choices?.[0]?.message?.content || '';
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

  const openaiMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages;

  const body = { model: MODEL, max_tokens: 8192, messages: openaiMessages, stream: true };

  try {
    const apiRes = await fetch(`${NVIDIA_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NVIDIA_API_KEY}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!apiRes.ok) {
      const err = await apiRes.text();
      return res.status(apiRes.status).json({ error: err });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = apiRes.body.getReader();
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
