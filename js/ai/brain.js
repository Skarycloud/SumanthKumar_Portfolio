/* ===================================================================
 * S2-K1 local brain - main-thread wrapper around js/ai/worker.js
 *
 * Nothing loads until wake() is called. The worker is created lazily,
 * so visitors who never use the AI pay nothing for it.
 * ------------------------------------------------------------------- */

export const AI_DEBUG = false;

export const MODEL = {
    id    : 'onnx-community/LFM2.5-350M-ONNX',
    name  : 'LFM2.5 350M',
    sizeMB: 258,
};

const listeners = new Set();
let worker = null;
let seq = 0;
const pending = new Map();
const files = {};

export const brain = {
    state    : 'idle',          // idle | unsupported | loading | ready | error
    progress : 0,               // 0..1 while downloading
    phase    : '',              // human-readable loading phase
    device   : null,
    loadMs   : 0,
};

function emit() { listeners.forEach(function(fn) { try { fn(brain); } catch (e) {} }); }

export function onBrain(fn) { listeners.add(fn); fn(brain); return function() { listeners.delete(fn); }; }

function set(patch) { Object.assign(brain, patch); emit(); }

let supportCheck = null;
export function checkSupport() {
    if (supportCheck) return supportCheck;
    supportCheck = (async function() {
        try {
            if (!('gpu' in navigator) || typeof Worker === 'undefined') return false;
            const adapter = await navigator.gpu.requestAdapter();
            return !!adapter;
        } catch (e) { return false; }
    })().then(function(ok) {
        if (!ok && brain.state === 'idle') set({ state: 'unsupported' });
        return ok;
    });
    return supportCheck;
}

export async function wake() {
    if (brain.state === 'loading' || brain.state === 'ready') return;
    if (!(await checkSupport())) { set({ state: 'unsupported' }); return; }

    set({ state: 'loading', progress: 0, phase: 'Initializing…' });

    if (!worker) {
        worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', function(e) {
            console.error('[S2-K1 brain] worker error', e);
            set({ state: 'error', phase: '' });
        });
    }
    worker.postMessage({ type: 'load' });
}

function onMessage(e) {
    const m = e.data || {};

    if (m.type === 'progress') {
        files[m.file] = [m.loaded, m.total];
        let loaded = 0, total = 0;
        Object.keys(files).forEach(function(k) { loaded += files[k][0]; total += files[k][1]; });
        const p = total ? loaded / total : 0;
        set({ progress: p, phase: p > 0.9 ? 'Almost there…' : 'Loading my tiny brain…' });
    }
    else if (m.type === 'status') {
        if (m.status === 'warming') set({ progress: 1, phase: 'Almost there…' });
    }
    else if (m.type === 'ready') {
        set({ state: 'ready', progress: 1, phase: 'Online', device: m.device, loadMs: m.ms });
        if (AI_DEBUG) console.info('[S2-K1 brain] ready on', m.device, 'in', m.ms, 'ms');
    }
    else if (m.type === 'token' && pending.has(m.id)) {
        const p = pending.get(m.id);
        p.text += m.text;
        p.onToken(p.text);
    }
    else if (m.type === 'done' && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (AI_DEBUG) console.info('[S2-K1 brain]', m.tokens, 'tokens in', m.ms, 'ms');
        p.resolve({ text: m.text, tokens: m.tokens, ms: m.ms });
    }
    else if (m.type === 'error') {
        console.error('[S2-K1 brain]', m.message);
        if (m.id != null && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            clearTimeout(p.timer);
            p.reject(new Error(m.message));
        } else {
            set({ state: m.message === 'webgpu-unavailable' ? 'unsupported' : 'error', phase: '' });
        }
    }
}

export function generate(messages, onToken, opts) {
    opts = opts || {};
    if (brain.state !== 'ready') return Promise.reject(new Error('brain not ready'));
    const id = ++seq;
    return new Promise(function(resolve, reject) {
        const entry = { text: '', onToken: onToken || function() {}, resolve: resolve, reject: reject };
        // a stuck generation should never lock the chat
        entry.timer = setTimeout(function() {
            worker.postMessage({ type: 'stop' });
        }, opts.timeout || 30000);
        pending.set(id, entry);
        worker.postMessage({ type: 'generate', id: id, messages: messages, options: { max_new_tokens: opts.max_new_tokens || 96 } });
    });
}
