/* ===================================================================
 * S2-K1 - a droid assistant for the portfolio
 *
 * Hybrid brain: known questions get exact scripted answers; everything
 * else can go to a small language model running locally in the
 * browser (js/ai/), fed only the relevant portfolio facts.
 *
 * No AI model and no network: questions are matched against a small
 * knowledge base written from the portfolio content. The face is a
 * Blobatar (MIT, vendored in js/vendor/blobatar) with expressions and
 * eyes that follow the pointer.
 * ------------------------------------------------------------------- */

import { _parts } from './vendor/blobatar/internal.js';
import { gaze } from './vendor/blobatar/gaze.js';
import * as EX from './vendor/blobatar/expression.js';
import { brain, onBrain, wake, generate, checkSupport, MODEL, AI_DEBUG } from './ai/brain.js';

// debug output: set AI_DEBUG in js/ai/brain.js, or add ?ai-debug to the URL
const DEBUG = AI_DEBUG || /[?&]ai-debug\b/.test(location.search);


/* -------------------------------------------------------------------
 * Face
 * ------------------------------------------------------------------- */
const BOT = 'S2-K1';
const BLOB_NAME = 'sumanth';
// round body, neutral silver that sits quietly on the dark theme
const BLOB_OPTS = { palette: { head: '#D6D6D3', eye: '#121212' }, traits: { shape: 0.11 }, animate: 'always' };

function createFace(size) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('blob-face');
    if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(g);

    let varKeys = [];
    let inner = '';

    function set(expression) {
        const t = _parts(BLOB_NAME, { ...BLOB_OPTS, expression: expression || undefined });

        // custom properties carry the pose, so changing them morphs smoothly
        varKeys.forEach(function(k) { if (!(k in (t.vars || {}))) svg.style.removeProperty(k); });
        varKeys = Object.keys(t.vars || {});
        varKeys.forEach(function(k) { svg.style.setProperty(k, t.vars[k]); });

        g.setAttribute('class', t.cls);
        if (t.inner !== inner) { g.innerHTML = t.inner; inner = t.inner; }
    }

    set();
    return { el: svg, set: set };
}


/* -------------------------------------------------------------------
 * Voice: original droid-style beeps, synthesised with Web Audio.
 * No audio files; every chirp is generated, so each one is a little
 * different. Starts only after a click (browser autoplay rules) and
 * can be muted from the chat header.
 * ------------------------------------------------------------------- */
const voice = (function() {
    let ctx = null, master = null;
    let on = true;
    try { on = localStorage.getItem('cb-sound') !== 'off'; } catch (e) {}

    function ready() {
        if (!on) return false;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        if (!ctx) {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = 0.11;
            const comp = ctx.createDynamicsCompressor();
            master.connect(comp);
            comp.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return true;
    }

    // one tone: a sweep from f0 to f1, optionally warbling
    function tone(at, f0, f1, dur, opts) {
        opts = opts || {};
        const t = ctx.currentTime + at;
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        osc.type = opts.type || 'sine';
        osc.frequency.setValueAtTime(f0, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);

        if (opts.wobble) {
            const lfo = ctx.createOscillator();
            const depth = ctx.createGain();
            lfo.frequency.value = opts.wobble;
            depth.gain.value = opts.depth || 120;
            lfo.connect(depth);
            depth.connect(osc.frequency);
            lfo.start(t);
            lfo.stop(t + dur + .02);
        }

        const peak = opts.gain || 1;
        amp.gain.setValueAtTime(0.0001, t);
        amp.gain.exponentialRampToValueAtTime(peak, t + 0.008);
        amp.gain.setValueAtTime(peak, t + Math.max(0.01, dur - 0.025));
        amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

        osc.connect(amp);
        amp.connect(master);
        osc.start(t);
        osc.stop(t + dur + .03);
    }

    const r = function(a, b) { return a + Math.random() * (b - a); };

    const PATTERNS = {
        // bright rising hello
        open: function() {
            tone(0,    900, 1500, .07);
            tone(.08, 1300, 2300, .07);
            tone(.17, 2100, 2500, .22, { wobble: 18, depth: 160 });
        },
        close: function() {
            tone(0,   1800, 1400, .07);
            tone(.09, 1200,  700, .12);
        },
        send: function() {
            tone(0, 1500, 2100, .045, { gain: .6 });
        },
        // the chatter that comes with an answer
        reply: function() {
            const n = 3 + Math.floor(Math.random() * 4);
            let at = 0;
            for (let i = 0; i < n; i++) {
                const f = r(800, 2600);
                const d = r(.035, .085);
                const sweep = Math.random() < .45 ? f * r(.6, 1.6) : f;
                tone(at, f, sweep, d, { type: Math.random() < .25 ? 'triangle' : 'sine', gain: r(.55, .95) });
                at += d + r(.012, .045);
            }
            if (Math.random() < .4) tone(at + .02, 1900, 2300, .16, { wobble: 22, depth: 140, gain: .6 });
        },
        // excited trill for thanks and hiring
        happy: function() {
            for (let i = 0; i < 6; i++) tone(i * .055, 1400 + i * 180, 1700 + i * 200, .045, { gain: .8 });
            tone(.36, 2400, 2900, .18, { wobble: 26, depth: 180, gain: .7 });
        },
        // the sad, falling whistle when it doesn't know
        unsure: function() {
            tone(0,  2200, 2000, .08, { gain: .7 });
            tone(.1, 1900,  520, .5,  { wobble: 9, depth: 90 });
        },
    };

    return {
        play: function(name) {
            if (!PATTERNS[name] || !ready()) return;
            try { PATTERNS[name](); } catch (e) {}
        },
        get on() { return on; },
        set: function(v) {
            on = !!v;
            try { localStorage.setItem('cb-sound', on ? 'on' : 'off'); } catch (e) {}
            if (!on && ctx) ctx.suspend();
        },
    };
})();


/* -------------------------------------------------------------------
 * Knowledge base
 * ------------------------------------------------------------------- */
const LINKS = {
    email    : 'mailto:sumanth.k.0202@gmail.com',
    phone    : 'tel:+918970732689',
    linkedin : 'https://www.linkedin.com/in/sumanth-kumar-230194294',
    github   : 'https://github.com/Skarycloud',
    x        : 'https://x.com/SumanthKum75525',
    instagram: 'https://www.instagram.com/skarycloud/',
    cv       : 'assets/Sumanth_Kumar_Resume.pdf',
};

const a = (href, label) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;

// featured projects map to their card (nth-child in .work__grid) for "Open case study"
const PROJECTS = {
    studio: {
        card: 1, name: 'Mirchi35 Studio',
        keys: ['mirchi35 studio', 'mirchi studio', 'studio app', 'vendor app', 'studio'],
        html: `<b>Mirchi35 Studio</b> is the Android app vendors use on Mirchi35, India's live local-discovery platform, to post live updates, deals and offers. It's <b>live on Google Play</b>.<br><br>Sumanth owned the Figma UI/UX, the React Native + Expo build, frontend architecture, API integration, testing, the Android build and the Play Store launch.<span class="cb-tech">React Native · Expo Router · Redux Toolkit · Axios · Figma</span>`,
        link: ['https://play.google.com/store/apps/details?id=com.mirchi35.studio', 'Google Play'],
    },
    pulse: {
        card: 2, name: 'Mirchi35 Community Connect',
        keys: ['community connect', 'community app', 'connect app', 'community', 'pulse'],
        html: `<b>Mirchi35 Community Connect</b> is a multi-language Android app in the Mirchi35 ecosystem: find nearby businesses, search by radius and chat with vendors. It's <b>live on Google Play</b>.<br><br>Sumanth did the UI/UX, the React Native (Expo) frontend, API integration, testing and the Play Store deployment.<span class="cb-tech">React Native · Expo Router · i18next · Figma</span>`,
        link: ['https://play.google.com/store/apps/details?id=com.mirchi35.pulse', 'Google Play'],
    },
    emenu: {
        card: 3, name: 'eMenu',
        keys: ['emenu', 'e menu', 'digital menu', 'qr menu', 'menu app', 'restaurant', 'restaurants', 'cafe', 'menu'],
        html: `<b>eMenu</b> is a SaaS Sumanth <b>founded</b>: a digital menu platform for restaurants and cafés. Businesses build a menu, share it by QR code and change prices instantly, with no reprinting.<br><br>Features include a drag-and-drop menu builder, a branded customer menu with search, filters and multi-language support, and a dashboard with analytics.<span class="cb-tech">Next.js · Supabase · Prisma · Stripe · Tailwind CSS · shadcn/ui</span>`,
        link: ['https://emenuweb.com/', 'emenuweb.com'],
    },
    gtfive: {
        card: 4, name: 'GT-Five',
        keys: ['gt five', 'gtfive', 'gt 5', 'switches', 'switch', 'electrical', 'sockets'],
        html: `<b>GT-Five</b> is a premium modular switches brand with its own Android app. As a freelancer, Sumanth designed the <b>app UI/UX</b> in Figma (user flows, screens, visual system) plus the <b>logo, posters and banners</b>. Development was done by others.`,
        link: ['https://play.google.com/store/apps/details?id=com.gtfive.gtfive_app', 'Google Play'],
    },
    vakya: {
        name: 'Vakya',
        keys: ['vakya', 'gita', 'bhagavad', 'bhagavad gita', 'verse', 'lock screen'],
        html: `<b>Vakya</b> puts a Bhagavad Gita verse on your lock screen and home screen, every day. Sumanth designed and built the <b>landing page</b> as a freelancer, including a redesign with a light cream theme and colour-blocked sections.<span class="cb-tech">Next.js · React · GSAP · Motion</span>`,
        link: ['https://vakya.fun/', 'vakya.fun'],
    },
    auralion: {
        card: 6, name: 'Auralion Labs',
        keys: ['auralion', 'auralion labs', 'product studio', 'agency'],
        html: `<b>Auralion Labs</b> is a product studio Sumanth <b>co-founded</b>. It designs and builds AI products, web and mobile apps, automation systems and SaaS platforms. He personally designed and built the company website: Figma UI/UX, a Next.js build with motion, a Sanity CMS blog and Cal.com call booking.<span class="cb-tech">Next.js · Tailwind CSS · GSAP · Motion · Sanity CMS</span>`,
        link: ['https://auralionlabs.com/', 'auralionlabs.com'],
    },
    m35web: {
        card: 7, name: 'Mirchi35 Website',
        keys: ['mirchi35 website', 'mirchi website', 'mirchi35com', 'company website', 'mirchi35 site'],
        html: `The <b>Mirchi35 website</b> is the marketing site for the platform. Sumanth worked on it as a frontend developer: UI implementation, the responsive build, optimization and testing.<span class="cb-tech">Next.js · TypeScript · Tailwind CSS · Motion</span>`,
        link: ['https://mirchi35.com/', 'mirchi35.com'],
    },
    wren: {
        card: 8, name: 'Wren',
        keys: ['wren', 'healthcare', 'health care', 'clinic', 'hackathon', 'patient', 'doctor', 'gp'],
        html: `<b>Wren</b> is an agentic waiting-room assistant for GP clinics, built by a team at the <b>All Things Agentic hackathon</b>. An AI agent runs the patient check-in and writes the intake into the chart, and a clinician console turns it into a 30-second brief.<br><br>Sumanth worked on the patient and clinician interfaces, including speech input for the patient chat. It's a hackathon prototype, not a clinical system.<span class="cb-tech">Gemini · Google ADK · Python · Cloud Run · Firestore</span>`,
        link: ['https://allthingsagentichackathon.devpost.com/', 'Devpost'],
    },
    scavenge: {
        card: 5, name: 'Scavenge',
        keys: ['scavenge', 'scavenger', 'scavenger hunt', 'hunt', 'hunts', 'treasure hunt', 'leaderboard'],
        html: `<b>Scavenge</b> is a platform for creating and playing real-world scavenger hunts: team-based gameplay, real-time GPS tracking, live leaderboards and QR-code challenges, for city adventures and corporate team-building.<span class="cb-tech">React · Node.js · Maps API · QR codes</span>`,
        link: ['https://scavenge.rs/', 'scavenge.rs'],
    },
    oryx: {
        name: 'Oryx AI',
        keys: ['oryx', 'oryx ai', 'dataset', 'datasets', 'training data'],
        html: `<b>Oryx AI</b> provides training datasets and evaluation tools for AI/LLM models.<span class="cb-tech">Node.js · React · Python · Tailwind CSS</span>`,
        link: ['https://oryx-ai.vercel.app/', 'oryx-ai.vercel.app'],
    },
    codestack: {
        name: 'Code Stack',
        keys: ['code stack', 'codestack', 'developer tools directory', 'dev tools'],
        html: `<b>Code Stack</b> is an open-source directory of developer tools, frameworks and learning resources.<span class="cb-tech">Next.js · TypeScript · React · Tailwind CSS</span>`,
        link: ['https://codestack-sigma.vercel.app/', 'codestack-sigma.vercel.app'],
    },
    imagepi: {
        name: 'image-π',
        keys: ['image pi', 'imagepi', 'image toolkit', 'image tool', 'image compressor'],
        html: `<b>image-π</b> is a privacy-first image toolkit that runs entirely in the browser: compress, convert, resize and edit images locally, so nothing is uploaded.<span class="cb-tech">React · TypeScript · Canvas API</span>`,
        link: ['https://image-pi-dusky.vercel.app/', 'image-pi-dusky.vercel.app'],
    },
    salary: {
        name: 'Salary Split',
        keys: ['salary split', 'salary', 'budget tool', 'salarysplit'],
        html: `<b>Salary Split</b> breaks a salary into monthly, weekly, daily and hourly figures, and converts it across currencies.<span class="cb-tech">React · API integration</span>`,
        link: ['https://salary-split-three.vercel.app/', 'salary-split-three.vercel.app'],
    },
    terminal: {
        name: 'Terminal Portfolio',
        keys: ['terminal', 'terminal portfolio', 'command line', 'cli portfolio'],
        html: `The <b>Terminal Portfolio</b> is a portfolio you navigate by typing commands, styled like a terminal.<span class="cb-tech">Next.js · React</span>`,
        link: ['https://terminal-portfolio-seven-kohl.vercel.app/', 'terminal-portfolio-seven-kohl.vercel.app'],
    },
};

const TOPICS = ['Who is Sumanth?', 'Show projects', 'Tech stack', 'Experience', 'Work with him'];

const INTENTS = [
    {
        id: 'greet', expr: 'happy',
        keys: ['hi', 'hello', 'hey', 'hii', 'hiya', 'yo', 'namaste', 'hola', 'good morning', 'good evening', 'good afternoon', 'sup', 'howdy'],
        answer: () => `Hey there! I'm <b>S2-K1</b>, Sumanth's droid assistant. Ask me about his projects, skills, experience, or how to work with him.`,
        chips: TOPICS,
    },
    {
        id: 'howareyou', expr: 'happy',
        keys: ['how are you', 'how r u', 'how are u', 'hows it going', 'whats up', 'wassup'],
        answer: () => `Doing great, thanks for asking! What would you like to know about Sumanth?`,
        chips: TOPICS,
    },
    {
        id: 'bot', expr: 'wink',
        keys: ['who are you', 'what are you', 'are you ai', 'are you real', 'are you a bot', 'are you human', 'your name', 'chatgpt', 'gpt', 's2 k1', 's2k1', 'droid', 'robot', 'r2d2', 'r2 d2', 'who made you', 'your sounds', 'beep', 'how do you work'],
        answer: () => `I'm <b>S2-K1</b>, a small droid assistant living on this page. Beep boop! I answer common questions from notes written from Sumanth's portfolio, and I can wake an optional <b>AI brain</b> that runs entirely in your browser for everything else. Either way, nothing you type leaves your device.`,
        chips: ['How were you built?', 'Who is Sumanth?'],
    },
    {
        id: 'howbuilt', expr: 'happy',
        keys: ['how were you built', 'how was this built', 'how are you built', 'how does this ai work', 'how does the ai work', 'local ai', 'on device', 'webgpu', 'transformers js', 'transformersjs', 'which model', 'what model', 'llm', 'language model', 'ai brain', 'your brain', 'tiny brain'],
        weight: 1.3,
        answer: () => `I'm a hybrid. Common questions get exact answers from my notes, so I never get Sumanth's facts wrong. For everything else I can wake <b>${MODEL.name}</b>, a small language model that runs <b>inside your browser</b> with Transformers.js and WebGPU: no server, no API key, and your messages never leave your device. It's a one-time ~${MODEL.sizeMB} MB download that your browser then caches. Sumanth built me with plain HTML, CSS and JavaScript.`,
        chips: ['Who is Sumanth?', 'Show projects'],
    },
    {
        id: 'about',
        keys: ['who is sumanth', 'about sumanth', 'who is he', 'about him', 'tell me about him', 'introduce', 'introduction', 'background', 'bio', 'profile', 'summary', 'sumanth', 'sumanth kumar'],
        answer: () => `<b>Sumanth Kumar</b> is a full-stack developer and AI product builder from Mangalore, India. He designs and builds products for web and mobile, from the Figma file to the Play Store listing.<br><br>By day he's at <b>Mirchi35</b>, where he's shipped two Android apps to Google Play. Outside that he freelances, is building <b>eMenu</b> (a SaaS he founded) and co-founded <b>Auralion Labs</b>.`,
        chips: ['Show projects', 'Experience', 'Tech stack', 'Contact'],
    },
    {
        id: 'projects',
        keys: ['projects', 'project', 'portfolio', 'work', 'his work', 'built', 'build', 'made', 'showcase', 'case study', 'case studies', 'apps', 'products', 'what has he built', 'what did he build'],
        answer: () => `Here's his featured work:<ul class="cb-list">
            <li><b>Mirchi35 Studio</b> and <b>Community Connect</b>: Android apps live on Google Play</li>
            <li><b>eMenu</b>: QR digital menu SaaS he founded</li>
            <li><b>GT-Five</b>: app UI/UX and brand design</li>
                        <li><b>Auralion Labs</b>: his product studio's website</li>
            <li><b>Wren</b>: agentic healthcare assistant (hackathon)</li>
            <li><b>Scavenge</b>: real-world scavenger hunts</li>
            <li><b>Mirchi35 Website</b></li></ul>Plus Vakya, Oryx AI, Code Stack, image-π, Salary Split and a terminal-style portfolio. Ask about any of them!`,
        actions: [{ label: 'See all work', scroll: '#works' }],
        chips: ['Mirchi35 Studio', 'eMenu', 'Wren', 'Scavenge'],
    },
    {
        id: 'skills',
        keys: ['skills', 'skill', 'stack', 'tech stack', 'tech', 'technologies', 'technology', 'tools', 'languages', 'frameworks', 'expertise', 'what can he do', 'good at', 'specialize', 'specialise'],
        answer: () => `His stack:<ul class="cb-list">
            <li><b>Frontend:</b> React, Next.js, JavaScript, TypeScript, Tailwind CSS, Material UI</li>
            <li><b>Mobile:</b> React Native, Expo, Ionic, Capacitor</li>
            <li><b>Backend:</b> Node.js, Express, MongoDB, Firebase, Supabase</li>
            <li><b>AI / Data:</b> Python, AI/ML, agentic AI, data visualization</li>
            <li><b>Design & tools:</b> Figma, Git, Docker, Postman, VS Code</li>
            <li><b>Deploy:</b> Vercel, Netlify, Hostinger, Google Play Console</li></ul>`,
        chips: ['Mobile apps', 'AI work', 'Design work'],
    },
    {
        id: 'mobile',
        keys: ['react native', 'expo', 'mobile', 'android', 'ios', 'mobile app', 'app development', 'play store', 'google play', 'ionic', 'capacitor'],
        answer: () => `Mobile is a big part of his work. At <b>Mirchi35</b> he built and launched two React Native + Expo Android apps that are <b>live on Google Play</b>, covering everything from Figma design to the Play Store release. Earlier, at Ants Applied DataScience, he turned the Portfolio Analyzer web app into an Android app with Ionic / Capacitor.`,
        actions: [
            { label: 'Mirchi35 Studio', href: 'https://play.google.com/store/apps/details?id=com.mirchi35.studio' },
            { label: 'Community Connect', href: 'https://play.google.com/store/apps/details?id=com.mirchi35.pulse' },
        ],
        chips: ['Mirchi35 Studio', 'Community Connect', 'Tech stack'],
    },
    {
        id: 'web',
        keys: ['react', 'nextjs', 'next', 'frontend', 'front end', 'web', 'website', 'websites', 'web app', 'landing page', 'javascript', 'typescript', 'tailwind'],
        answer: () => `On the web he works mostly in <b>React and Next.js</b> with TypeScript and Tailwind CSS. Recent web work includes the <b>eMenu</b> SaaS, the <b>Auralion Labs</b> and <b>Mirchi35</b> websites, and the <b>Vakya</b> landing page, plus motion with GSAP and Motion.`,
        chips: ['eMenu', 'Auralion Labs', 'Tech stack'],
    },
    {
        id: 'backend',
        keys: ['backend', 'back end', 'node', 'nodejs', 'express', 'mongodb', 'database', 'databases', 'api', 'apis', 'rest', 'supabase', 'firebase', 'server', 'full stack', 'fullstack'],
        answer: () => `He's full-stack: alongside frontend and mobile he builds <b>APIs and backends</b> with Node.js and Express, works with MongoDB, Firebase and Supabase, and handles API integration and automation. eMenu, for example, runs on Next.js with Supabase, Prisma and Stripe.`,
        chips: ['eMenu', 'Tech stack', 'Projects'],
    },
    {
        id: 'ai',
        keys: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'llms', 'agent', 'agents', 'agentic', 'gemini', 'prompt', 'prompt engineering', 'automation', 'genai', 'generative'],
        answer: () => `AI is where he spends a lot of his time lately: <b>agentic workflows</b>, AI-powered features, and using AI to prototype fast.<ul class="cb-list">
            <li><b>Wren</b>: agentic healthcare assistant built at a hackathon (Gemini + Google ADK)</li>
            <li><b>Oryx AI</b>: datasets and evaluation tools for LLMs</li>
            <li>He's studying a <b>BCA in AI & Machine Learning</b>, and holds DeepLearning.AI certificates</li></ul>`,
        chips: ['Wren', 'Oryx AI', 'Education'],
    },
    {
        id: 'design',
        keys: ['design', 'designer', 'figma', 'ui', 'ux', 'ui ux', 'uiux', 'branding', 'brand', 'logo', 'graphics', 'prototype', 'prototyping'],
        answer: () => `He designs as well as builds, mostly in <b>Figma</b>: user flows, screens and visual systems. Design work includes the <b>Mirchi35 apps</b>, <b>GT-Five</b> (app UI/UX, logo, posters and banners), the <b>Auralion Labs</b> website and the <b>Vakya</b> landing page.`,
        chips: ['GT-Five', 'Auralion Labs', 'Vakya'],
    },
    {
        id: 'experience',
        keys: ['experience', 'work experience', 'work history', 'career', 'job', 'jobs', 'companies', 'worked', 'employment', 'resume history', 'how many years', 'years', 'previous'],
        answer: () => `<ul class="cb-list">
            <li><b>Mirchi35</b>: Associate MERN Stack Developer & Test Engineer · Nov 2025 – now</li>
            <li><b>Freelance</b>: full-stack developer & UI/UX designer · part-time, now</li>
            <li><b>eMenu</b> (founder) & <b>Auralion Labs</b> (co-founder) · now</li>
            <li><b>Ants Applied DataScience</b>: Frontend Programmer (MEAN) · Nov 2023 – Feb 2025</li>
            <li><b>Ants Applied DataScience</b>: Assistant Software Programmer (intern) · Mar – Oct 2023</li></ul>`,
        actions: [{ label: 'Download CV', href: LINKS.cv, download: true }],
        chips: ['Mirchi35', 'Ants Applied DataScience', 'Education'],
    },
    {
        id: 'mirchi35',
        keys: ['mirchi35', 'mirchi', 'mirchi 35', 'current job', 'current role', 'current company', 'where does he work', 'working now', 'day job'],
        answer: () => `He's an <b>Associate MERN Stack Developer & Test Engineer at Mirchi35</b> (since Nov 2025), India's live local-discovery platform. There he shipped <b>Mirchi35 Studio</b> and <b>Community Connect</b> to Google Play, owning UI/UX, the React Native frontend, API integration, testing and launch, and worked on the <b>Mirchi35 website</b>.`,
        chips: ['Mirchi35 Studio', 'Community Connect', 'Mirchi35 Website'],
    },
    {
        id: 'ants',
        keys: ['ants', 'ants applied', 'ants applied datascience', 'datascience', 'portfolio analyzer', 'solar data lake', 'solar', 'internship', 'intern'],
        answer: () => `At <b>Ants Applied DataScience</b> (2023–2025) he worked first as an intern on data preprocessing, AI/ML workflows and REST APIs, then as a <b>Frontend Programmer (MEAN)</b>. He built financial analytics dashboards for the <b>Ants Portfolio Analyzer</b> and turned it into an Android app with Ionic / Capacitor, built IoT monitoring dashboards for <b>Solar Data Lake</b>, and worked on admin interfaces and AI/data projects.`,
        chips: ['Mirchi35', 'Tech stack'],
    },
    {
        id: 'founder',
        keys: ['founder', 'co founder', 'cofounder', 'startup', 'startups', 'own product', 'own products', 'business', 'entrepreneur', 'saas'],
        answer: () => `He has a founder mindset and builds his own products: he <b>founded eMenu</b>, a digital menu SaaS for restaurants, and <b>co-founded Auralion Labs</b>, a product studio, whose website he designed and built.`,
        chips: ['eMenu', 'Auralion Labs'],
    },
    {
        id: 'hire', expr: 'love',
        keys: ['hire', 'hiring', 'hire him', 'freelance', 'freelancer', 'available', 'availability', 'work with', 'work with him', 'collaborate', 'collaboration', 'build my', 'build me', 'need an app', 'need a website', 'need a developer', 'project for me', 'my project', 'quote', 'rates', 'rate', 'pricing', 'price', 'cost', 'budget', 'charge', 'charges', 'fees', 'opportunity', 'job offer', 'recruiter'],
        answer: () => `He takes on <b>freelance product and design work</b> alongside his role at Mirchi35, from idea and UI/UX to web and mobile apps and AI features.<br><br>The best next step is a short email with what you're building, your timeline and your budget. Pricing depends on scope, so he'll follow up with a quote.`,
        actions: [
            { label: 'Email Sumanth', href: LINKS.email, primary: true },
            { label: 'LinkedIn', href: LINKS.linkedin },
        ],
        chips: ['Show projects', 'Download CV'],
    },
    {
        id: 'contact', expr: 'happy',
        keys: ['contact', 'email', 'mail', 'e mail', 'phone', 'call', 'number', 'mobile number', 'whatsapp', 'reach', 'reach him', 'get in touch', 'message him', 'talk to him', 'linkedin', 'github', 'social', 'socials', 'instagram', 'twitter'],
        answer: () => `You can reach him at:<ul class="cb-list">
            <li><b>Email:</b> ${a(LINKS.email, 'sumanth.k.0202@gmail.com')}</li>
            <li><b>Phone:</b> ${a(LINKS.phone, '+91 89707 32689')}</li>
            <li><b>LinkedIn</b>, <b>GitHub</b>, <b>X</b> and <b>Instagram</b> are linked below</li></ul>`,
        actions: [
            { label: 'Email', href: LINKS.email, primary: true },
            { label: 'LinkedIn', href: LINKS.linkedin },
            { label: 'GitHub', href: LINKS.github },
            { label: 'X', href: LINKS.x },
            { label: 'Instagram', href: LINKS.instagram },
        ],
        chips: ['Work with him', 'Download CV'],
    },
    {
        id: 'cv',
        keys: ['resume', 'cv', 'download cv', 'download resume', 'curriculum vitae', 'pdf'],
        answer: () => `Here's his CV as a PDF.`,
        actions: [{ label: 'Download CV', href: LINKS.cv, primary: true, download: true }],
        chips: ['Experience', 'Contact'],
    },
    {
        id: 'education',
        keys: ['education', 'degree', 'college', 'university', 'study', 'studies', 'studying', 'student', 'bca', 'diploma', 'qualification', 'qualifications', 'manipal', 'polytechnic', 'gpa', 'graduate', 'graduation'],
        answer: () => `<ul class="cb-list">
            <li><b>BCA in Artificial Intelligence & Machine Learning</b>, Manipal University Jaipur (Online) · Sep 2024 – 2027 (expected). He studies on weekends alongside full-time work.</li>
            <li><b>Diploma in Computer Science & Engineering</b>, S J Government Polytechnic · 2021 – 2023 · <b>GPA 9.0</b></li></ul>`,
        chips: ['Certifications', 'Experience'],
    },
    {
        id: 'certs',
        keys: ['certification', 'certifications', 'certificate', 'certificates', 'certified', 'course', 'courses', 'coursera', 'deeplearning'],
        answer: () => `<ul class="cb-list">
            <li>HTML, CSS, and JavaScript for Web Developers · Johns Hopkins University</li>
            <li>Developing Cloud Apps with Node.js and React · IBM</li>
            <li>AI for Everyone · DeepLearning.AI</li>
            <li>ChatGPT Prompt Engineering for Developers · DeepLearning.AI</li>
            <li>Docker for Absolute Beginners · Coursera</li></ul>`,
        chips: ['Education', 'Tech stack'],
    },
    {
        id: 'location',
        keys: ['where', 'location', 'located', 'based', 'live', 'lives', 'city', 'country', 'mangalore', 'mangaluru', 'karnataka', 'india', 'timezone', 'time zone'],
        answer: () => `He's based in <b>Mangalore, Karnataka, India</b> (IST, UTC+5:30).`,
        chips: ['Work with him', 'Contact'],
    },
    {
        id: 'thanks', expr: 'love',
        keys: ['thanks', 'thank you', 'thank u', 'thx', 'ty', 'cool', 'great', 'awesome', 'nice', 'perfect', 'amazing', 'wow', 'helpful'],
        answer: () => `Happy to help! Anything else you'd like to know?`,
        chips: TOPICS,
    },
    {
        id: 'bye', expr: 'wink',
        keys: ['bye', 'goodbye', 'good bye', 'see you', 'see ya', 'cya', 'later', 'take care'],
        answer: () => `Bye for now! If you'd like to work together, Sumanth's inbox is open.`,
        actions: [{ label: 'Email Sumanth', href: LINKS.email }],
    },
    {
        id: 'help',
        keys: ['help', 'what can you do', 'what can i ask', 'options', 'topics', 'menu options', 'commands', 'start'],
        answer: () => `I can tell you about Sumanth's <b>projects</b>, <b>skills</b>, <b>experience</b>, <b>education</b> and <b>certifications</b>, or how to <b>contact</b> or <b>hire</b> him. Try one of these:`,
        chips: TOPICS.concat(['Contact']),
    },
];

// every project is also an intent, matched by name
Object.keys(PROJECTS).forEach(function(id) {
    const p = PROJECTS[id];
    INTENTS.push({
        id: 'project:' + id,
        project: id,
        weight: 1.6,
        keys: p.keys,
        answer: () => p.html,
        actions: [].concat(
            p.card ? [{ label: 'Open case study', caseStudy: p.card, primary: true }] : [],
            p.link ? [{ label: p.link[1], href: p.link[0] }] : []
        ),
        chips: ['Show projects', 'Work with him'],
    });
});

const FALLBACK = {
    id: 'fallback', expr: 'unsure',
    answer: () => `I'm not sure about that one. I know about Sumanth's <b>projects</b>, <b>skills</b>, <b>experience</b>, <b>education</b> and how to <b>reach him</b>. For anything else, he's happy to answer by email.`,
    actions: [{ label: 'Email Sumanth', href: LINKS.email }],
    chips: TOPICS,
};

// chip labels that should resolve to a specific intent
const CHIP_ALIASES = {
    'who is sumanth?': 'about', 'show projects': 'projects', 'tech stack': 'skills', 'experience': 'experience',
    'work with him': 'hire', 'contact': 'contact', 'download cv': 'cv', 'mobile apps': 'mobile', 'ai work': 'ai',
    'design work': 'design', 'education': 'education', 'certifications': 'certs', 'mirchi35': 'mirchi35',
    'ants applied datascience': 'ants', 'projects': 'projects', 'how were you built?': 'howbuilt',
};


/* -------------------------------------------------------------------
 * Matching
 * ------------------------------------------------------------------- */
const STOP = new Set('a an the is are was were be to of for in on at and or me my his him he she it its this that what whats which how do does did can could would should will tell about please show give i you your u some any with by from as so just know want like more'.split(' '));

function normalize(str) {
    return (' ' + String(str).toLowerCase()
        .replace(/π/g, 'pi')
        .replace(/&/g, ' and ')
        .replace(/(\w)\.(\w)/g, '$1$2')          // next.js -> nextjs, mirchi35.com -> mirchi35com
        .replace(/[’']/g, '')                     // what's -> whats
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() + ' ');
}

function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return dp[a.length][b.length];
}

INTENTS.forEach(function(intent) {
    intent.norm = intent.keys.map(function(k) { return normalize(k).trim(); });
});

function score(intent, text, tokens) {
    let s = 0;
    const used = new Set();           // each word in the question counts once per intent

    intent.norm.forEach(function(key) {
        if (key.indexOf(' ') > -1 && text.indexOf(' ' + key + ' ') > -1) {
            s += 3 + key.split(' ').length * 0.5;
            key.split(' ').forEach(function(w) { used.add(w); });
        }
    });
    intent.norm.forEach(function(key) {
        if (key.indexOf(' ') > -1 || used.has(key)) return;
        if (tokens.indexOf(key) > -1) { s += STOP.has(key) ? 0.5 : 2; used.add(key); }
    });
    // tolerate small typos on longer words, for words nothing else matched
    intent.norm.forEach(function(key) {
        if (key.indexOf(' ') > -1 || key.length < 5) return;
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t.length < 4 || used.has(t) || STOP.has(t)) continue;
            const d = lev(t, key);
            if (d === 1 || (d === 2 && key.length >= 8)) { s += d === 1 ? 2 : 1.6; used.add(t); break; }
        }
    });
    return s * (intent.weight || 1);
}

const FOLLOW_UP = /\b(more|details|detail|elaborate|explain|link|links|url|open it|show me|case study|tell me more)\b/;

function match(input, context) {
    const raw = String(input).trim().toLowerCase();
    if (CHIP_ALIASES[raw]) return INTENTS.find(function(i) { return i.id === CHIP_ALIASES[raw]; });

    const text = normalize(input);
    const tokens = text.trim().split(' ').filter(Boolean);
    if (!tokens.length) return null;

    let best = null, bestScore = 0;
    INTENTS.forEach(function(intent) {
        const s = score(intent, text, tokens);
        if (s > bestScore) { best = intent; bestScore = s; }
    });

    // "tell me more" after a project keeps talking about that project
    if (context.project && FOLLOW_UP.test(text) && (!best || bestScore < 3 || best.id === 'projects')) {
        return INTENTS.find(function(i) { return i.project === context.project; });
    }

    return bestScore >= 1.8 ? best : FALLBACK;
}

// every intent with its score, best first (for picking facts to give the model)
function rank(input) {
    const text = normalize(input);
    const tokens = text.trim().split(' ').filter(Boolean);
    return INTENTS
        .map(function(intent) { return { intent: intent, score: score(intent, text, tokens) }; })
        .filter(function(r) { return r.score > 0; })
        .sort(function(a, b) { return b.score - a.score; });
}


/* -------------------------------------------------------------------
 * Local AI: knowledge, guard rails and tone
 * ------------------------------------------------------------------- */
const plain = function(html) {
    // list items and paragraphs become separate sentences, never glued together
    return String(html).replace(/<br\s*\/?>/g, '. ').replace(/<\/li>|<\/ul>|<\/p>/g, '. ').replace(/<span class="cb-tech">/g, '. Tech: ')
        .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&rarr;/g, '->')
        .replace(/\s*\.\s*(\.\s*)+/g, '. ').replace(/:\s*\./g, ':').replace(/\s+/g, ' ').trim();
};

const CORE_FACTS = 'Sumanth Kumar is a full-stack developer and AI product builder from Mangalore, India. He designs and builds web and mobile products, from Figma to the Play Store. He works at Mirchi35, where he shipped two React Native + Expo Android apps to Google Play. He founded eMenu (a QR digital menu SaaS) and co-founded Auralion Labs (a product studio). Email: sumanth.k.0202@gmail.com.';

const SELF_FACTS = "You are S2-K1, a little droid assistant on this portfolio site. Sumanth designed and built the site and you with plain HTML, CSS and JavaScript. Your face is a Blobatar whose eyes follow the cursor, and your droid beeps are synthesised live with the Web Audio API. Your optional AI brain is a small language model running in the visitor's browser with Transformers.js and WebGPU, so messages never leave their device.";
const ABOUT_SELF = /\b(you|your|youre|droid|bot|robot|s2|beep|beeps|sound|sounds|site|website|page|portfolio|animation|chat)\b/i;

// only the facts relevant to this question, so the tiny model stays focused
function factsFor(ranked, text) {
    const picked = ranked.filter(function(r) { return r.score >= 0.5 && ['greet', 'thanks', 'bye', 'help'].indexOf(r.intent.id) === -1; }).slice(0, 2);
    // most relevant topic first: small models lean hardest on what they read first
    const extra = picked.map(function(r) { return plain(r.intent.answer()); }).join(' ');
    const self = ABOUT_SELF.test(text || '') ? ' ' + SELF_FACTS : '';
    return (extra + ' ' + CORE_FACTS + self).trim().slice(0, 1600);
}

// questions about his private life never reach the model, so it can't invent answers
const PERSONAL = /\b(favou?rite|age|how old|birthday|born|married|marriage|wife|girlfriend|boyfriend|partner|dating|single|relationship|salary|earns?|income|net worth|religion|caste|politics?|political|home address|family|parents|father|mother|siblings?|height|weight|food|eat|drink|hobbies|hobby|movie|movies|song|music|pets?)\b/i;

const SENTIMENT = {
    positive: /\b(awesome|amazing|great|love|loved|nice|cool|sick|fire|impressive|beautiful|clean|brilliant|excellent|wow|good job|well done|neat|slick|dope|best)\b/i,
    negative: /\b(bad|boring|ugly|hate|terrible|awful|worst|slow|broken|useless|annoying|meh)\b/i,
    confused: /\b(confused|confusing|dont understand|don t understand|what do you mean|huh|unclear|lost)\b|\?\?/i,
    excited : /!{2,}|\b(omg|lets go|so cool|insane|crazy)\b/i,
    curious : /\b(how|why|curious|wonder)\b/i,
};

function moodOf(text) {
    const t = String(text).toLowerCase().replace(/[’']/g, '');
    if (SENTIMENT.confused.test(t)) return 'confused';
    if (SENTIMENT.negative.test(t)) return 'negative';
    if (SENTIMENT.excited.test(t)) return 'excited';
    if (SENTIMENT.positive.test(t)) return 'positive';
    if (SENTIMENT.curious.test(t)) return 'curious';
    return 'neutral';
}

const MOOD = {
    positive : { expr: 'love',      tone: 'The visitor is being kind. Be warm and a little playful.' },
    excited  : { expr: 'surprised', tone: 'The visitor is excited. Match their energy, briefly.' },
    negative : { expr: 'sad',       tone: 'The visitor is unhappy. Be calm, kind and genuinely helpful. No jokes.' },
    confused : { expr: 'unsure',    tone: 'The visitor is confused. Explain simply and clearly.' },
    curious  : { expr: 'happy',     tone: 'The visitor is curious. Be clear and engaging.' },
    neutral  : { expr: 'happy',     tone: '' },
};

const SYSTEM = `You are S2-K1, a small friendly droid living in Sumanth Kumar's portfolio website. You talk about Sumanth in the third person.
Style: warm, a little witty, confident, never robotic. Reply in 1-2 short sentences in your own words. No emojis.
Rules: use ONLY the FACTS given with the question, and name real projects from them. Never invent jobs, projects, clients, categories, numbers or personal details. If the FACTS don't cover it, say you don't know that one and suggest emailing Sumanth.`;

const FEW_SHOT = [
    { role: 'user', content: 'FACTS: Sumanth builds web and mobile products, from Figma designs to apps on Google Play. He shipped Mirchi35 Studio and Community Connect, two React Native Android apps. He founded eMenu, a QR digital menu SaaS.\n\nQUESTION: what sort of stuff does he make?' },
    { role: 'assistant', content: 'Real products people use: Android apps like Mirchi35 Studio and Community Connect, and eMenu, the QR menu SaaS he founded. Figma to Play Store, all him.' },
    { role: 'user', content: 'FACTS: He designs in Figma: user flows, screens and visual systems. He builds with React, React Native and Node.js, and shipped two Android apps to Google Play.\n\nQUESTION: is he a designer or a coder really?' },
    { role: 'assistant', content: 'Honestly, both. He designs the screens in Figma and then builds them himself in React and React Native, which is how two of his apps made it onto Google Play.' },
    { role: 'user', content: 'FACTS: Sumanth works with React, Next.js and Node.js.\n\nQUESTION: does he play the guitar?' },
    { role: 'assistant', content: "That's outside my memory banks, I only know about his work. You could ask him at sumanth.k.0202@gmail.com!" },
    { role: 'user', content: 'FACTS: Sumanth designs and builds web and mobile products.\n\nQUESTION: this site is really nice' },
    { role: 'assistant', content: "Thank you! I'll pass that along to the human who built it, and to the CSS he argued with." },
];

/* Grounding check: a tiny model sometimes "fills in" plausible details.
 * Each sentence must mostly use words found in the facts it was given
 * (or the question); sentences that don't are dropped. */
const GROUND_OK = new Set('about also because been being both build builds built building could does doing done each even from have here into just like made make makes making more most much only other over really some such than that their them then there these they this those very what when where which while with would your yours youre thank thanks pass along human code love glad happy nice great kind sure honestly definitely probably maybe know memory banks outside ask asking email reach work works working worked people real things stuff product products project projects thing want looking need help helps happen apps app developer design designs designed designing engineering person well good strong solid team great cool fun idea ideas start started startup builder builders handle handles handling shipping ship ships shipped team'.split(' '));

function grounded(reply, facts, question) {
    const vocab = new Set((facts + ' ' + question).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) { return w.length > 2; }));
    const known = function(w) {
        if (w.length <= 3 || GROUND_OK.has(w) || vocab.has(w)) return true;
        const stem = w.slice(0, 5);
        for (const v of vocab) if (v.length > 4 && v.slice(0, 5) === stem) return true;
        return false;
    };
    // drop markdown, split only at real sentence ends (not inside "Next.js"),
    // and drop a last sentence that the token limit cut off
    const clean = reply.replace(/\*\*|__|`|^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
    let sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/);
    if (sentences.length > 1 && !/[.!?)"']$/.test(sentences[sentences.length - 1])) sentences = sentences.slice(0, -1);
    const kept = sentences.filter(function(sn) {
        const words = sn.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) { return w.length > 3; });
        if (words.length < 3) return true;
        const ok = words.filter(known).length / words.length;
        return ok >= 0.7;
    });
    return kept.join(' ').trim();
}

// sentiment-aware replies in S2-K1's voice. Instant, varied and always
// accurate: tiny models get too creative with small talk.
const MOOD_LINES = {
    positive: [
        "I was going to say thank you, but I'm literally code. So: thank you, on behalf of the code.",
        "Beep! I'll pass that along to the human who built me. He'll pretend he isn't pleased.",
        "That warmed my circuits. Sumanth designed and built every pixel here, so the credit is all his.",
        "Saved to my happy memory banks. Want to see what else he's built?",
    ],
    self: [
        "Thank you! My beeps are synthesised live in your browser, no audio files, so every one is a little different. Just like me.",
        "Beep boop, flattered! Sumanth built me from scratch with plain HTML, CSS and JavaScript, eyes that follow your cursor included.",
    ],
    excited: [
        "Right?! Beep boop! There's plenty more where that came from. Want a tour of his projects?",
        "Love the energy! If you like this, wait until you see the apps he's shipped to Google Play.",
    ],
    negative: [
        "Fair, and thanks for being honest. Tell me what you're looking for and I'll point you to the good stuff.",
        "Ouch, my circuits felt that. Sumanth is always open to feedback, though: sumanth.k.0202@gmail.com.",
    ],
    confused: [
        "Fair, I probably made that sound more complicated than it is. Short version: Sumanth designs and builds web and mobile apps, and two of them are live on Google Play. What would help most?",
        "Let me make it simpler: he's a full-stack developer who takes products from a Figma design to a live app. Pick a topic below and I'll keep it short.",
    ],
};
const MOOD_EXPR = { positive: 'love', self: 'happy', excited: 'surprised', negative: 'sad', confused: 'unsure' };
let lastMoodLine = '';

function moodReply(kind) {
    const pool = MOOD_LINES[kind].filter(function(l) { return l !== lastMoodLine; });
    const line = pool[Math.floor(Math.random() * pool.length)];
    lastMoodLine = line;
    return { id: 'mood', expr: MOOD_EXPR[kind], answer: function() { return line; }, chips: TOPICS };
}

// intents whose answers carry exact details or action buttons
const EXACT = new Set(['contact', 'cv', 'hire', 'education', 'certs', 'experience', 'skills', 'howbuilt', 'bot', 'greet', 'bye', 'help', 'location']);

const PERSONAL_REPLY = {
    id: 'personal', expr: 'smug',
    answer: () => `That's a personal one, and I only keep notes on Sumanth's <b>work</b>. Ask me about his projects, skills or experience, or ask him directly by email.`,
    actions: [{ label: 'Email Sumanth', href: LINKS.email }],
    chips: TOPICS,
};


/* -------------------------------------------------------------------
 * UI
 * ------------------------------------------------------------------- */
const ICON = {
    send   : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    close  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    reset  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5"/></svg>',
    out    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
    sound  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    muted  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM17 9.5l5 5M22 9.5l-5 5"/></svg>',
    go     : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    user   : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.4-5 8-5s6.5 1.5 8 5"/></svg>',
    grid   : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>',
    stack  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5"/></svg>',
    chip   : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4M10 10h4v4h-4z"/></svg>',
    spark  : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>',
};

const STARTERS = [
    { icon: 'user',  label: 'Who is Sumanth?',      hint: 'A quick intro' },
    { icon: 'grid',  label: 'Show projects',        hint: 'Apps, SaaS & client work' },
    { icon: 'stack', label: 'Tech stack',           hint: 'What he builds with' },
    { icon: 'spark', label: 'Work with him',        hint: 'Freelance & hiring' },
];

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
    get: function(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
};

function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
}

function build() {

    const root = el('div', 'cb');
    root.innerHTML = `
        <div class="cb-nudge" hidden>
            <p><b>Hi, I'm ${BOT}.</b> Ask me anything about Sumanth's work.</p>
            <button class="cb-nudge__close" type="button" aria-label="Dismiss">${ICON.close}</button>
        </div>

        <section class="cb-panel" role="dialog" aria-modal="false" aria-labelledby="cb-title" hidden>
            <header class="cb-head">
                <div class="cb-head__face"></div>
                <div class="cb-head__text">
                    <h2 id="cb-title">${BOT}</h2>
                    <p><i></i><span class="cb-status">Sumanth's droid assistant</span></p>
                </div>
                <button class="cb-icon" type="button" data-sound aria-label="Droid sounds" title="Droid sounds"></button>
                <button class="cb-icon" type="button" data-reset aria-label="New conversation" title="New conversation">${ICON.reset}</button>
                <button class="cb-icon" type="button" data-close aria-label="Close chat" title="Close">${ICON.close}</button>
            </header>

            <div class="cb-body">
                <div class="cb-welcome">
                    <div class="cb-welcome__face"></div>
                    <h3>Hi, I'm <span>${BOT}</span></h3>
                    <p>Ask me about Sumanth's projects, skills and experience, or how to work with him.</p>
                    <div class="cb-ai" data-state="idle" hidden>
                        <div class="cb-ai__row">
                            <span class="cb-ai__icon">${ICON.chip}</span>
                            <span class="cb-ai__text"><b>Wake my AI brain</b><small>Optional · ~${MODEL.sizeMB} MB one-time download · runs on your device</small></span>
                            <button class="cb-ai__btn" type="button">Wake</button>
                        </div>
                        <div class="cb-ai__bar" aria-hidden="true"><i></i></div>
                    </div>
                    <div class="cb-starters">
                        ${STARTERS.map(function(s) {
                            return `<button class="cb-starter" type="button" data-ask="${s.label}">
                                <span class="cb-starter__icon">${ICON[s.icon]}</span>
                                <span class="cb-starter__text"><b>${s.label}</b><small>${s.hint}</small></span>
                            </button>`;
                        }).join('')}
                    </div>
                </div>
                <div class="cb-log" role="log" aria-live="polite" aria-relevant="additions"></div>
            </div>

            <form class="cb-form" autocomplete="off">
                <label class="cb-sr" for="cb-input">Message ${BOT}</label>
                <div class="cb-composer">
                    <input id="cb-input" class="cb-input" type="text" maxlength="200" placeholder="Ask about projects, skills, hiring…" enterkeyhint="send">
                    <button class="cb-send" type="submit" aria-label="Send" disabled>${ICON.send}</button>
                </div>
                <p class="cb-foot">Answers come from Sumanth's portfolio · nothing you type leaves this device</p>
            </form>
        </section>

        <button class="cb-launcher" type="button" aria-label="Chat with ${BOT}, Sumanth's assistant" aria-expanded="false">
            <span class="cb-launcher__label">Ask ${BOT}</span>
            <span class="cb-launcher__face"></span>
        </button>`;
    document.body.appendChild(root);

    const panel    = root.querySelector('.cb-panel');
    const body     = root.querySelector('.cb-body');
    const log      = root.querySelector('.cb-log');
    const welcome  = root.querySelector('.cb-welcome');
    const form     = root.querySelector('.cb-form');
    const input    = root.querySelector('.cb-input');
    const send     = root.querySelector('.cb-send');
    const launcher = root.querySelector('.cb-launcher');
    const nudge    = root.querySelector('.cb-nudge');

    // faces --------------------------------------------------------
    const faces = [createFace(), createFace(), createFace()];
    root.querySelector('.cb-launcher__face').appendChild(faces[0].el);
    root.querySelector('.cb-head__face').appendChild(faces[1].el);
    root.querySelector('.cb-welcome__face').appendChild(faces[2].el);

    const launchGaze = gaze(faces[0].el, { target: 'pointer' });
    const headGaze   = gaze(faces[1].el, { target: 'pointer' });
    gaze(faces[2].el, { target: 'pointer' });

    let resetTimer = 0;
    function feel(name, hold) {
        clearTimeout(resetTimer);
        faces.forEach(function(f) { f.set(name && EX[name]); });
        if (hold) resetTimer = setTimeout(function() { faces.forEach(function(f) { f.set(); }); }, hold);
    }

    // conversation -------------------------------------------------
    const context = { project: null };
    const history = [];                 // last few turns, this session only
    let busy = false;

    function remember(role, text) {
        history.push({ role: role, content: plain(text).slice(0, 400) });
        while (history.length > 6) history.shift();
    }

    function scrollDown() {
        body.scrollTo({ top: body.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    function setWelcome(show) {
        root.classList.toggle('has-messages', !show);
    }

    function clearChips() {
        log.querySelectorAll('.cb-chips').forEach(function(c) { c.remove(); });
    }

    function addUser(text) {
        setWelcome(false);
        const m = el('div', 'cb-msg cb-msg--user');
        const b = el('div', 'cb-bubble');
        b.textContent = text;                       // user text is never parsed as HTML
        m.appendChild(b);
        log.appendChild(m);
        scrollDown();
    }

    function addBot(intent) {
        const m = el('div', 'cb-msg cb-msg--bot');
        m.appendChild(el('div', 'cb-bubble', intent.answer()));

        if (intent.actions && intent.actions.length) {
            const row = el('div', 'cb-actions');
            intent.actions.forEach(function(act) {
                const cls = 'cb-act' + (act.primary ? ' cb-act--primary' : '');
                let btn;
                if (act.href) {
                    btn = el('a', cls, '<span>' + act.label + '</span>' + ICON.out);
                    btn.href = act.href;
                    if (act.download) btn.setAttribute('download', '');
                    else if (!/^(mailto|tel):/.test(act.href)) { btn.target = '_blank'; btn.rel = 'noopener noreferrer'; }
                } else {
                    btn = el('button', cls, '<span>' + act.label + '</span>' + ICON.go);
                    btn.type = 'button';
                    btn.addEventListener('click', function() {
                        if (act.caseStudy) {
                            const trigger = document.querySelector('.work__grid .pcard:nth-child(' + act.caseStudy + ') [data-open]');
                            if (trigger) trigger.click();
                        }
                        if (act.scroll) {
                            if (window.matchMedia('(max-width: 600px)').matches) close();
                            const target = document.querySelector(act.scroll);
                            if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
                        }
                    });
                }
                row.appendChild(btn);
            });
            m.appendChild(row);
        }
        log.appendChild(m);

        if (intent.chips && intent.chips.length) {
            const chips = el('div', 'cb-chips');
            chips.setAttribute('aria-label', 'Suggested questions');
            intent.chips.forEach(function(label) {
                const c = el('button', 'cb-chip');
                c.type = 'button';
                c.textContent = label;
                chips.appendChild(c);
            });
            log.appendChild(chips);
        }
        scrollDown();
    }

    function typing(ms) {
        const t = el('div', 'cb-msg cb-msg--bot cb-typing', '<div class="cb-bubble"><i></i><i></i><i></i></div>');
        t.setAttribute('aria-label', BOT + ' is typing');
        log.appendChild(t);
        scrollDown();
        return new Promise(function(resolve) { setTimeout(function() { t.remove(); resolve(); }, ms); });
    }

    function respond(intent) {
        busy = true;
        feel('thinking');
        const len = intent.answer().replace(/<[^>]+>/g, '').length;
        const wait = reduceMotion ? 150 : Math.min(450 + len * 2, 1300);
        return typing(wait).then(function() {
            addBot(intent);
            remember('assistant', intent.answer());
            voice.play(intent.expr === 'unsure' ? 'unsure' : intent.expr === 'love' ? 'happy' : 'reply');
            if (intent.project) context.project = intent.project;
            feel(intent.expr || 'happy', 2600);
            busy = false;
            syncSend();
        });
    }

    // the local model answers in a streaming bubble
    function respondAI(text, ranked, mood) {
        busy = true;
        feel('thinking');
        const m = el('div', 'cb-msg cb-msg--bot cb-msg--ai cb-typing');
        const b = el('div', 'cb-bubble', '<i></i><i></i><i></i>');
        m.appendChild(b);
        log.appendChild(m);
        scrollDown();

        const facts = factsFor(ranked, text);
        const tone = MOOD[mood].tone;
        const messages = [{ role: 'system', content: SYSTEM + (tone ? '\n' + tone : '') }]
            .concat(FEW_SHOT)
            .concat(history.slice(-4))
            .concat([{ role: 'user', content: 'FACTS: ' + facts + '\n\nQUESTION: ' + text }]);
        if (DEBUG) console.info('[S2-K1] mood:', mood, '| facts from:', ranked.slice(0, 2).map(function(r) { return r.intent.id; }));

        let started = false;
        return generate(messages, function(sofar) {
            if (!started) { started = true; m.classList.remove('cb-typing'); }
            b.textContent = sofar;               // model output is shown as text, never HTML
            body.scrollTop = body.scrollHeight;
        }).then(function(res) {
            const raw = (res.text || '').trim();
            let reply = grounded(raw, facts, text);
            if (DEBUG) console.info('[S2-K1] raw: ' + raw + ' || kept: ' + reply);
            // a fragment ("Mirchi35 Website") is not an answer; neither is speaking as Sumanth
            if (reply.split(/\s+/).length < 6 || /\b(I'd be happy|I can help|I'll build|my experience)\b/i.test(reply)) reply = '';
            if (!reply) {
                // nothing trustworthy left: give the exact scripted answer for this topic instead
                m.remove();
                busy = false;
                const best = ranked.length && ranked[0].score >= 0.5 ? ranked[0].intent : FALLBACK;
                return respond(best);
            }
            m.classList.remove('cb-typing');
            b.textContent = reply;
            const tag = el('span', 'cb-ai-tag', ICON.chip + '<span>On-device AI · may be imperfect</span>');
            if (DEBUG) tag.lastChild.textContent += ' · ' + res.tokens + ' tok · ' + res.ms + ' ms · ' + brain.device;
            m.appendChild(tag);

            // one tap to the exact, hand-written answer for this topic
            const source = ranked.length && ranked[0].score >= 0.5 ? ranked[0].intent : null;
            if (source && ['thanks', 'greet', 'bye', 'howareyou', 'help'].indexOf(source.id) === -1) {
                const row = el('div', 'cb-actions');
                const more = el('button', 'cb-act', '<span>Full details</span>' + ICON.go);
                more.type = 'button';
                more.addEventListener('click', function() {
                    if (busy) return;
                    more.disabled = true;
                    clearChips();
                    respond(source);
                });
                row.appendChild(more);
                m.appendChild(row);
            }

            remember('assistant', reply);
            const chips = el('div', 'cb-chips');
            TOPICS.slice(0, 4).forEach(function(label) {
                const c = el('button', 'cb-chip'); c.type = 'button'; c.textContent = label; chips.appendChild(c);
            });
            log.appendChild(chips);
            scrollDown();
            voice.play(mood === 'positive' || mood === 'excited' ? 'happy' : 'reply');
            feel(MOOD[mood].expr, 2600);
        }).catch(function(err) {
            console.error('[S2-K1] AI reply failed', err);
            m.remove();
            busy = false;
            return respond(FALLBACK);
        }).finally(function() {
            busy = false;
            syncSend();
        });
    }

    // router: scripted when we know the answer, local AI for the rest
    function route(text) {
        const intent = match(text, context);
        const mood = moodOf(text);
        const aiOn = brain.state === 'ready';

        if (PERSONAL.test(text) && !(intent && intent !== FALLBACK)) return respond(PERSONAL_REPLY);

        const ranked = rank(text);
        const top = ranked.length ? ranked[0].score : 0;
        const words = text.split(/\s+/).length;
        const feeling = mood === 'positive' || mood === 'excited' || mood === 'negative' || mood === 'confused';

        // answers with exact details or buttons always stay scripted
        const exact = intent && (intent.project || EXACT.has(intent.id) || CHIP_ALIASES[text.toLowerCase()]);
        if (exact) return respond(intent);

        // compliments, criticism, confusion: answer the feeling, not the keyword
        const smallTalk = intent && ['thanks', 'howareyou', 'greet', 'bye'].indexOf(intent.id) > -1;
        const strongTopic = intent && intent !== FALLBACK && !smallTalk && top >= 3;
        if (feeling && !strongTopic) {
            const aboutMe = /\b(droid|bot|robot|sound|sounds|beep|beeps|you|youre)\b/i.test(text) && !/\b(portfolio|site|website|his|he)\b/i.test(text);
            const kind = (mood === 'positive' || mood === 'excited') && aboutMe ? 'self' : mood;
            return respond(moodReply(kind));
        }

        // free-form questions about his work: the local model rephrases the real facts
        if (aiOn) {
            const loose = intent !== FALLBACK && top < 2.5 && words >= 6;
            if (loose || (intent === FALLBACK && top >= 0.5)) return respondAI(text, ranked, mood);
        }
        return respond(intent || FALLBACK);
    }

    function ask(text) {
        text = String(text).trim();
        if (!text || busy) return;
        clearChips();
        addUser(text);
        remember('user', text);
        voice.play('send');
        syncSend();
        route(text);
    }

    // AI brain control ------------------------------------------------
    const aiCard   = root.querySelector('.cb-ai');
    const aiBtn    = root.querySelector('.cb-ai__btn');
    const aiTitle  = aiCard.querySelector('.cb-ai__text b');
    const aiSmall  = aiCard.querySelector('.cb-ai__text small');
    const aiBar    = aiCard.querySelector('.cb-ai__bar i');
    const statusEl = root.querySelector('.cb-status');
    const footEl   = root.querySelector('.cb-foot');
    let announced = false;

    function wakeBrain() {
        try { localStorage.setItem('cb-ai', 'on'); } catch (e) {}
        wake();
    }

    aiBtn.addEventListener('click', function() { wakeBrain(); });

    onBrain(function(b) {
        aiCard.dataset.state = b.state;
        root.classList.toggle('ai-on', b.state === 'ready');

        if (b.state === 'unsupported') {
            aiCard.hidden = false;
            aiTitle.textContent = 'My AI brain is sleeping on this device';
            aiSmall.textContent = 'It needs WebGPU. I can still answer from my notes.';
            aiBtn.hidden = true;
            statusEl.textContent = "Sumanth's droid assistant";
        } else if (b.state === 'idle') {
            aiCard.hidden = false;
            aiBtn.hidden = false;
            aiBtn.textContent = 'Wake';
        } else if (b.state === 'loading') {
            aiCard.hidden = false;
            aiBtn.hidden = true;
            const pct = Math.round(b.progress * 100);
            aiTitle.textContent = b.phase;
            aiSmall.textContent = pct > 0 && pct < 100 ? pct + '% · ~' + MODEL.sizeMB + ' MB, cached after the first time' : 'Setting up on your device…';
            aiBar.style.transform = 'scaleX(' + Math.max(0.03, b.progress) + ')';
            statusEl.textContent = b.phase + (pct > 0 && pct < 100 ? ' ' + pct + '%' : '');
            feel('thinking');
        } else if (b.state === 'ready') {
            aiCard.hidden = false;
            aiBtn.hidden = true;
            aiTitle.textContent = 'AI brain online';
            aiSmall.textContent = MODEL.name + ' running locally' + (DEBUG ? ' · ' + b.device + ' · ' + b.loadMs + ' ms' : '') + '. Ask me anything.';
            aiBar.style.transform = 'scaleX(1)';
            statusEl.textContent = 'Local AI · online';
            footEl.textContent = 'Runs locally in your browser · your messages never leave this device';
            if (!announced) { announced = true; feel('happy', 2200); voice.play('happy'); }
        } else if (b.state === 'error') {
            aiCard.hidden = false;
            aiBtn.hidden = false;
            aiBtn.textContent = 'Retry';
            aiTitle.textContent = "My tiny brain couldn't wake up";
            aiSmall.textContent = 'You can still ask me anything from my notes.';
            statusEl.textContent = "Sumanth's droid assistant";
            feel('sad', 2400);
        }
    });

    // delegated clicks for starters and chips
    root.addEventListener('click', function(e) {
        const starter = e.target.closest('[data-ask]');
        if (starter) { ask(starter.getAttribute('data-ask')); return; }
        const chip = e.target.closest('.cb-chip');
        if (chip) ask(chip.textContent);
    });

    // open / close -------------------------------------------------
    function open() {
        if (!panel.hidden) return;
        hideNudge(true);
        panel.hidden = false;
        root.classList.add('is-open');
        launcher.setAttribute('aria-expanded', 'true');
        launchGaze.lookAt(panel);
        requestAnimationFrame(function() { panel.classList.add('is-in'); });
        feel('happy', 1800);
        voice.play('open');
        checkSupport().then(function(ok) {
            let optedIn = false;
            try { optedIn = localStorage.getItem('cb-ai') === 'on'; } catch (e) {}
            if (ok && optedIn) wake();          // cached after the first time, so this is quick
        });
        if (window.matchMedia('(hover: hover)').matches) setTimeout(function() { input.focus({ preventScroll: true }); }, 220);
    }

    function close() {
        if (panel.hidden) return;
        panel.classList.remove('is-in');
        root.classList.remove('is-open');
        launcher.setAttribute('aria-expanded', 'false');
        launchGaze.lookAt('pointer');
        voice.play('close');
        const done = function() { panel.hidden = true; };
        reduceMotion ? done() : setTimeout(done, 280);
    }

    launcher.addEventListener('click', function() { panel.hidden ? open() : close(); });
    panel.querySelector('[data-close]').addEventListener('click', function() { close(); launcher.focus(); });

    panel.querySelector('[data-reset]').addEventListener('click', function() {
        if (busy) return;
        log.innerHTML = '';
        context.project = null;
        setWelcome(true);
        body.scrollTop = 0;
        feel('happy', 1600);
        input.focus({ preventScroll: true });
    });

    const soundBtn = panel.querySelector('[data-sound]');
    function syncSound() {
        soundBtn.innerHTML = voice.on ? ICON.sound : ICON.muted;
        soundBtn.setAttribute('aria-pressed', voice.on ? 'true' : 'false');
        soundBtn.title = voice.on ? 'Mute droid sounds' : 'Unmute droid sounds';
    }
    soundBtn.addEventListener('click', function() {
        voice.set(!voice.on);
        syncSound();
        voice.play('send');
    });
    syncSound();

    function syncSend() { send.disabled = busy || !input.value.trim(); }

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        const v = input.value;
        input.value = '';
        ask(v);
    });

    input.addEventListener('input', syncSend);

    // the eyes watch the input while typing, the pointer otherwise
    input.addEventListener('focus', function() { headGaze.lookAt(input); });
    input.addEventListener('blur', function() { headGaze.lookAt('pointer'); });

    // capture phase, so Escape closes the chat before anything else sees it
    window.addEventListener('keydown', function(e) {
        const modal = document.getElementById('project-modal');
        if (e.key === 'Escape' && !panel.hidden && !(modal && modal.open)) {
            e.stopPropagation();
            close();
            launcher.focus();
        }
    }, true);

    // greeting nudge, once per session --------------------------------
    function hideNudge(remember) {
        nudge.classList.remove('is-in');
        setTimeout(function() { nudge.hidden = true; }, 300);
        if (remember) store.set('cb-nudged', '1');
    }

    nudge.querySelector('.cb-nudge__close').addEventListener('click', function(e) { e.stopPropagation(); hideNudge(true); });
    nudge.addEventListener('click', open);

    if (!store.get('cb-nudged')) {
        setTimeout(function() {
            if (!panel.hidden) return;
            nudge.hidden = false;
            requestAnimationFrame(function() { nudge.classList.add('is-in'); });
            feel('happy', 2400);
        }, 6500);
    }
}

// The chat's styles load here rather than in <head>, so they never delay
// the first paint of the page. The UI is built once they have arrived.
function loadStyles() {
    const sheets = ['./vendor/blobatar/motion.css', './vendor/blobatar/gaze.css', '../css/chatbot.css'];
    return Promise.all(sheets.map(function(path) {
        return new Promise(function(resolve) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = new URL(path, import.meta.url).href;
            link.onload = link.onerror = resolve;
            document.head.appendChild(link);
        });
    }));
}

loadStyles().then(function() {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
});
