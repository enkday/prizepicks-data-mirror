const express = require('express');
const axios = require('axios');

const PORT = process.env.PORT || 3001;
const app = express();

// Simple health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Proxy to SerpApi google_events engine.
 * - Requires SERPAPI_API_KEY in environment (not accepted from clients).
 * - Always enforces engine=google_events.
 */
app.get('/search', async (req, res) => {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: 'Missing SERPAPI_API_KEY env var. Set it on the server.' });
  }

  const { q, location, hl, gl, start } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Missing required query param: q' });
  }

  try {
    const serpResponse = await axios.get('https://serpapi.com/search', {
      params: {
        engine: 'google_events',
        q,
        location,
        hl,
        gl,
        start,
        api_key: apiKey
      },
      timeout: 10000
    });
    res.json(serpResponse.data);
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data || { error: error.message };
    res.status(status).json(data);
  }
});

app.listen(PORT, () => {
  console.log(`SerpApi google_events proxy listening on http://localhost:${PORT}`);
});
