/* ===================================================================
 * S2-K1 local brain - Web Worker
 *
 * Runs a small language model entirely in the visitor's browser with
 * Transformers.js. Model weights download once from Hugging Face and
 * are cached by the browser; prompts and replies never leave the
 * device. Lives in a worker so the page stays smooth while it thinks.
 * ------------------------------------------------------------------- */

import { pipeline, TextStreamer, InterruptableStoppingCriteria, env }
    from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

const MODEL_ID = 'onnx-community/LFM2.5-350M-ONNX';

env.allowLocalModels = false;       // always fetch from the Hugging Face hub
env.useBrowserCache  = true;        // ...and keep the files in the Cache API

let generator = null;
let device = null;
let loading = null;
const stopper = new InterruptableStoppingCriteria();

async function hasWebGPU() {
    try {
        if (!self.navigator || !navigator.gpu) return false;
        const adapter = await navigator.gpu.requestAdapter();
        return !!adapter;
    } catch (e) { return false; }
}

function progress(info) {
    // forward per-file download progress; the page aggregates it
    if (info && info.status === 'progress' && info.total) {
        self.postMessage({ type: 'progress', file: info.file, loaded: info.loaded, total: info.total });
    }
}

async function load(prefer) {
    if (generator) return;
    if (loading) return loading;

    loading = (async function() {
        const started = performance.now();
        const gpu = prefer !== 'wasm' && await hasWebGPU();
        // WebGPU only: this model's quantised weights use an operator the
        // WASM/CPU runtime doesn't implement, and a 350M model on a phone CPU
        // would be too slow anyway. Without WebGPU the chat stays scripted.
        if (!gpu) throw new Error('webgpu-unavailable');
        const attempts = [{ device: 'webgpu', dtype: 'q4f16' }];

        let lastError = null;
        for (const opts of attempts) {
            try {
                self.postMessage({ type: 'status', status: 'loading', device: opts.device });
                generator = await pipeline('text-generation', MODEL_ID, { ...opts, progress_callback: progress });
                device = opts.device;

                // warm-up: compiles shaders / kernels so the first real reply is quick
                self.postMessage({ type: 'status', status: 'warming', device: device });
                await generator([{ role: 'user', content: 'hi' }], { max_new_tokens: 1, do_sample: false });

                self.postMessage({ type: 'ready', device: device, model: MODEL_ID, ms: Math.round(performance.now() - started) });
                return;
            } catch (e) {
                lastError = e;
                generator = null;
                console.warn('[S2-K1 brain] ' + opts.device + ' failed, trying next option', e);
            }
        }
        throw lastError || new Error('No backend could load the model');
    })();

    try {
        await loading;
    } catch (e) {
        loading = null;
        self.postMessage({ type: 'error', message: String(e && e.message || e) });
    }
}

async function generate(id, messages, options) {
    if (!generator) { self.postMessage({ type: 'error', id: id, message: 'Model not loaded' }); return; }

    stopper.reset();
    const started = performance.now();
    let tokens = 0;

    const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: function(text) {
            tokens++;
            self.postMessage({ type: 'token', id: id, text: text });
        },
    });

    try {
        const out = await generator(messages, {
            max_new_tokens     : options.max_new_tokens || 110,
            do_sample          : false,
            repetition_penalty : 1.05,
            streamer           : streamer,
            stopping_criteria  : stopper,
        });
        const text = out[0].generated_text.at(-1).content;
        self.postMessage({ type: 'done', id: id, text: text, tokens: tokens, ms: Math.round(performance.now() - started) });
    } catch (e) {
        self.postMessage({ type: 'error', id: id, message: String(e && e.message || e) });
    }
}

self.addEventListener('message', function(e) {
    const msg = e.data || {};
    if (msg.type === 'load') load(msg.prefer);
    else if (msg.type === 'generate') generate(msg.id, msg.messages, msg.options || {});
    else if (msg.type === 'stop') stopper.interrupt();
});
