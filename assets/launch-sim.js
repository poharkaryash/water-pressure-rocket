/*
 * Water-rocket launch simulator (physics estimate, not a measurement).
 *
 * Model, per time step:
 *   Water phase  - compressed air expands adiabatically (P V^1.4 = const) and pushes
 *                  water out of the nozzle: exit speed v = sqrt(2 dP / rho_w), thrust = mdot v.
 *   Air phase    - the remaining compressed air vents through the same nozzle
 *                  (choked or subsonic isentropic flow).
 *   Coast        - gravity and quadratic air drag until the rocket stops climbing.
 * Assumes all bottles share one air volume freely, a vertical launch and no launch-tube boost.
 */
(function () {
  "use strict";

  const P_ATM = 101325, RHO_W = 1000, G = 9.81, GAMMA = 1.4, R_AIR = 287.05, T0 = 293.15, RHO_AMB = 1.2, PSI = 6894.757;
  const PHASE = { water: 1, air: 2, coast: 0 };

  function circle(d_mm) { return Math.PI / 4 * Math.pow(d_mm / 1000, 2); }

  const CONFIGS = {
    six: {
      label: "Six-bottle (upgrade)", side: 3,
      volume_l: 7.0,                       // 1 x 2 L main + 5 x 1 L air bottles
      dry_g: 405,                          // SOLIDWORKS mass estimate
      area_m2: circle(105) + 3 * circle(78.5) + 6 * 0.003 * 0.07,
    },
    four: {
      label: "Original four-bottle", side: 2,
      volume_l: 5.0,                       // 1 x 2 L main + 3 x 1 L air bottles
      dry_g: 230,                          // earlier SOLIDWORKS mass estimate
      area_m2: circle(105) + 2 * circle(78.5) + 0.0005,
    },
  };

  function simulate(cfg, p) {
    const vTot = cfg.volume_l / 1000;
    const vW0 = Math.min(p.water_l, cfg.volume_l - 0.05) / 1000;
    const vA0 = vTot - vW0;
    const p0 = p.psi * PSI + P_ATM;
    const areaN = Math.PI * Math.pow(p.nozzle_mm / 2000, 2);
    const mDry = p.dry_g / 1000;
    const mAir0 = p0 * vA0 / (R_AIR * T0);

    let t = 0, h = 0, v = 0, vW = vW0, mAir = mAir0, phase = "water";
    let pres = p0, temp = T0, pEnd = 0, tEnd = 0, rhoEnd = 0;
    let dt = 2e-4, maxV = 0, maxH = 0, tApogee = 0, burn = 0, waterT = 0, maxThrust = 0;
    const log = [];
    let step = 0;

    while (t < 30) {
      let thrust = 0;
      if (phase === "water") {
        const vA = vTot - vW;
        pres = p0 * Math.pow(vA0 / vA, GAMMA);
        temp = T0 * Math.pow(vA0 / vA, GAMMA - 1);
        if (pres <= P_ATM) {
          phase = "coast"; burn = waterT = t;
        } else {
          const ve = Math.sqrt(2 * (pres - P_ATM) / RHO_W);
          const mdot = RHO_W * areaN * ve;
          thrust = mdot * ve;
          const dvW = mdot / RHO_W * dt;
          if (dvW >= vW) {
            vW = 0; waterT = t; phase = "air";
            pEnd = pres; tEnd = temp; rhoEnd = pres / (R_AIR * temp); mAir = rhoEnd * vTot;
          } else {
            vW -= dvW;
          }
        }
      } else if (phase === "air") {
        const rho = mAir / vTot;
        pres = pEnd * Math.pow(rho / rhoEnd, GAMMA);
        temp = tEnd * Math.pow(pres / pEnd, (GAMMA - 1) / GAMMA);
        if (pres <= P_ATM * 1.001) {
          phase = "coast"; burn = t;
        } else {
          const crit = Math.pow((GAMMA + 1) / 2, GAMMA / (GAMMA - 1));
          let mdot;
          if (pres / P_ATM > crit) {
            const tE = temp * 2 / (GAMMA + 1), pE = pres / crit;
            const vE = Math.sqrt(GAMMA * R_AIR * tE);
            mdot = pE / (R_AIR * tE) * areaN * vE;
            thrust = mdot * vE + (pE - P_ATM) * areaN;
          } else {
            const tE = temp * Math.pow(P_ATM / pres, (GAMMA - 1) / GAMMA);
            const vE = Math.sqrt(2 * GAMMA / (GAMMA - 1) * R_AIR * (temp - tE));
            mdot = P_ATM / (R_AIR * tE) * areaN * vE;
            thrust = mdot * vE;
          }
          mAir = Math.max(mAir - mdot * dt, 0);
        }
      }
      const mass = mDry + vW * RHO_W + (phase !== "coast" ? mAir : 0);
      const drag = 0.5 * RHO_AMB * v * Math.abs(v) * p.cd * cfg.area_m2;
      let acc = (thrust - drag) / mass - G;
      if (h <= 0 && acc < 0 && t < 0.05) acc = 0;
      v += acc * dt; h += v * dt; t += dt;
      maxThrust = Math.max(maxThrust, thrust);
      if (v > maxV) maxV = v;
      if (h > maxH) { maxH = h; tApogee = t; }
      if (step++ % (dt < 1e-3 ? 25 : 5) === 0) log.push([t, h, v, thrust, PHASE[phase]]);
      if (phase === "coast" && v < 0) break;
      if (phase === "coast" && dt < 1e-3) dt = 1e-3;
    }
    log.push([t, h, v, 0, 0]);
    return {
      apogee: maxH, maxV, tApogee, burn, waterT, maxThrust,
      launchMass: (mDry + vW0 * RHO_W + mAir0) * 1000, log,
    };
  }
  window.WaterRocketSim = { simulate, CONFIGS };

  // ---------------------------------------------------------------- UI
  const root = document.getElementById("launch-sim");
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);
  const inputs = {
    water: $("#sim-water"), psi: $("#sim-psi"), dry: $("#sim-dry"), nozzle: $("#sim-nozzle"), cd: $("#sim-cd"),
  };
  const outs = {
    water: $("#sim-water-val"), psi: $("#sim-psi-val"), dry: $("#sim-dry-val"), nozzle: $("#sim-nozzle-val"), cd: $("#sim-cd-val"),
    compare: $("#sim-compare"),
  };
  const stats = {
    apogee: { el: $("#sim-apogee"), fmt: (x) => x.toFixed(1), unit: " m" },
    apogeeFt: { el: $("#sim-apogee-ft"), fmt: (x) => x.toFixed(0), unit: " ft" },
    speed: { el: $("#sim-speed"), fmt: (x) => x.toFixed(1), unit: " m/s" },
    thrust: { el: $("#sim-thrust"), fmt: (x) => x.toFixed(0), unit: " N" },
    burn: { el: $("#sim-burn"), fmt: (x) => x.toFixed(2), unit: " s" },
    tApogee: { el: $("#sim-tapogee"), fmt: (x) => x.toFixed(2), unit: " s" },
    mass: { el: $("#sim-mass"), fmt: (x) => x.toFixed(2), unit: " kg" },
  };
  const chart = $("#sim-chart"), flight = $("#sim-flight"), bottle = $("#sim-bottle"), gauge = $("#sim-gauge");
  const launchBtn = $("#sim-launch");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let configKey = "six", current = null, other = null;
  let playT = null;          // simulation time shown in the scene (null = on the pad)
  let anim = null, countdown = null, particles = [], trail = [];

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const isLight = () => document.documentElement.dataset.theme === "light";

  function setupCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function params() {
    return {
      water_l: +inputs.water.value, psi: +inputs.psi.value, dry_g: +inputs.dry.value,
      nozzle_mm: +inputs.nozzle.value, cd: +inputs.cd.value,
    };
  }

  function rowAt(log, t) {
    if (t <= 0) return log[0];
    let lo = 0, hi = log.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (log[mid][0] < t) lo = mid + 1; else hi = mid; }
    return log[lo];
  }

  // ---- animated number cards
  const shown = {};
  function setStat(key, value) {
    const s = stats[key];
    const from = shown[key] === undefined ? value : shown[key];
    shown[key] = value;
    if (reduceMotion || from === value) { s.el.textContent = s.fmt(value) + s.unit; return; }
    const start = performance.now();
    (function tick(now) {
      const k = Math.min((now - start) / 350, 1), e = 1 - Math.pow(1 - k, 3);
      s.el.textContent = s.fmt(from + (value - from) * e) + s.unit;
      if (k < 1) requestAnimationFrame(tick);
    })(start);
  }

  function run() {
    stopFlight();
    const p = params();
    outs.water.textContent = p.water_l.toFixed(2) + " L";
    outs.psi.textContent = p.psi + " psi · " + (p.psi * 0.0689476).toFixed(1) + " bar";
    outs.dry.textContent = p.dry_g + " g";
    outs.nozzle.textContent = p.nozzle_mm.toFixed(1) + " mm";
    outs.cd.textContent = p.cd.toFixed(2);
    current = simulate(CONFIGS[configKey], p);
    const otherKey = configKey === "six" ? "four" : "six";
    other = simulate(CONFIGS[otherKey], Object.assign({}, p, { dry_g: CONFIGS[otherKey].dry_g }));
    setStat("apogee", current.apogee);
    setStat("apogeeFt", current.apogee * 3.281);
    setStat("speed", current.maxV);
    setStat("thrust", current.maxThrust);
    setStat("burn", current.burn);
    setStat("tApogee", current.tApogee);
    setStat("mass", current.launchMass / 1000);
    const diff = (current.apogee - other.apogee) / other.apogee * 100;
    outs.compare.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = (diff >= 0 ? "+" : "−") + Math.abs(diff).toFixed(0) + "%";
    b.style.color = diff >= 0 ? css("--accent") : css("--tube");
    outs.compare.append("Compared with the " + CONFIGS[otherKey].label.toLowerCase() + " at the same water and pressure (" +
      other.apogee.toFixed(1) + " m): ", b);
    drawAll();
  }

  // ---- 2 L bottle fill
  function drawBottle() {
    const { ctx, w, h } = setupCanvas(bottle);
    ctx.clearRect(0, 0, w, h);
    const bw = Math.min(56, w * 0.5), bx = (w - bw) / 2, top = 14, bottom = h - 22;
    const neckW = bw * 0.36, shoulder = top + 26;
    const path = new Path2D();
    path.moveTo(bx + (bw - neckW) / 2, top);
    path.lineTo(bx + (bw + neckW) / 2, top);
    path.lineTo(bx + (bw + neckW) / 2, top + 8);
    path.quadraticCurveTo(bx + bw, top + 14, bx + bw, shoulder);
    path.lineTo(bx + bw, bottom - 8);
    path.quadraticCurveTo(bx + bw, bottom, bx + bw - 8, bottom);
    path.lineTo(bx + 8, bottom);
    path.quadraticCurveTo(bx, bottom, bx, bottom - 8);
    path.lineTo(bx, shoulder);
    path.quadraticCurveTo(bx, top + 14, bx + (bw - neckW) / 2, top + 8);
    path.closePath();
    const frac = Math.min(+inputs.water.value / 2.0, 1);
    const level = bottom - frac * (bottom - shoulder);
    ctx.save();
    ctx.clip(path);
    const g = ctx.createLinearGradient(0, level, 0, bottom);
    g.addColorStop(0, css("--water"));
    g.addColorStop(1, isLight() ? "#065a85" : "#1a6f97");
    ctx.fillStyle = g;
    ctx.fillRect(bx, level, bw, bottom - level);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#fff";
    ctx.fillRect(bx, level, bw, 2);
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = css("--text");
    ctx.stroke(path);
    ctx.fillStyle = css("--muted");
    ctx.font = "600 11px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText((+inputs.water.value).toFixed(2) + " L", w / 2, h - 6);
  }

  // ---- pressure gauge
  function drawGauge() {
    const { ctx, w, h } = setupCanvas(gauge);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.62, r = Math.min(w / 2 - 8, h * 0.55);
    const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
    const psi = +inputs.psi.value, max = 80;
    const ang = a0 + (a1 - a0) * psi / max;
    ctx.lineCap = "round";
    ctx.lineWidth = 9;
    ctx.strokeStyle = css("--line");
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
    const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    g.addColorStop(0, css("--water")); g.addColorStop(1, css("--tube"));
    ctx.strokeStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, ang); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = css("--muted");
    ctx.fillStyle = css("--muted");
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "center";
    for (let v = 0; v <= max; v += 20) {
      const a = a0 + (a1 - a0) * v / max;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
      ctx.lineTo(cx + Math.cos(a) * (r - 9), cy + Math.sin(a) * (r - 9));
      ctx.stroke();
      ctx.fillText(v, cx + Math.cos(a) * (r - 24), cy + Math.sin(a) * (r - 24) + 3);
    }
    ctx.strokeStyle = css("--text"); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * (r - 18), cy + Math.sin(ang) * (r - 18)); ctx.stroke();
    ctx.fillStyle = css("--text");
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = "700 15px Space Grotesk, sans-serif";
    ctx.fillText(psi + " psi", cx, h - 6);
  }

  // ---- chart
  function drawChart() {
    const { ctx, w, h } = setupCanvas(chart);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 42, r: 14, t: 16, b: 26 };
    const tMax = Math.max(current.tApogee, other.tApogee) * 1.06;
    const hMax = Math.max(current.apogee, other.apogee) * 1.18;
    const X = (t) => pad.l + t / tMax * (w - pad.l - pad.r);
    const Y = (y) => h - pad.b - Math.max(y, 0) / hMax * (h - pad.t - pad.b);
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.lineWidth = 1;
    const hStep = hMax > 60 ? 20 : 10;
    for (let y = 0; y <= hMax; y += hStep) {
      ctx.strokeStyle = css("--line");
      ctx.beginPath(); ctx.moveTo(pad.l, Y(y)); ctx.lineTo(w - pad.r, Y(y)); ctx.stroke();
      ctx.fillStyle = css("--muted");
      ctx.fillText(y + " m", 4, Y(y) + 3);
    }
    const tStep = tMax > 4 ? 1 : 0.5;
    for (let t = 0; t <= tMax; t += tStep) ctx.fillText(t.toFixed(tStep < 1 ? 1 : 0) + " s", X(t) - 9, h - 8);
    // thrust bands
    ctx.fillStyle = css("--water"); ctx.globalAlpha = 0.22;
    ctx.fillRect(X(0), pad.t, X(current.waterT) - X(0), h - pad.t - pad.b);
    ctx.globalAlpha = 0.1;
    ctx.fillRect(X(current.waterT), pad.t, X(current.burn) - X(current.waterT), h - pad.t - pad.b);
    ctx.globalAlpha = 1;
    // other version
    ctx.strokeStyle = css("--muted"); ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.beginPath();
    other.log.forEach((r, i) => (i ? ctx.lineTo(X(r[0]), Y(r[1])) : ctx.moveTo(X(r[0]), Y(r[1]))));
    ctx.stroke(); ctx.setLineDash([]);
    // this version: filled area + line
    const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    grad.addColorStop(0, css("--tube") + "66"); grad.addColorStop(1, css("--tube") + "00");
    ctx.beginPath();
    ctx.moveTo(X(0), Y(0));
    current.log.forEach((r) => ctx.lineTo(X(r[0]), Y(r[1])));
    ctx.lineTo(X(current.log[current.log.length - 1][0]), Y(0));
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.strokeStyle = css("--tube"); ctx.lineWidth = 3;
    ctx.beginPath();
    current.log.forEach((r, i) => (i ? ctx.lineTo(X(r[0]), Y(r[1])) : ctx.moveTo(X(r[0]), Y(r[1]))));
    ctx.stroke();
    // peak marker
    ctx.fillStyle = css("--tube");
    ctx.beginPath(); ctx.arc(X(current.tApogee), Y(current.apogee), 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = css("--text"); ctx.font = "600 11px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText("peak " + current.apogee.toFixed(1) + " m", X(current.tApogee) - 8, Y(current.apogee) - 8);
    ctx.textAlign = "left";
    // playhead
    if (playT !== null) {
      const r = rowAt(current.log, playT);
      ctx.strokeStyle = css("--text"); ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(r[0]), pad.t); ctx.lineTo(X(r[0]), h - pad.b); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = css("--text");
      ctx.beginPath(); ctx.arc(X(r[0]), Y(r[1]), 4.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---- flight scene
  const clouds = Array.from({ length: 6 }, (_, i) => ({ x: (i * 0.19 + 0.07) % 1, y: 0.12 + (i * 0.37 % 0.55), s: 0.6 + (i % 3) * 0.25 }));

  function drawRocket(ctx, x, y, scale, glow) {
    const side = CONFIGS[configKey].side;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    if (glow) { ctx.shadowColor = css("--tube"); ctx.shadowBlur = 12; }
    const green = "#38c172", pet = isLight() ? "#7fc4de" : "#9fd8f0";
    // side bottles (drawn behind)
    const sx = side === 3 ? [-11, 11] : [-11, 11];
    ctx.fillStyle = green;
    sx.forEach((dx) => { roundRect(ctx, dx - 4, -20, 8, 20, 3); });
    // fins
    ctx.fillStyle = css("--tube");
    ctx.beginPath(); ctx.moveTo(-15, -14); ctx.lineTo(-22, 2); ctx.lineTo(-15, 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(15, -14); ctx.lineTo(22, 2); ctx.lineTo(15, 2); ctx.fill();
    // main bottle + stack
    ctx.fillStyle = pet;
    roundRect(ctx, -6, -28, 12, 28, 4);
    ctx.fillStyle = green;
    roundRect(ctx, -4.5, -48, 9, 19, 3);
    if (configKey === "six") {
      ctx.fillStyle = "#e3edf2";
      roundRect(ctx, -4.5, -68, 9, 19, 3);
      ctx.fillStyle = css("--tube");
      ctx.beginPath(); ctx.moveTo(-4.5, -60); ctx.lineTo(-10, -50); ctx.lineTo(-4.5, -50); ctx.fill();
      ctx.beginPath(); ctx.moveTo(4.5, -60); ctx.lineTo(10, -50); ctx.lineTo(4.5, -50); ctx.fill();
    }
    ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.fill();
  }

  function drawFlight() {
    const { ctx, w, h } = setupCanvas(flight);
    const light = isLight();
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, light ? "#8fcaf2" : "#050b18");
    sky.addColorStop(0.75, light ? "#d9f0ff" : "#14304d");
    sky.addColorStop(1, light ? "#f2fbff" : "#1d4a6b");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    if (!light) {
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = 0.25 + (i % 5) * 0.1;
        ctx.fillRect((i * 97.3) % w, (i * 53.7) % (h * 0.6), 1.2, 1.2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = light ? "rgba(255,255,255,.85)" : "rgba(160,190,220,.12)";
    clouds.forEach((c) => {
      const cx = c.x * w, cy = c.y * h, s = c.s * 22;
      ctx.beginPath();
      ctx.arc(cx, cy, s, 0, Math.PI * 2); ctx.arc(cx + s, cy + 4, s * 0.8, 0, Math.PI * 2); ctx.arc(cx - s, cy + 5, s * 0.7, 0, Math.PI * 2);
      ctx.fill();
    });
    const ground = h - 34, top = 84;
    const scaleMax = Math.max(current.apogee, 10) * 1.12;
    const Y = (y) => ground - Math.max(y, 0) / scaleMax * (ground - top);
    // hills + ground
    ctx.fillStyle = light ? "#9ccf8a" : "#16341f";
    ctx.beginPath(); ctx.moveTo(0, ground);
    for (let x = 0; x <= w; x += 20) ctx.lineTo(x, ground - 10 - 8 * Math.sin(x / 55) - 5 * Math.sin(x / 23));
    ctx.lineTo(w, ground); ctx.fill();
    ctx.fillStyle = light ? "#c9a46a" : "#3a2f20";
    ctx.fillRect(0, ground, w, h - ground);
    // altitude ruler
    ctx.font = "10px JetBrains Mono, monospace";
    const step = scaleMax > 60 ? 20 : 10;
    for (let y = 0; y <= scaleMax; y += step) {
      ctx.strokeStyle = light ? "rgba(0,0,0,.25)" : "rgba(255,255,255,.25)";
      ctx.beginPath(); ctx.moveTo(0, Y(y)); ctx.lineTo(10, Y(y)); ctx.stroke();
      ctx.fillStyle = light ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.55)";
      if (y > 0) ctx.fillText(y + " m", 14, Y(y) + 3);
    }
    // predicted apogee line
    const cx = w * 0.56;
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = css("--tube"); ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(60, Y(current.apogee)); ctx.lineTo(w - 12, Y(current.apogee)); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = css("--tube"); ctx.font = "600 11px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText("predicted peak " + current.apogee.toFixed(1) + " m", w - 14, Y(current.apogee) - 6);
    ctx.textAlign = "left";
    // launch pad
    ctx.fillStyle = light ? "#8a5a2b" : "#6b4a2a";
    ctx.fillRect(cx - 26, ground - 9, 52, 4);
    ctx.fillStyle = light ? "#cfd6da" : "#9aa3a8";
    ctx.fillRect(cx - 22, ground - 5, 4, 5); ctx.fillRect(cx + 18, ground - 5, 4, 5);

    const row = playT === null ? null : rowAt(current.log, playT);
    const hNow = row ? row[1] : 0;
    const ry = Math.min(Y(hNow), ground - 9);
    // trail
    if (trail.length > 1) {
      ctx.strokeStyle = light ? "rgba(255,255,255,.9)" : "rgba(200,230,255,.45)";
      ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath();
      trail.forEach((p, i) => (i ? ctx.lineTo(cx, p) : ctx.moveTo(cx, p)));
      ctx.stroke();
    }
    // particles
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(p.life, 0);
      ctx.fillStyle = p.kind === "water" ? css("--water") : (light ? "#ffffff" : "#cfe3f5");
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    drawRocket(ctx, cx, ry, 1.05, row && row[3] > 0);
    // HUD
    ctx.fillStyle = light ? "rgba(255,255,255,.75)" : "rgba(5,11,24,.6)";
    roundRect(ctx, w - 158, 10, 148, 54, 6);
    ctx.fillStyle = light ? "#0f1a24" : "#e6edf3";
    ctx.font = "600 11px JetBrains Mono, monospace";
    const t = row ? row[0] : 0;
    ctx.fillText("T+ " + t.toFixed(2) + " s", w - 148, 27);
    ctx.fillText("ALT " + Math.max(hNow, 0).toFixed(1) + " m", w - 148, 42);
    ctx.fillText("SPD " + (row ? Math.max(row[2], 0) : 0).toFixed(1) + " m/s", w - 148, 57);
    if (countdown !== null) {
      ctx.fillStyle = css("--tube");
      ctx.font = "700 64px Space Grotesk, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(countdown, w / 2, h / 2);
      ctx.textAlign = "left";
    }
    if (row && Math.abs(row[0] - current.tApogee) < 0.15) {
      ctx.fillStyle = css("--text");
      ctx.font = "700 13px Space Grotesk, sans-serif";
      ctx.fillText("Peak!", cx + 18, ry - 30);
    }
    return { cx, ry, ground };
  }

  function drawAll() { drawBottle(); drawGauge(); drawChart(); drawFlight(); }

  function stopFlight() {
    if (anim) cancelAnimationFrame(anim);
    anim = null; countdown = null; playT = null; particles = []; trail = [];
    launchBtn.disabled = false;
  }

  function launch() {
    stopFlight();
    launchBtn.disabled = true;
    if (reduceMotion) { playT = current.tApogee; drawAll(); launchBtn.disabled = false; return; }
    const startCount = performance.now();
    (function count(now) {
      const k = (now - startCount) / 600;
      countdown = k < 1 ? "3" : k < 2 ? "2" : k < 3 ? "1" : null;
      drawFlight();
      if (countdown !== null) { anim = requestAnimationFrame(count); return; }
      fly();
    })(startCount);
  }

  function fly() {
    const start = performance.now(), end = current.log[current.log.length - 1][0];
    let last = start;
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      playT = Math.min((now - start) / 1000, end);
      const row = rowAt(current.log, playT);
      const pos = drawFlight();
      trail.push(pos.ry);
      if (trail.length > 60) trail.shift();
      if (row[4] === 1) {
        for (let i = 0; i < 6; i++) particles.push({ kind: "water", x: pos.cx + (Math.random() - 0.5) * 6, y: pos.ry + 2, vx: (Math.random() - 0.5) * 120, vy: 180 + Math.random() * 160, r: 1.5 + Math.random() * 2, life: 1 });
      } else if (row[4] === 2) {
        for (let i = 0; i < 3; i++) particles.push({ kind: "air", x: pos.cx + (Math.random() - 0.5) * 8, y: pos.ry + 4, vx: (Math.random() - 0.5) * 70, vy: 60 + Math.random() * 60, r: 3 + Math.random() * 4, life: 0.8 });
      }
      particles.forEach((p) => {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt;
        if (p.y > pos.ground) { p.y = pos.ground; p.vy *= -0.2; p.vx *= 0.5; }
        p.life -= dt * (p.kind === "water" ? 0.9 : 1.6);
      });
      particles = particles.filter((p) => p.life > 0);
      drawChart();
      if (playT < end || particles.length) {
        anim = requestAnimationFrame(frame);
      } else {
        launchBtn.disabled = false;
      }
    }
    anim = requestAnimationFrame(frame);
  }

  root.querySelectorAll("[data-config]").forEach((btn) => btn.addEventListener("click", () => {
    configKey = btn.dataset.config;
    root.querySelectorAll("[data-config]").forEach((b) => b.setAttribute("aria-pressed", b === btn));
    inputs.dry.value = CONFIGS[configKey].dry_g;
    run();
  }));
  Object.values(inputs).forEach((el) => el.addEventListener("input", run));
  $("#sim-reset").addEventListener("click", () => {
    inputs.water.value = 1.8; inputs.psi.value = 60; inputs.nozzle.value = 21.7; inputs.cd.value = 0.6;
    inputs.dry.value = CONFIGS[configKey].dry_g; run();
  });
  launchBtn.addEventListener("click", launch);
  // Draw the scene at a given flight time (used for still previews and testing).
  window.WaterRocketSim.showAt = (t) => { stopFlight(); playT = t; trail = []; drawFlight(); drawChart(); };
  window.addEventListener("resize", () => { if (!anim) drawAll(); });
  new MutationObserver(() => { if (!anim) drawAll(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  run();
})();
