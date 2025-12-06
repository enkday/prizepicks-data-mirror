const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1];
}

function escapeCsv(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function fetchEvents({ query, apiKey }) {
  const baseParams = { engine: 'google_events', q: query, api_key: apiKey };
  const events = [];

  // First page with no explicit start (start=0 can return empty)
  const first = await axios.get('https://serpapi.com/search.json', {
    params: baseParams,
    timeout: 10000
  });
  events.push(...(first.data.events_results || []));

  // Subsequent pages
  for (let start = 10; start < 200; start += 10) {
    const resp = await axios.get('https://serpapi.com/search.json', {
      params: { ...baseParams, start },
      timeout: 10000
    });
    const pageEvents = resp.data.events_results || [];
    if (!pageEvents.length) break;
    events.push(...pageEvents);
  }

  return events;
}

async function writeCsv(events, outPath) {
  const rows = [];
  rows.push(['idx', 'title', 'when', 'address', 'link'].join(','));
  events.forEach((e, i) => {
    const when = e.date?.when || e.date?.start_date || '';
    const address = Array.isArray(e.address)
      ? e.address.join('; ')
      : e.venue?.address || '';
    rows.push(
      [
        i + 1,
        escapeCsv(e.title),
        escapeCsv(when),
        escapeCsv(address),
        escapeCsv(e.link || '')
      ].join(',')
    );
  });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, rows.join('\n'), 'utf8');
}

async function main() {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    console.error('Missing SERPAPI_API_KEY in env');
    process.exit(1);
  }
  const query = getArg('--query') || 'events in Boerne, TX';
  const repoRoot = path.join(__dirname, '..');
  const out = getArg('--out') || path.join(repoRoot, 'data', 'boerne-events.csv');

  console.log(`Fetching events for query: "${query}"`);
  const events = await fetchEvents({ query, apiKey });
  console.log(`Found ${events.length} events`);
  await writeCsv(events, out);
  console.log(`CSV written to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
