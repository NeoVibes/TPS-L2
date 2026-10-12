// node publish/release.mjs [output folder] [previous files list]
//
// Makes the download ZIP from the kit folder as it is, and stops if anything should not ship.
// It needs no git. It checks, in order: the kit's rules; that view/ is up to date and the model is
// in its accepted state; that the Blender file holds no folder path from this computer; and that no
// text file names this computer's user, host or a home folder. Then it writes the ZIP, its checksum
// and its file list, and shows what was added or removed since the last list so a person can review it.
//
// What ships: every file in the kit except the build's scratch folders, hidden files and backup or
// archive files. The same files always give the same ZIP, byte for byte, on a given day.
import {readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateRawSync, crc32} from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import {KIT, VIEW, ROOT, json} from '../rebuild/tools/integrity.mjs';
import {checkKit} from '../rebuild/tools/check.mjs';
import {fingerprintView, describeChanges} from '../rebuild/tools/compare.mjs';

const stop = reasons => { for (const r of reasons) console.error('STOP  ' + r); console.error('\nNo ZIP was made.'); process.exit(1); };
const SCRATCH = new Set(['rebuild/build', 'rebuild/node_modules', 'view.staging', 'view.previous']);   // recreated by "npm ci" and "npm run build"
const LEFT_OUT = /(^|\/)\.|(^|\/)__pycache__$|\.(pyc|blend\d+|zip|log)$/;                              // hidden files and folders, caches, Blender backups, archives, logs

/** The files that ship, relative to the kit folder, and the things lying in it that do not. */
export function shippingFiles() {
  const ship = [], leftOut = [];
  (function visit(folder) {
    for (const entry of readdirSync(path.join(KIT, folder), {withFileTypes: true})) {
      const p = path.posix.join(folder, entry.name);
      if (SCRATCH.has(p)) continue;
      if (LEFT_OUT.test(p)) { leftOut.push(p + (entry.isDirectory() ? '/' : '')); continue; }
      if (entry.isSymbolicLink()) throw Error('Links are not allowed in the kit: ' + p);
      if (entry.isDirectory()) visit(p); else ship.push(p);
    }
  })('');
  return {ship: ship.sort(), leftOut: leftOut.sort()};
}

/** A ZIP of the given files under one top folder. Every entry carries the same date, so equal content gives equal bytes. */
export function zipFiles(files, prefix, date) {
  const dosTime = 0, dosDate = (date.getUTCFullYear() - 1980) << 9 | (date.getUTCMonth() + 1) << 5 | date.getUTCDate();
  const local = [], central = []; let offset = 0;
  for (const file of files) {
    const data = readFileSync(path.join(KIT, file)), packed = deflateRawSync(data, {level: 9}), name = Buffer.from(prefix + '/' + file);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8);   // UTF-8 names, deflate
    header.writeUInt16LE(dosTime, 10); header.writeUInt16LE(dosDate, 12); header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(3 << 8 | 20, 4); header.copy(entry, 6, 4, 30);    // made on a Unix-like system; then the same fields as above
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); entry.writeUInt32LE(offset, 42);                             // an ordinary file anyone may read
    local.push(header, name, packed); central.push(entry, name); offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

if (process.argv[1]?.endsWith('release.mjs')) {
  const reasons = [];
  const {errors, warnings, facts} = await checkKit();
  reasons.push(...errors, ...warnings);
  if (!errors.length) {
    const changed = describeChanges(JSON.parse(readFileSync(path.join(ROOT, 'accepted.json'), 'utf8')), await fingerprintView(VIEW));
    if (changed.length) reasons.push('The model differs from its accepted state in ' + changed.length + ' place(s). Review them with npm test, then npm run accept.');
  }
  const {ship, leftOut} = shippingFiles();
  // Words that identify this computer or its user must not appear in any text file that ships.
  const personal = [os.userInfo().username, os.hostname().split('.')[0], path.basename(os.homedir())].filter(w => w && w.length > 2);
  const home = /(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[A-Za-z0-9._-]+/;
  for (const file of ship) {
    if (!/\.(md|mjs|js|py|json|csv|html|css|yml|txt)$/.test(file) || file.startsWith('view/geometry/')) continue;
    const text = readFileSync(path.join(KIT, file), 'utf8');
    for (const word of personal) if (text.toLowerCase().includes(word.toLowerCase())) reasons.push(file + ' contains "' + word + '", a name from this computer');
    const found = text.match(home);
    if (found && !/tools\/(check|blend_file)\.mjs$|publish\/(release\.mjs|clean_blender_file\.py)$/.test(file)) reasons.push(file + ' contains a home-folder path: ' + found[0]);
  }
  const outDir = path.resolve(process.argv[2] || path.join(KIT, '..'));
  if (outDir === KIT || outDir.startsWith(KIT + path.sep)) reasons.push('The output folder is inside the kit. Choose one outside it, so this ZIP and its lists are not packed into the next one.');
  if (reasons.length) stop(reasons);

  const version = (await json('config/release.json')).version, name = 'Portable Tape Player-v' + version, zip = path.join(outDir, name + '.zip');
  mkdirSync(outDir, {recursive: true});
  const now = new Date(), bytes = zipFiles(ship, name, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())));
  writeFileSync(zip, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex'), listFile = path.join(outDir, name + '-files.txt');
  writeFileSync(zip + '.sha256', sha256 + '  ' + name + '.zip\n');
  const previousList = process.argv[3] && existsSync(process.argv[3]) ? readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean) : null;
  writeFileSync(listFile, ship.join('\n') + '\n');
  console.log('Wrote ' + zip + '\n  ' + ship.length + ' files, ' + (bytes.length / 1e6).toFixed(1) + ' MB, SHA-256 ' + sha256);
  if (leftOut.length) console.log('Left out (hidden files, caches, backups, archives): ' + leftOut.slice(0, 8).join(', ') + (leftOut.length > 8 ? ' and ' + (leftOut.length - 8) + ' more' : ''));
  if (previousList) {
    const added = ship.filter(f => !previousList.includes(f)), removed = previousList.filter(f => !ship.includes(f));
    console.log('Since the previous list: ' + added.length + ' added, ' + removed.length + ' removed.');
    for (const f of added) console.log('  + ' + f); for (const f of removed) console.log('  - ' + f);
  } else console.log('Review the file list: ' + listFile + ' (pass a previous list as the second argument to see what changed).');
  console.log('Blender ' + (JSON.parse(readFileSync(path.join(VIEW, 'build-record.json'), 'utf8')).built_with.blender) + ' built this view/. ' + facts.parts + ' parts.');
}
