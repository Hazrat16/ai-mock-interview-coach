// Privacy audit (M11, `make net-audit`): shows every network connection of the app and of the AI services
// that leaves this computer. Run it during an interview; it should find none.
//   Ports: every service port is published on 127.0.0.1 only.
//   App: the server process listening on PORT (its own connections, not other programs').
//   Services: the connections inside each container (/proc/net), allowing only this computer and the
//   containers' own network (which is how the app reaches them).
// Options: --seconds <n>  sample once per second for n seconds (default: one sample)
import { execFileSync } from 'node:child_process';

process.loadEnvFile('.env');
const args = process.argv.slice(2);
const seconds = Number(args.includes('--seconds') ? args[args.indexOf('--seconds') + 1] : 0);
const appPort = process.env.PORT ?? '4317';
const run = (cmd: string, a: string[]) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const compose = (...a: string[]) => run('docker', ['compose', ...a]);

// --- addresses
const ipv4ToInt = (ip: string) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
const subnets = run('docker', [
  'network',
  'inspect',
  'ai-interview-coach_default',
  '--format',
  '{{range .IPAM.Config}}{{.Subnet}} {{end}}',
])
  .trim()
  .split(/\s+/)
  .filter((s) => s.includes('.'));

function local(ip: string) {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (v4 === '::1' || v4.startsWith('127.')) return true;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return false;
  return subnets.some((s) => {
    const [base, bits] = s.split('/');
    const mask = Number(bits) === 0 ? 0 : (2 ** 32 - 2 ** (32 - Number(bits))) >>> 0;
    return (ipv4ToInt(v4) & mask) >>> 0 === (ipv4ToInt(base!) & mask) >>> 0;
  });
}

/** /proc/net hex address → text: IPv4 is one little-endian word, IPv6 four of them. */
function procAddress(hex: string) {
  const [addr, port] = hex.split(':') as [string, string];
  const words = addr
    .toLowerCase()
    .match(/.{8}/g)!
    .map((w) => w.match(/../g)!.reverse().join(''));
  const p = parseInt(port, 16);
  if (words.length === 1)
    return {
      ip: words[0]!
        .match(/../g)!
        .map((b) => parseInt(b, 16))
        .join('.'),
      port: p,
    };
  const bytes = words.join('');
  const groups = bytes.match(/.{4}/g)!.map((g) => parseInt(g, 16).toString(16));
  let ip = groups.join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
  if (bytes.startsWith('00000000000000000000ffff'))
    ip = `::ffff:${bytes
      .slice(24)
      .match(/../g)!
      .map((b) => parseInt(b, 16))
      .join('.')}`;
  return { ip, port: p };
}

type Finding = { where: string; what: string };

// --- checks
function publishedPorts(): Finding[] {
  return compose('ps', '--format', '{{.Service}}\t{{.Publishers}}')
    .trim()
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const [service, publishers = ''] = line.split('\t');
      return [...publishers.matchAll(/->\s*([^\]\s,]+)/g)]
        .map((m) => m[1]!)
        .filter((bind) => !bind.startsWith('127.0.0.1:'))
        .map((bind) => ({ where: service!, what: `port published on ${bind} (reachable from other computers)` }));
    });
}

function appProcess(): { pid: string | undefined; findings: Finding[] } {
  const listening = run('ss', ['-tlnpH', `sport = :${appPort}`]);
  const pid = listening.match(/pid=(\d+)/)?.[1];
  if (!pid) return { pid, findings: [] };
  const findings: Finding[] = [];
  for (const line of listening.trim().split('\n')) {
    const localAddr = line.trim().split(/\s+/)[3] ?? '';
    const ip = localAddr.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (!local(ip)) findings.push({ where: 'app', what: `listening on ${localAddr} (reachable from other computers)` });
  }
  for (const line of run('ss', ['-tunapH']).trim().split('\n')) {
    if (!line.includes(`pid=${pid},`)) continue;
    const cols = line.trim().split(/\s+/);
    const peer = cols[5] ?? '';
    const ip = peer.replace(/:[^:]+$/, '').replace(/^\[|\]$/g, '');
    if (ip !== '*' && ip !== '0.0.0.0' && ip !== '::' && !local(ip))
      findings.push({ where: 'app', what: `${cols[0]} ${cols[1]} to ${peer}` });
  }
  return { pid, findings };
}

const TCP_STATES: Record<string, string> = {
  '01': 'ESTABLISHED',
  '02': 'SYN_SENT',
  '03': 'SYN_RECV',
  '06': 'TIME_WAIT',
};

function containers(): Finding[] {
  const services = compose('ps', '--services', '--status', 'running').trim().split('\n').filter(Boolean);
  return services.flatMap((service) => {
    const findings: Finding[] = [];
    for (const proto of ['tcp', 'tcp6', 'udp', 'udp6']) {
      let table: string;
      try {
        table = compose('exec', '-T', service, 'cat', `/proc/net/${proto}`);
      } catch {
        continue; // e.g. no IPv6
      }
      for (const row of table.trim().split('\n').slice(1)) {
        const cols = row.trim().split(/\s+/);
        const remote = procAddress(cols[2]!);
        if (remote.port === 0 || /^(0\.0\.0\.0|::)$/.test(remote.ip) || local(remote.ip)) continue;
        const state = proto.startsWith('tcp') ? (TCP_STATES[cols[3]!] ?? `state ${cols[3]}`) : 'UDP';
        findings.push({ where: service, what: `${proto} ${state} to ${remote.ip}:${remote.port}` });
      }
    }
    return findings;
  });
}

// --- run
const all = new Map<string, Finding>();
const ports = publishedPorts();
let appSeen = false;
const rounds = Math.max(1, seconds);
for (let i = 0; i < rounds; i++) {
  const app = appProcess();
  appSeen ||= Boolean(app.pid);
  for (const f of [...ports, ...app.findings, ...containers()]) all.set(`${f.where} ${f.what}`, f);
  if (i < rounds - 1) await new Promise((r) => setTimeout(r, 1000));
}

console.log(
  `Network audit: ${rounds} sample(s); allowed: this computer and the services' network (${subnets.join(', ')}).`,
);
if (!appSeen) console.log(`Note: the app is not running on port ${appPort}; only the AI services were checked.`);
if (all.size === 0) {
  console.log('No connections leave this computer.');
} else {
  console.log(`Found ${all.size} connection(s) or open port(s) beyond this computer:`);
  for (const f of all.values()) console.log(`  ${f.where}: ${f.what}`);
  process.exitCode = 1;
}
