// hud.js — DOM HUD for EMBERLINE.
// Every getElementById is guarded with a null check: index.html is written
// by the parent, and this module must never throw on a missing element.
// Colours for the 2D minimap come from palette.js; the rest of the HUD is
// styled by CSS in index.html.

import { PALETTE } from './palette.js';

// Map bounds from the world contract (used to project world -> minimap).
const MAP = { minX: -22, maxX: 22, minZ: -15, maxZ: 15 };
const SITE_A = { x: -16, z: -9, label: 'A' };
const SITE_B = { x: 16, z: -9, label: 'B' };

function el(id) {
  const n = document.getElementById(id);
  return n || null;
}

function setText(id, text) {
  const n = el(id);
  if (n) n.textContent = text;
}

function show(n, display) {
  if (!n) return;
  n.hidden = false;
  if (display) n.style.display = display;
  else n.style.display = '';
}

function hide(n) {
  if (!n) return;
  n.hidden = true;
  n.style.display = '';
}

export function createHud(callbacks) {
  const cb = callbacks || {};
  let playHandler = cb.onPlay || null;
  let buyHandler = cb.onBuy || null;

  let buyOpen = false;
  let buyItems = [];
  let bannerTimer = null;
  let hitTimer = null;
  let flashTimer = null;
  let minimapCtx = null;
  let damageArc = null;

  // --- one-time wiring -----------------------------------------------------

  // Play button (start screen). Guarded: #play may not exist yet.
  const playBtn = el('play');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (playHandler) playHandler();
    });
  }

  // Damage-direction arc: a ring segment inside #damage-vignette, rotated
  // by the incoming angle. Created here so hud.js does not depend on the
  // parent's exact inner markup.
  const vignette = el('damage-vignette');
  if (vignette) {
    damageArc = document.createElement('div');
    damageArc.className = 'damage-arc';
    damageArc.style.cssText =
      'position:absolute;inset:0;border-radius:50%;' +
      'border:5px solid transparent;border-top-color:' + PALETTE.furnace + ';' +
      'opacity:0;pointer-events:none;';
    vignette.appendChild(damageArc);
    vignette.style.opacity = '0';
  }

  // Buy-menu keyboard: number keys 1..9 select a row, Escape closes.
  function onBuyKey(e) {
    if (!buyOpen) return;
    if (e.key === 'Escape') {
      api.closeBuy();
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9 && n <= buyItems.length) {
      const item = buyItems[n - 1];
      if (item && buyHandler) buyHandler(item.kind, item.id);
    }
  }
  document.addEventListener('keydown', onBuyKey);

  // --- minimap -------------------------------------------------------------

  function minimapContext() {
    if (minimapCtx) return minimapCtx;
    const canvas = el('minimap');
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    minimapCtx = ctx;
    return ctx;
  }

  function project(x, z, w, h) {
    return {
      x: ((x - MAP.minX) / (MAP.maxX - MAP.minX)) * w,
      y: ((z - MAP.minZ) / (MAP.maxZ - MAP.minZ)) * h,
    };
  }

  function drawMinimap(state) {
    const canvas = el('minimap');
    const ctx = minimapContext();
    if (!canvas || !ctx) return;
    const w = canvas.width || 160;
    const h = canvas.height || 110;
    const s = state || {};
    ctx.clearRect(0, 0, w, h);

    // Panel background + outline.
    ctx.fillStyle = 'rgba(23,19,15,0.72)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = PALETTE.hairline;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    // Site markers.
    const sites = [SITE_A, SITE_B];
    for (let i = 0; i < sites.length; i++) {
      const p = project(sites[i].x, sites[i].z, w, h);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,194,26,0.25)';
      ctx.fill();
      ctx.strokeStyle = PALETTE.hazard;
      ctx.stroke();
      ctx.fillStyle = PALETTE.hazard;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sites[i].label, p.x, p.y);
    }

    // Bomb marker (planted): pulsing red diamond on the planted site.
    if (s.bombPlanted && s.bombSite) {
      const site = s.bombSite === 'A' ? SITE_A : SITE_B;
      const p = project(site.x, site.z, w, h);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = PALETTE.furnace;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.strokeStyle = PALETTE.furnace;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Teammate dots (amber).
    const mates = s.teammates || [];
    for (let i = 0; i < mates.length; i++) {
      const m = mates[i];
      if (!m || m.alive === false) continue;
      const p = project(m.x, m.z, w, h);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.accent;
      ctx.fill();
    }

    // Player arrow (ink, rotated by yaw).
    const pp = s.playerPos;
    if (pp) {
      const p = project(pp.x, pp.z, w, h);
      const yaw = s.playerYaw || 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      // Canvas y grows downward while world -z is "north": flip the angle.
      ctx.rotate(-yaw);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fillStyle = PALETTE.ink;
      ctx.fill();
      ctx.restore();
    }
  }

  // --- public API ----------------------------------------------------------

  const api = {
    setHealth(hp, armor) {
      const h = Math.max(0, Math.min(100, Math.round(hp || 0)));
      const fill = el('health-fill');
      if (fill) {
        fill.style.width = h + '%';
        fill.style.backgroundColor = h > 50 ? PALETTE.accent : h > 25 ? PALETTE.hazard : PALETTE.furnace;
      }
      setText('health-num', String(h));
      setText('armor-num', String(Math.max(0, Math.round(armor || 0))));
    },

    setAmmo(mag, reserve) {
      setText('ammo-mag', String(mag == null ? '—' : mag));
      setText('ammo-reserve', '/ ' + String(reserve == null ? '—' : reserve));
    },

    setMoney(n) {
      const v = el('money-value');
      if (v) v.textContent = '$' + Math.max(0, Math.round(n || 0));
      else setText('money', '$' + Math.max(0, Math.round(n || 0)));
    },

    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds || 0));
      const mm = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0');
      const timer = el('timer');
      if (timer) {
        timer.textContent = mm + ':' + ss;
        timer.style.color =
          phase === 'buy' ? PALETTE.hazard : s <= 10 && phase === 'live' ? PALETTE.furnace : '';
      }
    },

    setScore(ember, slate, round) {
      setText('score-ember', String(ember || 0));
      setText('score-slate', String(slate || 0));
      setText('round-num', 'ROUND ' + String(round || 1));
    },

    setWeapon(name) {
      setText('weapon-name', name || '');
    },

    setGrenades(counts) {
      const c = counts || {};
      const smoke = c.smoke || 0;
      const flash = c.flash || 0;
      const he = c.he || 0;
      setText('grenade-counts', 'SMK ' + smoke + '  ·  FLS ' + flash + '  ·  HE ' + he);
    },

    setBomb(text) {
      setText('bomb-status', text || '');
    },

    killfeedAdd(text, cls) {
      const feed = el('killfeed');
      if (!feed) return;
      const row = document.createElement('div');
      row.className = 'killfeed-row' + (cls ? ' ' + cls : '');
      row.textContent = text;
      feed.appendChild(row);
      while (feed.children.length > 5) feed.removeChild(feed.firstChild);
      setTimeout(() => {
        row.style.opacity = '0';
        setTimeout(() => {
          if (row.parentNode === feed) feed.removeChild(row);
        }, 600);
      }, 5000);
    },

    // Brief hitmarker flash; killed=true shows it in furnace red.
    hitMarker(killed) {
      const m = el('hitmarker');
      if (!m) return;
      m.classList.add('on');
      m.classList.toggle('kill', !!killed);
      if (hitTimer) clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        m.classList.remove('on');
        m.classList.remove('kill');
      }, 140);
    },

    // angleDeg: direction the damage came from, 0 = ahead, clockwise.
    damageFrom(angleDeg) {
      if (vignette) {
        vignette.style.opacity = '1';
        setTimeout(() => {
          vignette.style.opacity = '0';
        }, 350);
      }
      if (damageArc) {
        damageArc.style.opacity = '1';
        damageArc.style.transform = 'rotate(' + (angleDeg || 0) + 'deg)';
        setTimeout(() => {
          damageArc.style.opacity = '0';
        }, 350);
      }
    },

    // Crosshair gap in px (spread). Drives a CSS var the stylesheet uses.
    setCrosshairSpread(px) {
      const c = el('crosshair');
      if (c) c.style.setProperty('--crosshair-gap', Math.max(0, Math.round(px || 0)) + 'px');
    },

    showBanner(title, sub, ms) {
      const banner = el('banner');
      if (!banner) return;
      setText('banner-title', title || '');
      setText('banner-sub', sub || '');
      banner.classList.add('on');
      show(banner);
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.classList.remove('on');
        hide(banner);
      }, ms || 2500);
    },

    hideBanner() {
      const banner = el('banner');
      if (!banner) return;
      if (bannerTimer) clearTimeout(bannerTimer);
      banner.classList.remove('on');
      hide(banner);
    },

    // mode: 'menu' | 'paused' | 'roundEnd' | 'matchEnd'. data carries
    // { title, copy } or, for matchEnd, { winner, ember, slate }.
    showOverlay(mode, data) {
      const overlay = el('overlay');
      if (!overlay) return;
      const d = data || {};
      let title = d.title;
      let copy = d.copy;
      let action = 'Click to play';
      if (mode === 'paused') {
        title = title || 'Paused';
        copy = copy || 'Click to resume the round.';
        action = 'Click to resume';
      } else if (mode === 'matchEnd') {
        const w = d.winner || 'Ember';
        title = title || `${w} wins the match`;
        copy = copy || `Final score Ember ${d.ember || 0} — ${d.slate || 0} Slate.`;
        action = 'Play again';
      } else {
        title = title || 'EMBERLINE';
        copy = copy || '5v5 tactical FPS in the Emberworks foundry. Plant the Spark at Furnace or Crane Yard — or drop all five Slate defenders. First to 8 rounds takes the match.';
      }
      setText('overlay-title', title);
      setText('overlay-copy', copy);
      const play = el('play');
      if (play) {
        play.textContent = action;
        play.style.display = mode === 'roundEnd' ? 'none' : '';
      }
      overlay.dataset.mode = mode || '';
      show(overlay);
    },

    hideOverlay() {
      hide(el('overlay'));
    },

    // Buy menu: items = [{ kind:'weapon'|'grenade'|'armor', id, name, price,
    // owned }]. Rows are numbered 1..9 (key or click buys).
    openBuy(items, money) {
      buyItems = Array.isArray(items) ? items : [];
      const menu = el('buy-menu');
      const list = el('buy-items');
      if (list) {
        list.innerHTML = '';
        for (let i = 0; i < buyItems.length && i < 9; i++) {
          const item = buyItems[i];
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'buy-row' + (item.owned ? ' owned' : '');
          row.dataset.kind = item.kind;
          row.dataset.id = item.id;
          const price = item.owned ? 'OWNED' : '$' + item.price;
          row.textContent = (i + 1) + '  ' + item.name + '  —  ' + price;
          row.addEventListener('click', () => {
            if (buyHandler) buyHandler(item.kind, item.id);
          });
          list.appendChild(row);
        }
      }
      api.setBuyMoney(money);
      if (menu) show(menu);
      buyOpen = true;
    },

    closeBuy() {
      hide(el('buy-menu'));
      buyOpen = false;
    },

    isBuyOpen() {
      return buyOpen;
    },

    setBuyMoney(n) {
      setText('buy-money', '$' + Math.max(0, Math.round(n || 0)));
    },

    // Flashbang white-out. strength 0..1; fades back over ~1.2 s.
    flashWhite(strength) {
      const f = el('flash-overlay');
      if (!f) return;
      const s = Math.max(0, Math.min(1, strength == null ? 1 : strength));
      f.style.transition = 'none';
      f.style.opacity = String(s);
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        f.style.transition = 'opacity 1.2s ease-out';
        f.style.opacity = '0';
      }, 30);
    },

    setHint(text) {
      const h = el('hint');
      if (!h) return;
      h.textContent = text || '';
      h.style.display = text ? '' : 'none';
    },

    // state = { playerPos:{x,z}, playerYaw, teammates:[{x,z,alive}],
    //           bombPlanted, bombSite:'A'|'B' }.
    updateMinimap(state) {
      drawMinimap(state);
    },

    onPlay(handler) {
      playHandler = handler || null;
    },

    onBuy(handler) {
      buyHandler = handler || null;
    },
  };

  return api;
}
