// Drawing only: the world's state and the current screen in, pixels out.
// The 1280x720 playfield is scaled to fit the window and centred, the
// margin filled with the backdrop colour. Flat shapes (a turkey, a farmer,
// swinging knives, ovens, corn), canvas text for the HUD and the panels.
import { ACTS, FIELD, FONT, OVEN, PALETTE, TURKEY } from './config.js';
import { KIND_CRATE, KIND_HAY, KIND_TABLE } from './world.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const CAMERA_LEAD = 320;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  function text(value, x, y, size, color, align) {
    ctx.font = `${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = 'rgba(30, 18, 8, 0.82)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PALETTE.hudMuted;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function sky(act) {
    const tops = [PALETTE.farmSkyTop, PALETTE.barnSkyTop, PALETTE.kitchenSkyTop];
    const bottoms = [PALETTE.farmSkyBottom, PALETTE.barnSkyBottom, PALETTE.kitchenSkyBottom];
    const g = ctx.createLinearGradient(0, 0, 0, FIELD.height);
    g.addColorStop(0, tops[act]);
    g.addColorStop(1, bottoms[act]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    // A low autumn sun.
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(1080, 110, 46, 0, Math.PI * 2);
    ctx.fill();
  }

  function scenery(state, cam) {
    const act = state.act;
    const grounds = [PALETTE.groundFarm, PALETTE.groundBarn, PALETTE.groundKitchen];
    if (act === 0) {
      // Fence posts drifting past, and the barn in the far distance.
      ctx.fillStyle = '#8a5a2e';
      for (let i = 0; i < 8; i += 1) {
        const px = ((i * 340 - cam * 0.3) % 1360 + 1360) % 1360 - 40;
        ctx.fillRect(px, FIELD.groundY - 90, 10, 90);
        ctx.fillRect(px - 14, FIELD.groundY - 84, 48, 8);
      }
      ctx.fillStyle = '#a03d21';
      ctx.fillRect(980 - cam * 0.15, 300, 260, 220);
      ctx.fillStyle = '#7d2c15';
      ctx.beginPath();
      ctx.moveTo(960 - cam * 0.15, 300);
      ctx.lineTo(1110 - cam * 0.15, 210);
      ctx.lineTo(1260 - cam * 0.15, 300);
      ctx.closePath();
      ctx.fill();
    } else if (act === 1) {
      // Barn beams overhead and hay piled along the back wall.
      ctx.fillStyle = '#6b4423';
      ctx.fillRect(0, 120, FIELD.width, 26);
      ctx.fillRect(0, 300, FIELD.width, 18);
      ctx.fillStyle = '#c9a227';
      for (let i = 0; i < 5; i += 1) {
        const px = ((i * 420 - cam * 0.4) % 1500 + 1500) % 1500 - 100;
        ctx.beginPath();
        ctx.ellipse(px, FIELD.groundY - 26, 90, 34, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Kitchen tiles and a window with the woods beyond it.
      ctx.fillStyle = '#e9dcc3';
      for (let y = 60; y < 480; y += 60) {
        ctx.fillRect(0, y, FIELD.width, 2);
      }
      ctx.fillStyle = '#9db98a';
      ctx.fillRect(180, 90, 300, 200);
      ctx.fillStyle = '#5e8a3c';
      ctx.beginPath();
      ctx.moveTo(180, 290);
      ctx.lineTo(280, 170);
      ctx.lineTo(380, 290);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#7d5230';
      ctx.fillRect(170, 80, 320, 12);
      ctx.fillRect(170, 290, 320, 12);
      ctx.fillRect(170, 80, 12, 222);
      ctx.fillRect(478, 80, 12, 222);
    }
    ctx.fillStyle = grounds[act];
    ctx.fillRect(0, FIELD.groundY, FIELD.width, FIELD.height - FIELD.groundY);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, FIELD.groundY, FIELD.width, 6);
  }

  function hideSpot(h, cam) {
    const x = h.x - cam;
    if (x < -160 || x > FIELD.width + 40) return;
    const y = FIELD.groundY;
    if (h.kind === KIND_HAY) {
      ctx.fillStyle = '#d9a521';
      ctx.beginPath();
      ctx.ellipse(x + 65, y - 34, 66, 38, 0, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = '#a67c14';
      ctx.lineWidth = 2;
      for (let i = -2; i <= 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(x + 65 + i * 18, y - 66);
        ctx.lineTo(x + 65 + i * 22, y - 20);
        ctx.stroke();
      }
    } else if (h.kind === KIND_CRATE) {
      ctx.fillStyle = '#8a5a2e';
      ctx.fillRect(x, y - 84, 130, 84);
      ctx.strokeStyle = '#5e3618';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y - 84, 130, 84);
      ctx.beginPath();
      ctx.moveTo(x, y - 42);
      ctx.lineTo(x + 130, y - 42);
      ctx.moveTo(x + 65, y - 84);
      ctx.lineTo(x + 65, y);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#f5f2ea';
      ctx.fillRect(x, y - 78, 130, 16);
      ctx.fillRect(x + 8, y - 62, 114, 62);
      ctx.fillStyle = '#c94f43';
      ctx.fillRect(x + 8, y - 62, 114, 10);
    }
  }

  function turkey(state, cam, t) {
    const tk = state.turkey;
    const x = tk.x - cam;
    const y = tk.y;
    if (x < -90 || x > FIELD.width + 90) return;
    const ducked = tk.ducked;
    const blink = tk.invulnerable > 0 && Math.floor(t * 12) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.35;
    const bob = tk.onGround && !ducked ? Math.sin(t * 14) * 2 : 0;
    const bodyY = y + (ducked ? 12 : 0) + bob;
    // Tail fan.
    ctx.fillStyle = PALETTE.tail[0];
    for (let i = -2; i <= 2; i += 1) {
      ctx.save();
      ctx.translate(x + 12, bodyY + 16);
      ctx.rotate(i * 0.42);
      ctx.fillStyle = PALETTE.tail[(i + 2) % PALETTE.tail.length];
      ctx.beginPath();
      ctx.ellipse(-16, -22, 9, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Body.
    ctx.fillStyle = PALETTE.turkeyBody;
    ctx.beginPath();
    ctx.ellipse(x + 32, bodyY + 20, 30, ducked ? 13 : 20, 0, 0, Math.PI * 2);
    ctx.fill();
    // Wing.
    ctx.fillStyle = PALETTE.turkeyWing;
    ctx.beginPath();
    ctx.ellipse(x + 28, bodyY + 20, 16, 10, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Head and beak, tucked when ducked.
    const hx = x + 56;
    const hy = ducked ? bodyY + 12 : bodyY - 6;
    ctx.fillStyle = PALETTE.head;
    ctx.beginPath();
    ctx.arc(hx, hy, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.beak;
    ctx.beginPath();
    ctx.moveTo(hx + 9, hy - 2);
    ctx.lineTo(hx + 20, hy + 2);
    ctx.lineTo(hx + 9, hy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PALETTE.wattle;
    ctx.beginPath();
    ctx.arc(hx + 6, hy + 10, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d1410';
    ctx.beginPath();
    ctx.arc(hx + 3, hy - 3, 2, 0, Math.PI * 2);
    ctx.fill();
    // Legs, stepping when it runs.
    if (!ducked) {
      const step = tk.onGround ? Math.sin(t * 16) * 6 : 0;
      ctx.strokeStyle = '#c98a3d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 24, bodyY + 38);
      ctx.lineTo(x + 24 + step, FIELD.groundY);
      ctx.moveTo(x + 40, bodyY + 38);
      ctx.lineTo(x + 40 - step, FIELD.groundY);
      ctx.stroke();
    }
    // The chef hat, when the turkey is wearing one.
    if (tk.disguised > 0) {
      ctx.fillStyle = PALETTE.hatWhite;
      ctx.fillRect(hx - 8, hy - 24, 22, 10);
      ctx.beginPath();
      ctx.arc(hx - 2, hy - 24, 8, Math.PI, 0);
      ctx.arc(hx + 8, hy - 24, 8, Math.PI, 0);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function farmer(state, cam) {
    const f = state.farmer;
    const x = f.x - cam;
    if (x < -120 || x > FIELD.width + 120) return;
    const y = FIELD.groundY;
    const stride = f.mode === 'chase' ? Math.sin(state.elapsed * 14) * 8 : Math.sin(state.elapsed * 6) * 3;
    // Legs.
    ctx.strokeStyle = PALETTE.farmerOveralls;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x + 20, y - 52);
    ctx.lineTo(x + 20 + stride, y);
    ctx.moveTo(x + 34, y - 52);
    ctx.lineTo(x + 34 - stride, y);
    ctx.stroke();
    // Body: shirt and overalls.
    ctx.fillStyle = PALETTE.farmerShirt;
    ctx.fillRect(x + 8, y - 96, 46, 46);
    ctx.fillStyle = PALETTE.farmerOveralls;
    ctx.fillRect(x + 8, y - 74, 46, 24);
    // Head and straw hat.
    ctx.fillStyle = PALETTE.farmerSkin;
    ctx.beginPath();
    ctx.arc(x + 31, y - 108, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.farmerHat;
    ctx.beginPath();
    ctx.ellipse(x + 31, y - 118, 26, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + 17, y - 134, 28, 16);
    // Pitchfork, carried at his side.
    ctx.strokeStyle = '#7a5a34';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + 56, y - 120);
    ctx.lineTo(x + 56, y - 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 48, y - 120);
    ctx.lineTo(x + 48, y - 104);
    ctx.moveTo(x + 56, y - 120);
    ctx.lineTo(x + 56, y - 104);
    ctx.moveTo(x + 64, y - 120);
    ctx.lineTo(x + 64, y - 104);
    ctx.stroke();
    // What he is thinking.
    let mark = null;
    if (f.mode === 'chase') mark = '!';
    else if (f.mode === 'search') mark = '?';
    else if (f.mode === 'hesitate') mark = '...';
    if (mark !== null) {
      ctx.fillStyle = '#fdf3d8';
      ctx.beginPath();
      ctx.arc(x + 62, y - 158, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1d1410';
      text(mark, x + 62, y - 152, 20, '#1d1410', 'center');
    }
  }

  function knife(k, state, cam) {
    const x = k.x - cam;
    if (x < -220 || x > FIELD.width + 220) return;
    const angle = Math.sin(state.elapsed * 1.6 + k.phase) * 0.85;
    const pivotY = FIELD.groundY - 240;
    // The beam it hangs from.
    ctx.strokeStyle = '#5e3618';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x - 30, pivotY - 8);
    ctx.lineTo(x + 30, pivotY - 8);
    ctx.stroke();
    // Blade and handle.
    ctx.save();
    ctx.translate(x, pivotY);
    ctx.rotate(angle);
    ctx.fillStyle = PALETTE.knifeBlade;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(7, 0);
    ctx.lineTo(4, 150);
    ctx.lineTo(0, 195);
    ctx.lineTo(-4, 150);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PALETTE.knifeHandle;
    ctx.fillRect(-8, -34, 16, 36);
    ctx.restore();
  }

  function oven(o, cam) {
    const x = o.x - cam;
    if (x < -160 || x > FIELD.width + 160) return;
    const y = FIELD.groundY;
    if (o.blasting) {
      const g = ctx.createLinearGradient(0, y - 320, 0, y - OVEN.height);
      g.addColorStop(0, 'rgba(255, 122, 26, 0)');
      g.addColorStop(1, 'rgba(255, 122, 26, 0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 6, y - 320, OVEN.width - 12, 320 - OVEN.height);
    }
    ctx.fillStyle = PALETTE.ovenBody;
    ctx.fillRect(x, y - OVEN.height, OVEN.width, OVEN.height);
    ctx.fillStyle = o.warning || o.blasting ? PALETTE.ovenGlow : '#3a3f46';
    ctx.fillRect(x + 14, y - OVEN.height + 12, OVEN.width - 28, 34);
    ctx.strokeStyle = '#5b6067';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y - OVEN.height, OVEN.width, OVEN.height);
    if (o.warning) {
      text('!', x + OVEN.width / 2, y - OVEN.height - 12, 26, PALETTE.alert, 'center');
    }
  }

  function pickup(c, cam) {
    const x = c.x - cam;
    if (x < -40 || x > FIELD.width + 40) return;
    ctx.fillStyle = c.golden ? '#ffe066' : PALETTE.corn;
    ctx.beginPath();
    ctx.ellipse(x, c.y, 11, 15, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.cornHusk;
    ctx.beginPath();
    ctx.moveTo(x - 8, c.y + 10);
    ctx.lineTo(x - 16, c.y + 26);
    ctx.lineTo(x - 2, c.y + 16);
    ctx.closePath();
    ctx.fill();
  }

  function hatPickup(h, cam) {
    if (h.taken) return;
    const x = h.x - cam;
    if (x < -40 || x > FIELD.width + 40) return;
    const y = FIELD.groundY - 40;
    ctx.fillStyle = PALETTE.hatWhite;
    ctx.fillRect(x - 14, y - 8, 28, 12);
    ctx.beginPath();
    ctx.arc(x - 7, y - 8, 9, Math.PI, 0);
    ctx.arc(x + 7, y - 8, 9, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = '#c9c2b2';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 14, y - 8, 28, 12);
  }

  function hud(state, best) {
    ctx.fillStyle = PALETTE.hudPanel;
    ctx.fillRect(0, 0, FIELD.width, 56);
    text(`SCORE ${state.score}`, 24, 36, 24, PALETTE.hudText);
    text(`${Math.floor(state.turkey.x / FIELD.pxPerMetre)} m`, 300, 36, 24, PALETTE.hudText);
    text(ACTS[state.act].name, 470, 36, 24, PALETTE.hudMuted);
    // Lives as tail feathers.
    for (let i = 0; i < 3; i += 1) {
      ctx.fillStyle = i < state.lives ? PALETTE.tail[i % PALETTE.tail.length] : '#5a4632';
      ctx.beginPath();
      ctx.ellipse(640 + i * 30, 28, 8, 16, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Noise bar.
    text('NOISE', 780, 36, 18, PALETTE.hudMuted);
    ctx.fillStyle = '#3a2c1c';
    ctx.fillRect(850, 20, 140, 16);
    ctx.fillStyle = state.noise > 0.66 ? PALETTE.alert : PALETTE.quiet;
    ctx.fillRect(850, 20, 140 * clamp(state.noise, 0, 1), 16);
    // Suspicion eye.
    const s = clamp(state.suspicion, 0, 100) / 100;
    ctx.fillStyle = '#fdf3d8';
    ctx.beginPath();
    ctx.ellipse(1070, 28, 22, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s > 0.7 ? PALETTE.alert : '#1d1410';
    ctx.beginPath();
    ctx.arc(1070, 28, 5 + s * 4, 0, Math.PI * 2);
    ctx.fill();
    text(`BEST ${best}`, 1130, 36, 20, PALETTE.hudMuted);
  }

  function drawWorld(state, t) {
    const cam = Math.max(0, state.turkey.x - CAMERA_LEAD);
    sky(state.act);
    scenery(state, cam);
    for (const h of state.hides) hideSpot(h, cam);
    for (const o of state.ovens) oven(o, cam);
    for (const c of state.corn) if (c.active) pickup(c, cam);
    hatPickup(state.hat, cam);
    for (const k of state.knives) knife(k, state, cam);
    farmer(state, cam);
    turkey(state, cam, t);
    return cam;
  }

  function draw(state, screen, best, opts) {
    const t = state.elapsed;
    resize();
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(-view.x / view.scale, -view.y / view.scale, FIELD.width + 2 * view.x / view.scale, FIELD.height + 2 * view.y / view.scale);
    drawWorld(state, t);
    if (screen === SCREEN_TITLE) {
      panel(340, 150, 600, 330);
      text('DINNER IS CANCELLED', 640, 220, 44, PALETTE.hudText, 'center');
      text('a turkey escape in three acts', 640, 262, 22, PALETTE.hudMuted, 'center');
      text('Run right. Duck behind hay, crates and tables to hide.', 640, 320, 20, PALETTE.hudText, 'center');
      text('Loud feet bring the farmer. The chef hat buys you time.', 640, 350, 20, PALETTE.hudText, 'center');
      text('Arrows / A D to run   Down to duck   Space to jump', 640, 392, 20, PALETTE.hudText, 'center');
      text('Press Space or click to run', 640, 446, 22, PALETTE.hudMuted, 'center');
      if (best > 0) text(`Best ${best}`, 640, 480, 18, PALETTE.hudMuted, 'center');
    } else if (screen === SCREEN_PLAY) {
      hud(state, best);
      if (opts && opts.hideFocus) {
        ctx.fillStyle = PALETTE.hudPanel;
        ctx.fillRect(390, 640, 500, 44);
        text('HIDDEN — the farmer lost the trail', 640, 670, 22, PALETTE.hudText, 'center');
      }
    } else if (screen === SCREEN_PAUSED) {
      hud(state, best);
      panel(490, 280, 300, 120);
      text('PAUSED', 640, 330, 36, PALETTE.hudText, 'center');
      text('P to carry on', 640, 372, 20, PALETTE.hudMuted, 'center');
    } else if (screen === SCREEN_OVER) {
      hud(state, best);
      panel(340, 170, 600, 300);
      if (state.escaped) {
        text('ESCAPED!', 640, 240, 44, PALETTE.hudText, 'center');
        text('Dinner is cancelled. The farmer is still', 640, 292, 22, PALETTE.hudText, 'center');
        text('looking under the table.', 640, 322, 22, PALETTE.hudText, 'center');
      } else {
        text('CAUGHT!', 640, 240, 44, PALETTE.alert, 'center');
        text('Dinner is back on. The farmer is', 640, 292, 22, PALETTE.hudText, 'center');
        text('sharpening the carving knife.', 640, 322, 22, PALETTE.hudText, 'center');
      }
      text(`Score ${state.score}   Best ${best}`, 640, 380, 22, PALETTE.hudText, 'center');
      text('Press Space or click to run again', 640, 430, 20, PALETTE.hudMuted, 'center');
    }
  }

  return { draw };
}
