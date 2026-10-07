/* ===================================================================
 * Portfolio - Work section interactions
 * reveal on scroll, filters, card spotlight, project modal, marquee
 * ------------------------------------------------------------------- */

(function() {

    "use strict";

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;


   /* Reveal on scroll
    * -------------------------------------------------- */
    const ssReveal = function() {

        const items = document.querySelectorAll('[data-reveal]');
        if (!items.length) return;

        if (!('IntersectionObserver' in window) || reduceMotion) {
            items.forEach(function(el) { el.classList.add('is-in'); });
            return;
        }

        const observer = new IntersectionObserver(function(entries) {
            let batch = 0;
            entries.forEach(function(entry) {
                if (!entry.isIntersecting) return;
                entry.target.style.setProperty('--d', (batch++ * 90) + 'ms');
                entry.target.classList.add('is-in');
                observer.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });

        items.forEach(function(el) { observer.observe(el); });

    }; // end ssReveal


   /* Filters
    * -------------------------------------------------- */
    const ssFilters = function() {

        const chips = document.querySelectorAll('.work__filters .chip');
        const cards = document.querySelectorAll('.work__grid .pcard');
        if (!chips.length || !cards.length) return;

        cards.forEach(function(card, i) {
            card.style.viewTransitionName = 'pcard-' + i;
        });

        // counts
        chips.forEach(function(chip) {
            const filter = chip.dataset.filter;
            const count = filter === 'all'
                ? cards.length
                : Array.prototype.filter.call(cards, function(c) { return c.dataset.cat.split(' ').indexOf(filter) > -1; }).length;

            if (!count) { chip.hidden = true; return; }

            const badge = document.createElement('span');
            badge.className = 'chip__count';
            badge.textContent = count;
            chip.appendChild(badge);
        });

        function apply(filter) {
            cards.forEach(function(card) {
                const match = filter === 'all' || card.dataset.cat.split(' ').indexOf(filter) > -1;
                card.classList.toggle('is-hidden', !match);
                card.classList.add('is-in');
            });
        }

        chips.forEach(function(chip) {
            chip.addEventListener('click', function() {
                if (chip.classList.contains('is-active')) return;

                chips.forEach(function(c) {
                    c.classList.remove('is-active');
                    c.setAttribute('aria-selected', 'false');
                });
                chip.classList.add('is-active');
                chip.setAttribute('aria-selected', 'true');

                const filter = chip.dataset.filter;

                if (document.startViewTransition && !reduceMotion) {
                    document.startViewTransition(function() { apply(filter); });
                } else {
                    apply(filter);
                }
            });
        });

    }; // end ssFilters


   /* Card cursor spotlight
    * -------------------------------------------------- */
    const ssSpotlight = function() {

        if (!window.matchMedia('(hover: hover)').matches) return;

        document.querySelectorAll('.pcard, .xcard').forEach(function(card) {
            card.addEventListener('pointermove', function(e) {
                const r = card.getBoundingClientRect();
                card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
                card.style.setProperty('--my', (e.clientY - r.top) + 'px');
            });
        });

    }; // end ssSpotlight


   /* Draggable gallery - mouse drag with momentum, arrows, keyboard.
    * Touch devices keep native swipe scrolling.
    * -------------------------------------------------- */
    const ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
    const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
    const ICON_DRAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M3 12h18"/></svg>';

    const enhanceGallery = function(gallery) {

        const wrap = document.createElement('div');
        wrap.className = 'pm-gallery-wrap';
        gallery.parentNode.insertBefore(wrap, gallery);
        wrap.appendChild(gallery);

        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'pm-nav pm-nav--prev';
        prev.setAttribute('aria-label', 'Previous screenshots');
        prev.innerHTML = ICON_PREV;

        const next = prev.cloneNode(false);
        next.className = 'pm-nav pm-nav--next';
        next.setAttribute('aria-label', 'Next screenshots');
        next.innerHTML = ICON_NEXT;

        const hint = document.createElement('span');
        hint.className = 'pm-hint';
        hint.setAttribute('aria-hidden', 'true');
        hint.innerHTML = ICON_DRAG + (window.matchMedia('(hover: none)').matches ? 'Swipe to explore' : 'Drag to explore');

        wrap.append(prev, next, hint);

        gallery.setAttribute('tabindex', '0');
        gallery.setAttribute('aria-label', 'Project screenshots');

        // state ------------------------------------------------------
        let momentum = 0;

        function update() {
            const max = gallery.scrollWidth - gallery.clientWidth;
            const scrollable = max > 4;
            gallery.classList.toggle('is-draggable', scrollable);
            wrap.classList.toggle('can-prev', scrollable && gallery.scrollLeft > 4);
            wrap.classList.toggle('can-next', scrollable && gallery.scrollLeft < max - 4);
            hint.hidden = !scrollable;
        }

        function stopMomentum() {
            if (momentum) cancelAnimationFrame(momentum);
            momentum = 0;
        }

        function markUsed() { wrap.classList.add('is-used'); }

        gallery.addEventListener('scroll', function() {
            update();
            if (gallery.scrollLeft > 8) markUsed();
        }, { passive: true });

        gallery.querySelectorAll('img').forEach(function(img) {
            img.setAttribute('draggable', 'false');
            if (!img.complete) img.addEventListener('load', update, { once: true });
        });

        if ('ResizeObserver' in window) new ResizeObserver(update).observe(gallery);
        update();

        // arrows -----------------------------------------------------
        function step(dir) {
            stopMomentum();
            markUsed();
            gallery.scrollBy({ left: dir * gallery.clientWidth * 0.8, behavior: reduceMotion ? 'auto' : 'smooth' });
        }

        prev.addEventListener('click', function() { step(-1); });
        next.addEventListener('click', function() { step(1); });

        gallery.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        });

        // mouse drag -------------------------------------------------
        let startX = 0, startScroll = 0, lastX = 0, lastT = 0, velocity = 0;
        let pressed = false, dragged = false;

        gallery.addEventListener('pointerdown', function(e) {
            if (e.pointerType !== 'mouse' || e.button !== 0) return;
            if (!gallery.classList.contains('is-draggable')) return;

            stopMomentum();
            pressed = true;
            dragged = false;
            startX = lastX = e.clientX;
            startScroll = gallery.scrollLeft;
            lastT = performance.now();
            velocity = 0;
        });

        gallery.addEventListener('pointermove', function(e) {
            if (!pressed) return;

            const dx = e.clientX - startX;

            if (!dragged) {
                if (Math.abs(dx) < 5) return;
                dragged = true;
                gallery.setPointerCapture(e.pointerId);
                gallery.classList.add('is-dragging');
                markUsed();
            }

            const now = performance.now();
            const dt = Math.max(1, now - lastT);
            // smoothed px-per-ms velocity for the release fling
            velocity = 0.8 * ((e.clientX - lastX) / dt) + 0.2 * velocity;
            lastX = e.clientX;
            lastT = now;

            gallery.scrollLeft = startScroll - dx;
        });

        function release(e) {
            if (!pressed) return;
            pressed = false;
            if (!dragged) return;

            if (gallery.hasPointerCapture(e.pointerId)) gallery.releasePointerCapture(e.pointerId);

            // ignore a fling if the pointer rested before release
            let v = performance.now() - lastT > 80 || reduceMotion ? 0 : velocity * 16;

            const glide = function() {
                if (Math.abs(v) < 0.4) {
                    momentum = 0;
                    gallery.classList.remove('is-dragging'); // re-enables snap
                    return;
                }
                gallery.scrollLeft -= v;
                v *= 0.93;
                momentum = requestAnimationFrame(glide);
            };
            glide();
        }

        gallery.addEventListener('pointerup', release);
        gallery.addEventListener('pointercancel', release);

        // a drag should not count as a click on the images
        gallery.addEventListener('click', function(e) {
            if (dragged) {
                e.preventDefault();
                e.stopPropagation();
                dragged = false;
            }
        }, true);

        gallery.addEventListener('wheel', stopMomentum, { passive: true });

    }; // end enhanceGallery


   /* Project modal
    * -------------------------------------------------- */
    const ssModal = function() {

        const modal = document.getElementById('project-modal');
        if (!modal || typeof modal.showModal !== 'function') return;

        const content = modal.querySelector('.pmodal__content');
        const root = document.documentElement;
        let lastTrigger = null;

        function open(card, trigger) {
            const tpl = card.querySelector('template.pcard__detail');
            if (!tpl) return;

            content.innerHTML = '';
            content.appendChild(tpl.content.cloneNode(true));

            const title = content.querySelector('.pm-title');
            if (title) title.id = 'pm-title';

            modal.style.setProperty('--accent', card.style.getPropertyValue('--accent'));
            modal.style.setProperty('--tint', card.style.getPropertyValue('--tint'));

            lastTrigger = trigger;
            root.classList.add('modal-open');
            modal.showModal();
            modal.querySelector('.pmodal__panel').scrollTop = 0;
            content.querySelectorAll('.pm-gallery').forEach(enhanceGallery);

            requestAnimationFrame(function() { modal.classList.add('is-open'); });
        }

        function close() {
            if (!modal.open) return;
            modal.classList.remove('is-open');

            const done = function() {
                modal.close();
                root.classList.remove('modal-open');
                if (lastTrigger) lastTrigger.focus({ preventScroll: true });
            };

            reduceMotion ? done() : setTimeout(done, 280);
        }

        document.querySelectorAll('.pcard [data-open]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                open(btn.closest('.pcard'), btn);
            });
        });

        // clicking the card media also opens the case study
        document.querySelectorAll('.pcard__media').forEach(function(media) {
            media.style.cursor = 'pointer';
            media.addEventListener('click', function() {
                const card = media.closest('.pcard');
                open(card, card.querySelector('[data-open]'));
            });
        });

        modal.querySelector('[data-close]').addEventListener('click', close);

        modal.addEventListener('cancel', function(e) {
            e.preventDefault();
            close();
        });

        // Escape closes the modal (capture phase, so it wins over other
        // Escape handlers such as the chat's) and runs our exit animation
        window.addEventListener('keydown', function(e) {
            if (modal.open && (e.key === 'Escape' || e.keyCode === 27)) {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        }, true);

        // click on backdrop
        modal.addEventListener('click', function(e) {
            if (e.target === modal) close();
        });

    }; // end ssModal


   /* Tech marquee - duplicate the set for a seamless loop
    * -------------------------------------------------- */
    const ssMarquee = function() {

        const track = document.querySelector('.tech-carousel__wrapper');
        if (!track || track.dataset.cloned) return;

        Array.prototype.slice.call(track.children).forEach(function(slide) {
            const clone = slide.cloneNode(true);
            clone.setAttribute('aria-hidden', 'true');
            track.appendChild(clone);
        });
        track.dataset.cloned = 'true';

    }; // end ssMarquee


   /* The Build Loop (about section)
    * Figma -> React Native -> APIs & tests -> Google Play, on a loop.
    * Runs only while visible; pauses on hover and in hidden tabs.
    * -------------------------------------------------- */
    const ssBuildLoop = function() {

        const bl = document.querySelector('.bl');
        if (!bl) return;

        const stage = bl.querySelector('.bl__stage');
        const tabs  = Array.prototype.slice.call(bl.querySelectorAll('[data-go]'));
        const live  = bl.querySelector('.bl__live');
        const DUR   = { 1: 3800, 2: 3800, 3: 3600, 4: 4200 };
        const NAMES = { 1: 'Design in Figma', 2: 'Build in React Native', 3: 'Connect APIs and run tests', 4: 'Ship to Google Play' };

        // the scene is designed at 600px wide; scale it to the stage
        function fit() { bl.style.setProperty('--k', (stage.clientWidth / 600).toFixed(4)); }
        fit();
        if ('ResizeObserver' in window) new ResizeObserver(fit).observe(stage);
        else window.addEventListener('resize', fit);

        let step = 1, timer = 0, startedAt = 0, remaining = DUR[1];
        let inView = false, hovering = false, started = false;

        function show(n, announce) {
            // re-setting the same step restarts its choreography
            if (String(n) === bl.dataset.step) { bl.dataset.step = '0'; void bl.offsetWidth; }
            step = n;
            bl.dataset.step = n;
            bl.style.setProperty('--dur', DUR[n] + 'ms');
            remaining = DUR[n];

            tabs.forEach(function(tab, i) {
                const k = i + 1;
                tab.setAttribute('aria-selected', k === n ? 'true' : 'false');
                tab.tabIndex = k === n ? 0 : -1;
                tab.classList.toggle('is-done', k < n);
            });

            // restart the progress bar of the active tab
            const bar = tabs[n - 1].querySelector('.bl__bar');
            bar.style.animation = 'none';
            void bar.offsetWidth;
            bar.style.animation = '';

            if (announce) live.textContent = 'Step ' + n + ' of 4: ' + NAMES[n];
        }

        function canRun() { return inView && !hovering && !document.hidden && !reduceMotion; }

        function run() {
            clearTimeout(timer);
            if (!canRun()) { pause(); return; }
            bl.classList.remove('is-paused');
            startedAt = performance.now();
            timer = setTimeout(function() {
                show(step % 4 + 1, false);
                run();
            }, remaining);
        }

        function pause() {
            if (timer) {
                clearTimeout(timer);
                timer = 0;
                remaining = Math.max(200, remaining - (performance.now() - startedAt));
            }
            bl.classList.add('is-paused');
        }

        // tabs: click or arrow keys jump to a step
        tabs.forEach(function(tab, i) {
            tab.addEventListener('click', function() {
                show(i + 1, true);
                run();
            });
            tab.addEventListener('keydown', function(e) {
                const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!dir) return;
                e.preventDefault();
                const next = (i + dir + 4) % 4;
                tabs[next].focus();
                show(next + 1, true);
                run();
            });
        });

        if (reduceMotion) {
            bl.classList.add('is-static');
            show(4, false);
            return;
        }

        // only animate while on screen
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function(entries) {
                inView = entries[0].isIntersecting;
                if (inView && !started) { started = true; show(1, false); }
                inView ? run() : pause();
            }, { threshold: 0.35 }).observe(stage);
        } else {
            inView = true; started = true; run();
        }

        document.addEventListener('visibilitychange', function() { document.hidden ? pause() : run(); });

        // hover: pause to look closer, with a subtle 3D tilt toward the pointer
        if (window.matchMedia('(hover: hover)').matches) {
            stage.addEventListener('pointerenter', function() { hovering = true; pause(); });
            stage.addEventListener('pointerleave', function() {
                hovering = false;
                bl.style.setProperty('--rx', '0deg');
                bl.style.setProperty('--ry', '0deg');
                run();
            });
            stage.addEventListener('pointermove', function(e) {
                const r = stage.getBoundingClientRect();
                const x = (e.clientX - r.left) / r.width - 0.5;
                const y = (e.clientY - r.top) / r.height - 0.5;
                bl.style.setProperty('--rx', (-y * 5).toFixed(2) + 'deg');
                bl.style.setProperty('--ry', (x * 6).toFixed(2) + 'deg');
            });
        }

        show(1, false);
        pause();

    }; // end ssBuildLoop


   /* Copy email / phone
    * -------------------------------------------------- */
    const ssCopy = function() {

        const status = document.querySelector('.copy-status');

        function fallback(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e) {}
            ta.remove();
            return ok ? Promise.resolve() : Promise.reject();
        }

        document.querySelectorAll('[data-copy]').forEach(function(btn) {
            const label = btn.querySelector('.copy-btn__text');
            let timer = 0;

            btn.addEventListener('click', function() {
                const text = btn.getAttribute('data-copy');
                const write = navigator.clipboard && window.isSecureContext
                    ? navigator.clipboard.writeText(text).catch(function() { return fallback(text); })
                    : fallback(text);

                write.then(function() {
                    btn.classList.add('is-copied');
                    label.textContent = 'Copied';
                    if (status) status.textContent = text + ' copied to clipboard';
                }, function() {
                    label.textContent = 'Press Ctrl+C';
                }).then(function() {
                    clearTimeout(timer);
                    timer = setTimeout(function() {
                        btn.classList.remove('is-copied');
                        label.textContent = 'Copy';
                    }, 1800);
                });
            });
        });

    }; // end ssCopy


   /* Footer year
    * -------------------------------------------------- */
    const ssYear = function() {
        document.querySelectorAll('[data-year]').forEach(function(el) {
            el.textContent = new Date().getFullYear();
        });
    };


   /* Initialize
    * -------------------------------------------------- */
    (function ssInit() {
        ssReveal();
        ssFilters();
        ssSpotlight();
        ssModal();
        ssMarquee();
        ssYear();
        ssCopy();
        ssBuildLoop();
    })();

})();
