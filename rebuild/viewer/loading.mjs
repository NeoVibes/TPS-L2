// Loads geometry files when they are first needed, checks them and unpacks them.
import {loadDataFile} from './data.mjs';

const fromBase64 = text => Uint8Array.fromBase64 ? Uint8Array.fromBase64(text) : Uint8Array.from(atob(text), c => c.charCodeAt(0));

export function createLoader(config, onProgress = () => {}) {
  const pending = new Map();
  return {load(name) {
    if (pending.has(name)) return pending.get(name);
    const entry = config.packages[name];
    const task = (async () => {
      if (!entry) throw new Error(`Unknown geometry package: ${name}`);
      onProgress(`Loading ${name}…`);
      const compressed = fromBase64(await loadDataFile(name, entry.file));
      if (crypto.subtle) {
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', compressed))].map(x=>x.toString(16).padStart(2,'0')).join('');
        if(digest !== entry.sha256) throw new Error(`${name} failed its integrity check`);
      }
      if (!globalThis.DecompressionStream) throw new Error('This browser needs gzip streaming support. Use a current Chrome, Firefox or Safari.');
      return new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    })();
    pending.set(name, task);
    task.catch(() => pending.delete(name));   // a failed load can be tried again
    return task;
  }};
}
