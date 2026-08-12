import 'dotenv/config';
import express from 'express';
import { processCompany } from './lib/pipeline.js';
import { detectTechStack } from './lib/techDetect.js';
import { searchCompaniesByName } from './lib/hubspot.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.post('/api/process', async (req, res) => {
  const { domain, company_name, city, state, mode } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'domain is required' });
  const result = await processCompany({ domain, companyName: company_name, city, state, mode });
  res.json(result);
});

// Backs the manual "Select HubSpot Group" override control in the results table -
// always returns real HubSpot Company records, never a fabricated match.
app.get('/api/hubspot-groups/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q) return res.json([]);
  try {
    const results = await searchCompaniesByName(q);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tech-scan', async (req, res) => {
  const { domain } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'domain is required' });
  const result = await detectTechStack(domain);
  res.json(result);
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

if (process.env.VERCEL === undefined) {
  const port = process.env.PORT || 8787;
  app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
}

export default app;
