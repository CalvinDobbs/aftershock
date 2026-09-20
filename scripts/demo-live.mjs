#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { existsSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (existsSync('.env')) process.loadEnvFile('.env');
const checkOnly = process.argv.includes('--check');
const serveOnly = process.argv.includes('--serve-only');
const repo = 'Nikhil-Doal/demo_site';
const head = '38c987cc2b85f8e7571f6465769658dfeff6ecae';
const base = '6cff32d25d6bf067d571cd0534e9f1399c63938c';
const previewUrl = 'https://demo-site-36dnpbk4c-doalnikhilgmailcoms-projects.vercel.app';
const baseUrl = 'https://demo-site-hazel-beta.vercel.app';
const webPort = Number(process.env.DEMO_PORT ?? 3010);
if (!Number.isInteger(webPort) || webPort < 1024 || webPort > 65533) throw new Error('DEMO_PORT must be between 1024 and 65533');
const directorPort = webPort + 1, apiPort = webPort + 2;
const webUrl = `http://localhost:${webPort}`, directorUrl = `http://127.0.0.1:${directorPort}`, apiUrl = `http://127.0.0.1:${apiPort}`;
const children = [];
let stopping = false;
let launchServer;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  launchServer?.close();
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
async function json(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${new URL(url).pathname}: HTTP ${r.status}`);
  return r.json();
}
async function freePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is busy. Stop the previous demo with Ctrl+C, or choose another DEMO_PORT.`)));
    server.listen(port, () => server.close(resolve));
  });
}
try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) throw new Error('Node 22.18+ is required.');
  for (const name of ['BROWSERBASE_API_KEY', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'AFTERSHOCK_PREVIEW_COMMAND']) {
    if (!process.env[name]) throw new Error(`Missing ${name} in root .env`);
  }
  if (process.env.AFTERSHOCK_PUBLISH_REPAIRS === 'false') throw new Error('Full demo requires AFTERSHOCK_PUBLISH_REPAIRS=true.');
  const command = JSON.parse(process.env.AFTERSHOCK_PREVIEW_COMMAND);
  if (!Array.isArray(command) || !command.length || command.some(x => typeof x !== 'string')) throw new Error('Invalid preview command JSON');
  const headers = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' };
  for (const [branch, sha] of [['main', base], ['feat/coupon-codes', head]]) {
    const ref = await json(`https://api.github.com/repos/${repo}/git/ref/heads/${branch}`, { headers });
    if (ref.object.sha !== sha) throw new Error(`${branch} changed. Review its code and deployment before replaying; this script never resets remote branches.`);
  }
  for (const url of [baseUrl, previewUrl]) {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Demo deployment unavailable: ${url} (${r.status})`);
  }
  const prs = await json(`https://api.github.com/repos/${repo}/pulls?state=open&head=Nikhil-Doal:feat/coupon-codes&base=main`, { headers });
  const prNumber = prs[0]?.number;
  await Promise.all([webPort, directorPort, apiPort].map(freePort));
  console.log('Preflight passed: clean main, original broken coupon commit, reachable deployments, required configuration present.');
  if (checkOnly) process.exit(0);
  const directory = join(root, '.aftershock', 'demos', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(directory, { recursive: true });
  // Separate frontend/build directory: never disturb an already-running dashboard.
  const webDirectory = join(directory, 'web');
  await cp(join(root, 'apps/web'), webDirectory, { recursive: true, filter: source => !['node_modules', '.next', '.env', '.env.local', 'tsconfig.tsbuildinfo'].includes(source.split('/').at(-1)) });
  const config = await readFile(join(webDirectory, 'tsconfig.json'), 'utf8');
  await writeFile(join(webDirectory, 'tsconfig.json'), config.replace(/"extends"\s*:\s*"[^"]+"/, '"extends": ' + JSON.stringify(join(root, 'tsconfig.base.json'))));
  const modules = join(webDirectory, 'node_modules');
  await mkdir(modules);
  // Merge workspace and app dependency links, including scoped type packages.
  async function linkModules(source, destination) {
    for (const name of await readdir(source)) {
      if (name.startsWith('.') || existsSync(join(destination, name))) continue;
      if (name.startsWith('@')) {
        await mkdir(join(destination, name), { recursive: true });
        await linkModules(join(source, name), join(destination, name));
      } else await symlink(join(source, name), join(destination, name));
    }
  }
  await linkModules(join(root, 'apps/web/node_modules'), modules);
  // Scopes may already exist; merge them explicitly.
  for (const name of await readdir(join(root, 'node_modules'))) {
    if (name.startsWith('@') && existsSync(join(modules, name))) await linkModules(join(root, 'node_modules', name), join(modules, name));
  }
  await linkModules(join(root, 'node_modules'), modules);
  function launch(name, args, env, cwd = root) {
    const fd = openSync(join(directory, name + '.log'), 'a');
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd] });
    children.push(child);
    child.on('error', error => { console.error(name + ': ' + error.message); stop(1); });
    child.on('exit', code => { if (!stopping) { console.error(`${name} exited (${code}). Logs: ${directory}`); stop(1); } });
  }
  const project = { [repo]: { baseUrl, fallbackRoutes: ['/cart', '/checkout'], routeSamples: { slug: 'wool-scarf' }, routeSetup: { '/checkout': ['Open /products/wool-scarf?reset=1', 'Click the Add to cart button', 'Open /checkout'] }, criticalJourney: { route: '/cart', description: 'Add a scarf and inspect the cart subtotal without a coupon', steps: ['Open /products/wool-scarf?reset=1', 'Click the Add to cart button', 'Open /cart'] }, maxConcurrent: 3 } };
  launch('director', ['--import', 'tsx', 'services/orchestrator/src/start.ts'], { PORT: String(directorPort), AFTERSHOCK_DATA_DIR: join(directory, 'evidence'), AFTERSHOCK_EVIDENCE_ORIGIN: directorUrl, AFTERSHOCK_REPAIR_BASE_BRANCH: 'feat/coupon-codes' });
  launch('api', ['--import', 'tsx', 'services/api/src/start.ts'], { PORT: String(apiPort), ORCHESTRATOR_URL: directorUrl, AFTERSHOCK_PROJECTS: JSON.stringify(project) });
  launch('web', [join(root, 'apps/web/node_modules/next/dist/bin/next'), 'dev', '--port', String(webPort)], { AFTERSHOCK_API_URL: apiUrl, NEXT_PUBLIC_ORCHESTRATOR_URL: directorUrl }, webDirectory);
  async function ready(url) {
    for (let i = 0; i < 90; i++) {
      if (stopping) throw new Error('A service stopped.');
      try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Service not ready: ${url}. Logs: ${directory}`);
  }
  await Promise.all([ready(directorUrl + '/runs'), ready(apiUrl + '/health'), ready(webUrl)]);
  const request = { repo, sha: head, ref: 'refs/heads/feat/coupon-codes', baseRef: 'main', ...(prNumber ? { prNumber } : {}), previewUrl, baseUrl };
  await writeFile(join(directory, 'trigger.json'), JSON.stringify(request, null, 2));
  if (serveOnly) {
    const launchPath = '/start/' + randomUUID();
    let started;
    launchServer = createHttpServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'GET' || req.url !== launchPath) {
        res.writeHead(404).end('Not found'); return;
      }
      // Refreshes and duplicate clicks share one request, never another paid run.
      started ??= json(apiUrl + '/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }).then(async run => {
        const dashboard = webUrl + '/runs/' + encodeURIComponent(run.runId);
        await writeFile(join(directory, 'run.json'), JSON.stringify({ ...run, dashboard }, null, 2));
        console.log('Run started: ' + dashboard);
        return dashboard;
      });
      try {
        const dashboard = await started;
        res.writeHead(303, { Location: dashboard }).end();
      } catch {
        // Do not automatically retry an ambiguous POST that might have succeeded.
        res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Could not start the run. Check this demo stack’s logs before retrying.');
      }
    });
    await new Promise((resolve, reject) => {
      launchServer.once('error', reject);
      launchServer.listen(0, '127.0.0.1', resolve);
    });
    const launchPort = launchServer.address().port;
    console.log(`Servers ready. Open this link to START the real run:\n\nhttp://localhost:${launchPort}${launchPath}\n\nOpening it creates demo issues, previews and a repair PR. Nothing is merged.\nRepeated clicks return to the same run.`);
  } else {
    console.log('Starting real run: creates demo-repository issues, Vercel previews, and a repair PR. Nothing is merged.');
    const run = await json(apiUrl + '/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    await writeFile(join(directory, 'run.json'), JSON.stringify({ ...run, dashboard: webUrl + '/runs/' + run.runId }, null, 2));
    console.log(`\nOPEN: ${webUrl}/runs/${run.runId}\n`);
  }
  console.log(`Logs and evidence: ${directory}\nLeave this terminal running. Ctrl+C stops only this demo stack. Previous runs are untouched.`);
} catch (error) {
  console.error(error.message);
  stop(1);
}
