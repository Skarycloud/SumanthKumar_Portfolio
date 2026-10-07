/* ===================================================================
 * Expertise: each skill has a Hairline figure (MIT, vendored in
 * js/vendor/hairline). Hovering or focusing a skill swaps the figure
 * with a crossfade; when nobody is interacting, it slowly cycles.
 * ------------------------------------------------------------------- */

import * as H from './vendor/hairline/index.js';

const root = document.querySelector('.xpg');

if (root) {
    const stage   = root.querySelector('.xps');
    const host    = root.querySelector('.xps__fig');
    const idxEl   = root.querySelector('.xps__idx');
    const tagEl   = root.querySelector('.xps__tag');
    const nameEl  = root.querySelector('.xps__name');
    const readEl  = root.querySelector('.xps__read');
    const rows    = Array.prototype.slice.call(root.querySelectorAll('.xpr'));
    const reduce  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const total   = String(rows.length).padStart(2, '0');

    let current = null;       // { figure, el, row }
    let swapTimer = 0, cycleTimer = 0, idle = true, inView = false;

    function mount(row) {
        if (current && current.row === row) return;

        const layer = document.createElement('div');
        layer.className = 'xps__layer';
        host.appendChild(layer);

        const make = H[row.dataset.fig];
        const figure = make(layer, {
            theme: 'dark',
            intensity: 0.65,
            label: row.querySelector('b').textContent,
            onRead: function(text) { readEl.textContent = text; },
        });

        requestAnimationFrame(function() { layer.classList.add('is-in'); });

        const old = current;
        if (old) {
            old.el.classList.remove('is-in');
            old.el.classList.add('is-out');
            setTimeout(function() { old.figure.destroy(); old.el.remove(); }, reduce ? 0 : 520);
        }
        current = { figure: figure, el: layer, row: row };

        rows.forEach(function(r) { r.setAttribute('aria-pressed', r === row ? 'true' : 'false'); });
        idxEl.textContent = row.dataset.i + ' / ' + total;
        tagEl.textContent = row.dataset.tag;
        nameEl.textContent = row.querySelector('b').textContent;
        stage.dataset.tag = row.dataset.tag;
    }

    // hover/focus: swap after a short pause so sweeping across rows stays calm
    function request(row, delay) {
        clearTimeout(swapTimer);
        swapTimer = setTimeout(function() { mount(row); }, delay);
    }

    // "aim" detection: while the pointer travels quickly toward the stage
    // (leftward on desktop), rows it passes over do not steal the figure
    let lastX = 0, lastT = 0, vx = 0;
    root.querySelector('.xpl').addEventListener('pointermove', function(e) {
        const now = performance.now();
        if (lastT) vx = (e.clientX - lastX) / Math.max(1, now - lastT);
        lastX = e.clientX; lastT = now;
        if (vx < -0.25) clearTimeout(swapTimer);
    });
    root.querySelector('.xpl').addEventListener('pointerleave', function() { vx = 0; lastT = 0; });

    rows.forEach(function(row) {
        row.addEventListener('pointerenter', function() {
            idle = false;
            if (vx < -0.25) return;
            request(row, 160);
        });
        row.addEventListener('pointermove', function() {
            if (vx >= -0.25 && (!current || current.row !== row)) request(row, 160);
        });
        row.addEventListener('focus', function() { idle = false; request(row, 0); });
        row.addEventListener('click', function() { idle = false; request(row, 0); });
    });

    root.addEventListener('pointerleave', function() { idle = true; schedule(); });
    stage.addEventListener('pointerenter', function() { idle = false; clearTimeout(cycleTimer); });

    // gentle autoplay while visible and untouched
    function schedule() {
        clearTimeout(cycleTimer);
        if (reduce || !inView || !idle) return;
        cycleTimer = setTimeout(function() {
            if (!idle || !inView) return;
            const i = rows.indexOf(current ? current.row : rows[0]);
            mount(rows[(i + 1) % rows.length]);
            schedule();
        }, 3800);
    }

    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function(entries) {
            inView = entries[0].isIntersecting;
            if (inView && !current) mount(rows[0]);
            inView ? schedule() : clearTimeout(cycleTimer);
        }, { threshold: 0.3 }).observe(root);
    } else {
        mount(rows[0]);
    }

    document.addEventListener('visibilitychange', function() { document.hidden ? clearTimeout(cycleTimer) : schedule(); });
}
