import 'dotenv/config';
import express from 'express';
import { processDomain } from './lib/pipeline.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.post('/api/process', async (req, res) => {
  const { domain } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'domain is required' });
  const result = await processDomain(domain);
  res.json(result);
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

if (process.env.VERCEL === undefined) {
  const port = process.env.PORT || 8787;
  app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
}

export default app;
