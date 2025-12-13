#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function byRankAsc(a, b) {
  const ra = Number.isFinite(a?.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
  const rb = Number.isFinite(b?.rank) ? b.rank : Number.MAX_SAFE_INTEGER;
  return ra - rb;
}

function buildTopByRank({ inFile, outFile, limit }) {
  if (!fs.existsSync(inFile)) {
    console.log(`⚠️  Missing input: ${path.relative(ROOT, inFile)}`);
    return false;
  }

  const data = readJson(inFile);
  const props = Array.isArray(data?.props) ? data.props : [];

  const topProps = props.slice().sort(byRankAsc).slice(0, limit);

  const outData = {
    ...data,
    totalProps: topProps.length,
    props: topProps
  };

  writeJson(outFile, outData);

  const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
  console.log(`✅ Wrote ${path.relative(ROOT, outFile)} (${topProps.length} props, ${sizeKb}KB)`);
  return true;
}

function main() {
  const limit = Number(process.env.ACTION_SLICE_LIMIT || 200);

  // Keep this intentionally small and focused: only endpoints needed by the GPT Action.
  const jobs = [
    {
      in: path.join(DATA_DIR, 'prizepicks-nfl-tomorrow.json'),
      out: path.join(DATA_DIR, `prizepicks-nfl-tomorrow-top-${limit}.json`)
    },
    {
      in: path.join(DATA_DIR, 'prizepicks-nfl-today.json'),
      out: path.join(DATA_DIR, `prizepicks-nfl-today-top-${limit}.json`)
    }
  ];

  let any = false;
  for (const job of jobs) {
    const ok = buildTopByRank({ inFile: job.in, outFile: job.out, limit });
    any = any || ok;
  }

  if (!any) {
    process.exitCode = 0;
  }
}

main();
