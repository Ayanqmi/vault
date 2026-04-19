/* ayanami.vault — main.js
   Shared UI: starfield, scramble text, scroll reveals, burger, eye toggles.
   Matches ayanami.upload / ayanami.design behaviour exactly.
*/

// ─── Scramble (identical to ayanami.upload) ───────────────────────────────
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function scramble(el) {
  let tgt = el.querySelector('.nav-label, .scramble-label');
  if (!tgt && el.querySelector('svg')) {
    for (const node of [...el.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        const span = document.createElement('span');
        span.className = 'scramble-label';
        span.textContent = node.textContent;
        el.replaceChild(span, node);
        tgt = span;
        break;
      }
    }
  }
  tgt = tgt || el;
  const original = tgt.dataset.scrambleText || tgt.textContent.trim();
  tgt.dataset.scrambleText = original;
  el._scrambling = true;
  if (el._scrambleId) cancelAnimationFrame(el._scrambleId);
  tgt.style.width      = tgt.offsetWidth + 'px';
  tgt.style.whiteSpace = 'nowrap';
  tgt.style.overflow   = 'hidden';
  tgt.style.display    = 'inline-block';
  const duration  = 748;
  const holdEnd   = 0.2;
  const swapEvery = 50;
  const start     = performance.now();
  let lastSwap    = 0;
  let rand = original.split('').map(c =>
    c.charCodeAt(0) > 127 || c === ' ' ? c : CHARS[Math.floor(Math.random() * CHARS.length)]
  );
  function tick(now) {
    if (el._locked) {
      tgt.style.width = ''; tgt.style.whiteSpace = ''; tgt.style.overflow = ''; tgt.style.display = '';
      el._scrambling = false; return;
    }
    const t        = Math.min((now - start) / duration, 1);
    const progress = t < holdEnd ? 0 : (t - holdEnd) / (1 - holdEnd);
    if (now - lastSwap >= swapEvery) {
      rand = original.split('').map(c =>
        c.charCodeAt(0) > 127 || c === ' ' ? c : CHARS[Math.floor(Math.random() * CHARS.length)]
      );
      lastSwap = now;
    }
    tgt.textContent = original.split('').map((char, i) => {
      if (char === ' ' || char.charCodeAt(0) > 127) return char;
      if (i / original.length < progress) return original[i];
      return rand[i];
    }).join('');
    if (t < 1) {
      el._scrambleId = requestAnimationFrame(tick);
    } else {
      tgt.textContent = original;
      tgt.style.width = ''; tgt.style.whiteSpace = ''; tgt.style.overflow = ''; tgt.style.display = '';
      el._scrambling = false;
    }
  }
  el._scrambleId = requestAnimationFrame(tick);
}

document.addEventListener('mouseover', e => {
  const target = e.target.closest('.btn, .nav-link, .nav-btn, [data-scramble]');
  if (target && !target._scrambling && !target._locked) scramble(target);
});

// ─── Starfield ─────────────────────────────────────────────────────────────
(function initStarfield() {
  const canvas = document.getElementById('starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, stars = [];
  let angleY = 0, angleX = 0, tick = 0;

  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }

  function makeStars() {
    const R = Math.max(W, H) * 1.05;
    stars = Array.from({ length: 5000 }, () => {
      const u = Math.random(), v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi   = Math.acos(2 * v - 1);
      return {
        ox:     R * Math.sin(phi) * Math.cos(theta),
        oy:     R * Math.sin(phi) * Math.sin(theta),
        oz:     R * Math.cos(phi),
        size:   Math.random() * 1.15 + 0.2,
        phase:  Math.random() * Math.PI * 2,
        tSpeed: Math.random() * 0.006 + 0.002,
      };
    });
  }

  resize();
  makeStars();
  window.addEventListener('resize', () => { resize(); makeStars(); }, { passive: true });

  const ROT_Y = 0.000016;
  const ROT_X = 0.000005;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    tick++;
    angleY += ROT_Y;
    angleX += ROT_X;

    const cosY = Math.cos(angleY), sinY = Math.sin(angleY);
    const cosX = Math.cos(angleX), sinX = Math.sin(angleX);
    const cx = W / 2, cy = H / 2;
    const R  = Math.max(W, H) * 1.05;
    const D  = R * 2.2;

    for (const s of stars) {
      let rx =  s.ox * cosY + s.oz * sinY;
      let ry =  s.oy;
      let rz = -s.ox * sinY + s.oz * cosY;

      const ry2 = ry * cosX - rz * sinX;
      const rz2 = ry * sinX + rz * cosX;
      ry = ry2; rz = rz2;

      if (rz > -R * 0.06) continue;

      const persp = D / (D - rz);
      const sx = cx + rx * persp;
      const sy = cy + ry * persp;
      if (sx < -4 || sx > W + 4 || sy < -4 || sy > H + 4) continue;

      const depth   = Math.pow((-rz) / R, 0.22);
      const twinkle = 0.5 + 0.5 * Math.sin(tick * s.tSpeed + s.phase);
      const a       = (0.02 + 0.82 * depth) * (0.5 + 0.5 * twinkle);
      const size    = s.size * (0.4 + 0.6 * depth);

      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(size, 0.15), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(235,235,235,${Math.min(a, 0.9).toFixed(3)})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

// ─── Scroll reveals ────────────────────────────────────────────────────────
const revealObs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('is-visible'); revealObs.unobserve(e.target); }
  });
}, { threshold: 0.07, rootMargin: '0px 0px -30px 0px' });

document.querySelectorAll('[data-reveal]').forEach(el => revealObs.observe(el));

const staggerObs = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const siblings = [...entry.target.parentElement.querySelectorAll('[data-reveal-stagger]')];
    siblings.forEach((el, i) => {
      el.style.setProperty('--stagger', (i * 80) + 'ms');
      el.classList.add('is-visible');
    });
    siblings.forEach(el => staggerObs.unobserve(el));
  });
}, { threshold: 0.05, rootMargin: '0px 0px -20px 0px' });

document.querySelectorAll('[data-reveal-stagger]').forEach(el => staggerObs.observe(el));

// ─── Mobile burger ─────────────────────────────────────────────────────────
const burger    = document.getElementById('burgerBtn');
const topbarNav = document.getElementById('topbarNav');
if (burger && topbarNav) {
  burger.addEventListener('click', () => {
    const open = topbarNav.classList.toggle('open');
    burger.setAttribute('aria-expanded', String(open));
  });
}

// ─── Eye toggles (password show/hide) ─────────────────────────────────────
document.querySelectorAll('.field-eye[data-eye]').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.eye);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});
