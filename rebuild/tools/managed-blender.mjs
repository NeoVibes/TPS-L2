// A separate Node process watches the build's stdin pipe. If the build disappears, this
// process terminates and reaps its Blender child; no Python thread runs inside Blender.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = fileURLToPath(import.meta.url);

async function stopOrphan(pid) {
  if (!pid) return false;
  try { process.kill(pid, 'SIGKILL'); }
  catch (error) { return error.code === 'ESRCH'; }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { return error.code === 'ESRCH'; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return false;
}

/** Run one managed stage. Resolves only after Blender and the supervisor have closed. */
export function runManagedBlender({executable, args = [], cwd, env = process.env, onStdout = () => {}, onStderr = () => {}, onSpawn = () => {}, signal, graceMs = 1500}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { resolve({code: null, signal: null, cancelled: true, pid: null}); return; }
    const supervisor = spawn(process.execPath, [here, '--worker'], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
    let buffer = '', result, failure, blenderPid = null;
    const cancel = () => { supervisor.stdin.end(); };
    signal?.addEventListener('abort', cancel, {once: true});
    supervisor.stdin.on('error', error => { if (error.code !== 'EPIPE') failure ||= error; });
    supervisor.stderr.on('data', data => onStderr(data));
    supervisor.on('error', error => { failure ||= error; });
    supervisor.stdout.on('data', data => {
      buffer += data.toString('utf8');
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const message = JSON.parse(line);
          if (message.type === 'ready') {
            if (signal?.aborted) cancel();
            else supervisor.stdin.write(JSON.stringify({executable, args, cwd, env, graceMs}) + '\n');
          } else if (message.type === 'spawn') { blenderPid = message.pid; onSpawn(message.pid); }
          else if (message.type === 'stdout') onStdout(Buffer.from(message.data, 'base64'));
          else if (message.type === 'stderr') onStderr(Buffer.from(message.data, 'base64'));
          else if (message.type === 'result') result = message.result;
          else if (message.type === 'error') failure ||= Error(message.message);
          else throw Error('Unknown supervisor message.');
        } catch (error) { failure ||= error; cancel(); }
      }
    });
    supervisor.on('close', async (code, exitSignal) => {
      signal?.removeEventListener('abort', cancel);
      if (failure || !result || code !== 0) {
        // An unexpectedly killed supervisor cannot reap its child. Stop the known child if
        // still present, and report failure; this is not a process-tree or power-loss guarantee.
        const stopped = result || await stopOrphan(blenderPid);
        const error = failure || Error('Blender supervisor ended unexpectedly (' + (exitSignal || code) + '). Inspect managed child PID ' + blenderPid + '.');
        if (!stopped) {
          error.preserveBuildLock = true;
          error.message += ' Child termination could not be confirmed; preserve the build lock until all managed processes are stopped.';
        }
        reject(error);
      } else resolve(result);
    });
  });
}

async function supervise() {
  let child, started = false, stopping = false, finished = false, escalation, input = '';
  const send = message => { if (!process.stdout.destroyed) process.stdout.write(JSON.stringify(message) + '\n'); };
  // The build may be killed while logs are being forwarded. An EPIPE must cancel the child,
  // rather than crash the supervisor and strand it.
  process.stdout.on('error', () => stop());
  process.stderr.on('error', () => stop());
  function finish(result) {
    if (finished) return;
    finished = true;
    clearTimeout(escalation);
    send({type: 'result', result});
    process.stdin.destroy();
  }
  function stop() {
    if (stopping || finished) return;
    stopping = true;
    if (!child) { finish({code: null, signal: null, cancelled: true, pid: null}); return; }
    try { child.kill('SIGTERM'); } catch {}
    escalation = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, child.graceMs);
  }
  process.stdin.on('end', stop);
  process.stdin.on('error', stop);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.stdin.on('data', data => {
    if (started || stopping) return;
    input += data.toString('utf8');
    if (input.length > 1024 * 1024) { send({type: 'error', message: 'Managed Blender configuration is too large.'}); stop(); return; }
    const newline = input.indexOf('\n');
    if (newline < 0) return;
    started = true;
    let config;
    try {
      config = JSON.parse(input.slice(0, newline));
      if (typeof config.executable !== 'string' || !Array.isArray(config.args) || config.args.some(arg => typeof arg !== 'string')) throw Error('Invalid managed Blender command.');
      if (!Number.isFinite(config.graceMs) || config.graceMs < 0 || config.graceMs > 60000) throw Error('Invalid cancellation grace period.');
    } catch (error) { send({type: 'error', message: error.message}); stop(); return; }
    // Give an EOF already queued beside the configuration a chance to cancel before spawn.
    setImmediate(() => {
      if (stopping) return;
      child = spawn(config.executable, config.args, {cwd: config.cwd, env: config.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true});
      child.graceMs = config.graceMs;
      child.once('spawn', () => send({type: 'spawn', pid: child.pid}));
      child.stdout.on('data', data => send({type: 'stdout', data: data.toString('base64')}));
      child.stderr.on('data', data => send({type: 'stderr', data: data.toString('base64')}));
      child.once('error', error => send({type: 'error', message: 'Could not start managed Blender: ' + error.message}));
      child.once('close', (code, signal) => finish({code, signal, cancelled: stopping, pid: child.pid ?? null}));
    });
  });
  send({type: 'ready'});
}

if (process.argv[1] === here && process.argv[2] === '--worker') await supervise();
