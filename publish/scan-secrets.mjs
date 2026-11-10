// node publish/scan-secrets.mjs [file, folder or ZIP ...]   scans the whole kit folder when given nothing
// node publish/scan-secrets.mjs --git [repository folder]    scans a git repository's whole history: every version of
//                                                            every file, every commit message and author address
// node publish/scan-secrets.mjs --git-new [repository folder] the same for what is not on any remote yet: run before a push
//
// Looks for what must never be shared: passwords and PINs, API keys and tokens, private keys, logins written into
// addresses or commands (database and root logins included), files that usually hold keys (Claude Code settings,
// .env, .npmrc, SSH keys ...), e-mail addresses, phone, card and social security numbers, home-folder paths, and the
// name, account and computer name of whoever runs it (read from this computer, never written down). Text is read
// whole; other files by their readable strings, so picture and sound tags are covered; the Blender file is
// decompressed; ZIPs are read entry by entry. Findings are shown masked. Exit code 1 when anything is found.
// release.mjs runs it on every file that ships, and the repository's checks run it on every push.
import {readFileSync, readdirSync, lstatSync} from 'node:fs';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {inflateRawSync, zstdDecompressSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = /^(?:rebuild\/build|view\.staging|view\.previous|\.view\.(?:staging|previous)-[^/]*|\.ptp-build\.lock)$|(?:^|\/)(?:\.git|node_modules|\.pnpm-store|__pycache__)$/;

// A value that only stands in for a real one: ${NAME}, <token>, ****, "your-key", "changeme" and the like.
const PLACEHOLDER = /^(?:\$\{?[\w.]+\}?|\$\(.*\)|\$\{\{.*\}\}|<[^>]*>|\{\{.*\}\}|%\w+%|[*x•.…]+|(?:your|my|the|an?|example|sample|dummy|fake|test|changeme|placeholder|redacted|hidden|secret|password|passwd|pass|token|key|none|null|undefined|true|false|xxx+)\b[\w.-]*)$/i;
const real = value => !!value && !PLACEHOLDER.test(value.replace(/^["'`]|["'`]$/g, '')) && !/process\.env|os\.environ|secrets\./.test(value);
// Card numbers: a real issuer prefix and length (Visa, Mastercard, Amex, Discover, JCB, Diners), then the Luhn check digit.
const ISSUER = /^(?:4\d{12}(?:\d{3}){0,2}|(?:5[1-5]\d\d|2(?:2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))\d{12}|3[47]\d{13}|(?:6011|65\d\d|64[4-9]\d)\d{12,15}|35(?:2[89]|[3-8]\d)\d{12,15}|3(?:0[0-5]|[68]\d)\d{11})$/;
const luhn = digits => [...digits].reverse().reduce((sum, d, i) => sum + (i % 2 ? [0, 2, 4, 6, 8, 1, 3, 5, 7, 9][d] : +d), 0) % 10 === 0;
const ALLOWED_MAIL = /(?:@|\.)(?:example\.(?:com|org|net)|[\w-]+\.(?:invalid|test|example|localhost)|users\.noreply\.github\.com)$|^(?:noreply@github\.com|git@github\.com)$/i;
// Domains are written in lower case, and a bare two-letter ending needs a name of three letters or more in front
// (web.de, gmx.at); short random runs from pictures and compressed data (ab.cd, 9M.lq) are not addresses.
const realDomain = domain => { const labels = domain.split('.'); return domain === domain.toLowerCase() && /[a-z]/.test(labels.at(-2)) && !(labels.length === 2 && labels[1].length === 2 && labels[0].length < 3); };
const FILE_EXTENSION = /\.(?:png|jpe?g|gif|svg|webp|ico|js|mjs|cjs|ts|css|json|html?|md|txt|py|blend|zip|mp3|wav|ogg|glb|gltf|ya?ml)$/i;

/** [rule, what it is, pattern, optional check on the match]. Patterns are written so that this file does not match itself. */
const RULES = [
  ['private-key', 'a private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g],
  ['aws-key', 'an AWS access key', /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g],
  ['github-token', 'a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g],
  ['gitlab-token', 'a GitLab token', /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ['anthropic-key', 'an Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['openai-key', 'an OpenAI-style API key', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g, m => !m[0].startsWith('sk-ant-')],
  ['slack-token', 'a Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ['webhook', 'a chat webhook address', /https:\/\/(?:hooks\.slack\.com\/services|(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks)\/[A-Za-z0-9/_-]{20,}/g],
  ['google-key', 'a Google API key or OAuth secret', /\b(?:AIza[0-9A-Za-z_-]{35}|GOCSPX-[A-Za-z0-9_-]{20,})(?![0-9A-Za-z_-])/g],
  ['stripe-key', 'a Stripe key', /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['package-token', 'an npm or PyPI token', /\bnpm_[A-Za-z0-9]{36}\b|\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}|_authToken\s*=\s*\S+/g, m => real(m[0].split('=').pop().trim())],
  ['sendgrid-key', 'a SendGrid key', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g],
  ['bot-token', 'a Telegram bot token', /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g],
  ['jwt', 'a signed web token (JWT)', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['connection-key', 'a key in a connection string', /\b(?:AccountKey|SharedAccessKey|SharedAccessSignature)=([^;"'\s]{8,})/g, m => real(m[1])],
  ['url-login', 'a user name and password in an address (database, FTP, root logins ...)', /\b[a-z][a-z0-9+.-]{1,20}:\/\/([^\s/:@'"<>]{1,64}):([^\s/@'"<>]{1,128})@[^\s/'"<>]+/gi, m => real(m[2])],
  ['password', 'a password, secret, key or token written in', /(?<![A-Za-z0-9])([A-Za-z0-9_.-]*(?:password|passwd|passphrase|pwd|secret|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|bearer[_-]?token|private[_-]?key|client[_-]?secret|credentials?)s?)["']?\s*(?:[:=]|=>)\s*(["'`])([^"'`\s]{4,200})\2/gi, m => real(m[3])],
  ['password', 'a password, secret, key, token or PIN set in the environment', /^[ \t]*(?:export[ \t]+|set[ \t]+)?([A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|PASS|PWD|SECRET|TOKEN|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|PIN))[ \t]*=[ \t]*([^\s#]{4,})/gm, m => real(m[2])],
  ['password', 'a password on a command line', /\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n]*?\s-p(?!\s)["']?([^\s'"`,;)]{4,})|\bsshpass\s+-p\s*["']?([^\s'"`,;)]{4,})|--password[= ]["']?([^\s'"`,;)]{4,})|\bcurl\b[^\n]*?\s(?:-u|--user)\s+[^\s:]+:["']?([^\s'"`,;)]{4,})/g, m => real(m[1] || m[2] || m[3] || m[4])],
  ['password', 'a login in an Authorization header', /\bAuthorization:\s*(?:Bearer|Basic|token)\s+([A-Za-z0-9._~+/=-]{8,})/gi, m => real(m[1])],
  ['root-login', 'a root login', /\bssh\s+(?:-\S+\s+)*root@[\w.-]+|\broot:\$[0-9a-z]{1,2}\$|\b(?:user(?:name)?|login)["']?\s*[:=]\s*["']?root\b/gi],
  ['pin', 'a PIN or security code', /\b(?:pin(?:[ _-]?(?:code|number|no))?|passcode|security[ _-]?code|cvv|cvc)\b["']?\s*(?:is|[:=#])\s*["']?(\d{4,8})["']?(?![\d.])/gi],
  // A real domain ends in a lower-case country code or common ending; this keeps out code such as matrix@v.co or obj@mesh.vertices.
  ['email', 'an e-mail address', /(?<![\w.%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]{2,}\.(?:[a-z]{2}|com|org|net|edu|gov|mil|int|info|biz|io|ai|app|dev|xyz|online|site|tech|cloud|email|name|pro|mobi)\b(?!\.?[A-Za-z0-9_(])/g, m => realDomain(m[0].split('@')[1]) && !ALLOWED_MAIL.test(m[0]) && !FILE_EXTENSION.test(m[0])],
  ['phone', 'a phone number', /(?<![\w+.-])(?:\(\d{3}\)\s?\d{3}-\d{4}|\d{3}-\d{3}-\d{4}|\+\d{1,3}[ -]\(?\d{1,4}\)?[ -]\d{3,4}[ -]\d{3,4})(?![\w.-])/g],
  ['ssn', 'a social security number', /(?<![\w-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\w-])/g],
  ['card', 'a payment card number', /(?<![\w./=#:@-])[2-6]\d{3}(?:[ -]?\d{4}){2}[ -]?\d{1,7}(?![\w.-])/g, m => { const d = m[0].replace(/\D/g, ''); return ISSUER.test(d) && luhn(d); }],
  ['home-path', "a home or temporary folder from one computer", /(?:\/Users\/|\/home\/|[A-Za-z]:\\{1,2}Users\\{1,2})(?!(?:Shared|you|your\w*|me|runner|name|user|username|example|USER|USERNAME)\b)[A-Za-z0-9._-]{2,}|\/(?:private\/)?var\/folders\/[\w+]{2}\/[\w+]{20,}\//g],
];

/** Kinds of file that usually hold keys or personal data, whatever is in them. */
const FILES = [
  [/(?:^|\/)\.claude\/settings(?:\.local)?\.json$|(?:^|\/)CLAUDE\.local\.md$|(?:^|\/)\.mcp\.json$/, 'Claude Code settings or notes (can hold keys, tokens and paths)'],
  [/(?:^|\/)\.env(?:\.(?!example$|sample$|template$)[\w.-]+)?$/, 'an environment file (usually holds keys and passwords)'],
  [/(?:^|\/)(?:\.npmrc|\.pypirc|\.netrc|_netrc|\.git-credentials|\.htpasswd|\.pgpass|\.my\.cnf|\.s3cfg|\.dockercfg)$|(?:^|\/)\.aws\/credentials$|(?:^|\/)\.docker\/config\.json$/, 'a login or credentials file'],
  [/(?:^|\/)\.ssh\/|(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$|\.(?:pem|p12|pfx|jks|keystore|kdbx|ovpn|ppk)$/i, 'a key, certificate or password store'],
  [/(?:^|\/)(?:credentials|secrets?)(?:\.\w+)?$/i, 'a file named for credentials or secrets'],
  [/(?:^|\/)\.(?:bash|zsh|sh|python|node_repl|mysql|psql|lesshst)_?history$/, 'a shell or tool history'],
];

/** Words that identify whoever runs this: account, full name, computer names. Not used on CI machines. */
function computerWords() {
  if (process.env.CI || process.env.GITHUB_ACTIONS) return [];
  const run = (cmd, args) => { try { return execFileSync(cmd, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return ''; } };
  // Computer names usually carry the owner's first name ("Sam's MacBook", "Sams-MacBook"): keep each part too.
  const parts = name => [name, ...name.split(/[\s-]+/).map(w => w.replace(/['’]s$/i, ''))];
  const words = [os.userInfo().username, ...parts(os.hostname().split('.')[0]), path.basename(os.homedir())];
  if (process.platform === 'darwin') {
    const name = run('id', ['-F']);
    words.push(name, ...name.split(/\s+/), ...parts(run('scutil', ['--get', 'ComputerName'])), ...parts(run('scutil', ['--get', 'LocalHostName'])));
  } else if (process.platform === 'linux') {
    const name = run('getent', ['passwd', os.userInfo().username]).split(':')[4]?.split(',')[0] || '';
    words.push(name, ...name.split(/\s+/));
  }
  const generic = /^(?:admin|administrator|user|users|root|runner|guest|owner|local|localhost|mac|macbook|imac|pro|air|mini|studio|computer|desktop|laptop|pc)$/i;
  return [...new Set(words.map(w => w.trim()).filter(w => w.length >= 3 && !generic.test(w)))];
}
const COMPUTER = computerWords().map(w => new RegExp('(?<![A-Za-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'gi'));

const mask = text => {
  const s = text.replace(/\s+/g, ' ').trim();
  const at = s.lastIndexOf('@');
  if (at > 0 && /^[^\s:/]+@[^\s]+$/.test(s)) return s[0] + '***' + s.slice(at);
  return s.length <= 6 ? s[0] + '***' : s.slice(0, Math.min(6, Math.floor(s.length / 3))) + '***' + s.slice(-2);
};

/** Findings in one piece of text: {name, line, rule, what, sample}. line is null for readable strings pulled from a binary file. */
export function scanText(name, text, {binary = false} = {}) {
  const found = [];
  let breaks = null;
  const lineAt = index => {
    if (binary) return null;
    breaks ??= [...text.matchAll(/\n/g)].map(m => m.index);
    let lo = 0, hi = breaks.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (breaks[mid] < index) lo = mid + 1; else hi = mid; }
    return lo + 1;
  };
  for (const [rule, what, pattern, keep] of RULES)
    for (const m of text.matchAll(pattern)) if (!keep || keep(m)) found.push({name, line: lineAt(m.index), rule, what, sample: mask(m[0])});
  for (const pattern of COMPUTER)
    for (const m of text.matchAll(pattern)) found.push({name, line: lineAt(m.index), rule: 'this-computer', what: "this computer's user, owner or computer name", sample: mask(m[0])});
  return found;
}

/** Readable strings in a binary file: ASCII and UTF-16 runs of six or more characters, one per line. */
function readableStrings(bytes) {
  const latin = bytes.toString('latin1');
  const ascii = latin.match(/[\x20-\x7e]{6,}/g) || [];
  const wide = (latin.match(/(?:[\x20-\x7e]\x00){6,}/g) || []).map(s => s.replace(/\x00/g, ''));
  return ascii.concat(wide).join('\n');
}

/** The entries of a ZIP: [name, bytes]. Stored and deflated entries only, which is all the kit's tools make. */
function* zipEntries(bytes) {
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw Error('not a readable ZIP');
  let p = bytes.readUInt32LE(end + 16);
  for (let i = 0, count = bytes.readUInt16LE(end + 10); i < count; i++) {
    if (bytes.readUInt32LE(p) !== 0x02014b50) throw Error('damaged ZIP directory');
    const method = bytes.readUInt16LE(p + 10), packed = bytes.readUInt32LE(p + 20), nameLength = bytes.readUInt16LE(p + 28);
    const extra = bytes.readUInt16LE(p + 30), comment = bytes.readUInt16LE(p + 32), local = bytes.readUInt32LE(p + 42);
    const name = bytes.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    p += 46 + nameLength + extra + comment;
    if (name.endsWith('/')) continue;
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28), data = bytes.subarray(start, start + packed);
    if (method === 0) yield [name, data];
    else if (method === 8) yield [name, inflateRawSync(data)];
    else throw Error(name + ' uses a ZIP compression this scanner cannot read');
  }
}

/** Findings in one file's bytes, whatever kind of file it is. */
export function scanBuffer(name, bytes) {
  const found = [];
  for (const [pattern, what] of FILES) if (pattern.test(name)) found.push({name, line: null, rule: 'secret-file', what, sample: path.posix.basename(name)});
  try {
    if (/\.zip$/i.test(name)) {
      for (const [entry, data] of zipEntries(bytes)) found.push(...scanBuffer(name + '!' + entry, data));
      return found;
    }
    if (/\.blend\d*$/i.test(name) && bytes.subarray(0, 7).toString('latin1') !== 'BLENDER') bytes = zstdDecompressSync(bytes);
  } catch (error) {
    return [...found, {name, line: null, rule: 'unreadable', what: 'a file that could not be opened to check: ' + error.message, sample: ''}];
  }
  const binary = bytes.subarray(0, 65536).includes(0);
  return [...found, ...scanText(name, binary ? readableStrings(bytes) : bytes.toString('utf8'), {binary})];
}

/** Every file under a folder, relative to it, hidden ones included; build scratch, caches and .git left out. */
export function filesIn(folder, base = '') {
  return readdirSync(path.join(folder, base), {withFileTypes: true}).flatMap(entry => {
    const p = path.posix.join(base, entry.name);
    if (SKIP.test(p) || entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? filesIn(folder, p) : [p];
  });
}

/** Findings in files given by absolute path, named relative to base. */
export function scanFiles(files, base) {
  return files.flatMap(file => scanBuffer(path.relative(base, file).split(path.sep).join('/'), readFileSync(file)));
}

/** Findings in a git repository's history: author and committer addresses, commit messages and every file version.
 *  onlyNew limits it to commits and files that no remote has yet, which is what a push would publish. */
export async function scanGit(repo, {onlyNew = false} = {}) {
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], {encoding: 'utf8', maxBuffer: 1 << 30});
  const revs = onlyNew ? ['--branches', '--tags', '--not', '--remotes'] : ['--all'];
  const found = [];
  for (const line of git('log', ...revs, '--format=%H%x09%ae%x09%ce').split('\n').filter(Boolean)) {
    const [commit, ...addresses] = line.split('\t');
    for (const address of new Set(addresses)) if (!ALLOWED_MAIL.test(address))
      found.push({name: 'commit ' + commit.slice(0, 12), line: null, rule: 'commit-address', what: 'an author or committer address that is not a no-reply address', sample: mask(address)});
  }
  for (const line of git('for-each-ref', 'refs/tags', '--format=%(refname:short)%09%(taggeremail)').split('\n').filter(Boolean)) {
    const [tag, address = ''] = line.split('\t'), bare = address.replace(/[<>]/g, '');
    if (bare && !ALLOWED_MAIL.test(bare)) found.push({name: 'tag ' + tag, line: null, rule: 'commit-address', what: 'a tagger address that is not a no-reply address', sample: mask(bare)});
  }
  for (const record of git('log', ...revs, '--format=%H%x00%B%x01').split('\x01')) {
    const [commit, message] = record.replace(/^\n/, '').split('\x00');
    if (message) found.push(...scanText('commit ' + commit.slice(0, 12) + ' message', message));
  }
  const paths = new Map();
  for (const line of git('rev-list', '--objects', ...revs).split('\n')) {
    const space = line.indexOf(' ');
    if (space > 0 && !paths.has(line.slice(0, space))) paths.set(line.slice(0, space), line.slice(space + 1));
  }
  const types = spawnSync('git', ['-C', repo, 'cat-file', '--batch-check=%(objecttype) %(objectname)'], {input: [...paths.keys()].join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 30}).stdout;
  const blobs = types.split('\n').filter(l => l.startsWith('blob ')).map(l => l.slice(5));
  const seen = new Set();
  await new Promise((resolve, reject) => {
    const cat = spawn('git', ['-C', repo, 'cat-file', '--batch']);
    let buffer = Buffer.alloc(0), header = null;
    cat.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (!header) {
          const newline = buffer.indexOf(10); if (newline < 0) break;
          const [sha, , size] = buffer.subarray(0, newline).toString().split(' ');
          header = {sha, size: +size}; buffer = buffer.subarray(newline + 1);
        }
        if (buffer.length < header.size + 1) break;
        const name = paths.get(header.sha);
        for (const f of scanBuffer(name, buffer.subarray(0, header.size))) {
          const key = f.name + f.rule + f.sample;
          if (!seen.has(key)) { seen.add(key); found.push({...f, name: f.name + ' (blob ' + header.sha.slice(0, 12) + ')'}); }
        }
        buffer = buffer.subarray(header.size + 1); header = null;
      }
    });
    cat.on('error', reject); cat.on('close', code => code ? reject(Error('git cat-file failed')) : resolve());
    cat.stdin.end(blobs.join('\n') + '\n');
  });
  return found;
}

export const describe = f => f.name + (f.line ? ':' + f.line : '') + '  ' + f.what + (f.sample ? ' (' + f.sample + ')' : '') + '  [' + f.rule + ']';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let found;
  if (args[0] === '--git' || args[0] === '--git-new') found = await scanGit(path.resolve(args[1] || '.'), {onlyNew: args[0] === '--git-new'});
  else if (!args.length) found = scanFiles(filesIn(KIT).map(f => path.join(KIT, f)), KIT);
  else found = args.flatMap(arg => {
    const full = path.resolve(arg);
    return scanFiles(lstatSync(full).isDirectory() ? filesIn(full).map(f => path.join(full, f)) : [full], args.length > 1 || !lstatSync(full).isDirectory() ? path.dirname(full) : full);
  });
  const counts = new Map();
  for (const f of found) { const line = describe(f); counts.set(line, (counts.get(line) || 0) + 1); }
  for (const [line, count] of counts) console.log(line + (count > 1 ? '  x' + count : ''));
  console.log(found.length ? found.length + ' finding(s). Remove them, or replace them with placeholders, before sharing.' : 'No passwords, keys, tokens, personal details or computer names found.');
  process.exitCode = found.length ? 1 : 0;
}
