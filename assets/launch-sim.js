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

  function circle(d_mm) { return Math.PI / 4 * Math.pow(d_mm / 1000, 2); }

  const CONFIGS = {
    six: {
      label: "Six-bottle (upgrade)",
      volume_l: 7.0,                       // 1 x 2 L main + 5 x 1 L air bottles
      dry_g: 405,                          // SOLIDWORKS mass estimate
      area_m2: circle(105) + 3 * circle(78.5) + 6 * 0.003 * 0.07,
    },
    four: {
      label: "Original four-bottle",
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
      if (step++ % (dt < 1e-3 ? 25 : 5) === 0) log.push([t, h, v, thrust]);
      if (phase === "coast" && v < 0) break;
      if (phase === "coast" && dt < 1e-3) dt = 1e-3;
    }
    log.push([t, h, v, 0]);
    return {
      apogee: maxH, maxV, tApogee, burn, waterT, maxThrust,
      launchMass: (mDry + vW0 * RHO_W + mAir0) * 1000, log,
    };
  }
  window.WaterRocketSim = { simulate, CONFIGS };

  // ---------- UI ----------
  const root = document.getElementById("launch-sim");
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);
  const inputs = {
    water: $("#sim-water"), psi: $("#sim-psi"), dry: $("#sim-dry"), nozzle: $("#sim-nozzle"), cd: $("#sim-cd"),
  };
  const outs = {
    water: $("#sim-water-val"), psi: $("#sim-psi-val"), dry: $("#sim-dry-val"), nozzle: $("#sim-nozzle-val"), cd: $("#sim-cd-val"),
    apogee: $("#sim-apogee"), apogeeFt: $("#sim-apogee-ft"), speed: $("#sim-speed"), burn: $("#sim-burn"),
    tApogee: $("#sim-tapogee"), mass: $("#sim-mass"), thrust: $("#sim-thrust"), compare: $("#sim-compare"),
  };
  const chart = $("#sim-chart"), flight = $("#sim-flight"), launchBtn = $("#sim-launch");
  let configKey = "six", current = null, other = null, anim = null;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function params() {
    return {
      water_l: +inputs.water.value, psi: +inputs.psi.value, dry_g: +inputs.dry.value,
      nozzle_mm: +inputs.nozzle.value, cd: +inputs.cd.value,
    };
  }

  function run() {
    const p = params();
    outs.water.textContent = p.water_l.toFixed(2) + " L";
    outs.psi.textContent = p.psi + " psi (" + (p.psi * 0.0689476).toFixed(1) + " bar)";
    outs.dry.textContent = p.dry_g + " g";
    outs.nozzle.textContent = p.nozzle_mm.toFixed(1) + " mm";
    outs.cd.textContent = p.cd.toFixed(2);
    current = simulate(CONFIGS[configKey], p);
    const otherKey = configKey === "six" ? "four" : "six";
    other = simulate(CONFIGS[otherKey], Object.assign({}, p, { dry_g: CONFIGS[otherKey].dry_g }));
    outs.apogee.textContent = current.apogee.toFixed(1) + " m";
    outs.apogeeFt.textContent = (current.apogee * 3.281).toFixed(0) + " ft";
    outs.speed.textContent = current.maxV.toFixed(1) + " m/s (" + (current.maxV * 3.6).toFixed(0) + " km/h)";
    outs.burn.textContent = current.burn.toFixed(2) + " s";
    outs.tApogee.textContent = current.tApogee.toFixed(2) + " s";
    outs.mass.textContent = (current.launchMass / 1000).toFixed(2) + " kg";
    outs.thrust.textContent = current.maxThrust.toFixed(0) + " N";
    const diff = (current.apogee - other.apogee) / other.apogee * 100;
    outs.compare.textContent = "Same water and pressure in the " + CONFIGS[otherKey].label.toLowerCase() + ": " +
      other.apogee.toFixed(1) + " m (" + (diff >= 0 ? "this one is " + diff.toFixed(0) + "% higher" : "this one is " + Math.abs(diff).toFixed(0) + "% lower") + ").";
    drawChart();
    drawFlight(null);
  }

  function drawChart() {
    const dpr = window.devicePixelRatio || 1;
    const w = chart.clientWidth, h = chart.clientHeight;
    chart.width = w * dpr; chart.height = h * dpr;
    const ctx = chart.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 44, r: 12, t: 14, b: 30 };
    const tMax = Math.max(current.tApogee, other.tApogee) * 1.05;
    const hMax = Math.max(current.apogee, other.apogee) * 1.12;
    const X = (t) => pad.l + t / tMax * (w - pad.l - pad.r);
    const Y = (y) => h - pad.b - y / hMax * (h - pad.t - pad.b);
    ctx.strokeStyle = css("--line"); ctx.fillStyle = css("--muted"); ctx.lineWidth = 1;
    ctx.font = "11px JetBrains Mono, monospace";
    const hStep = hMax > 60 ? 20 : 10;
    for (let y = 0; y <= hMax; y += hStep) {
      ctx.beginPath(); ctx.moveTo(pad.l, Y(y)); ctx.lineTo(w - pad.r, Y(y)); ctx.stroke();
      ctx.fillText(y + " m", 4, Y(y) + 4);
    }
    const tStep = tMax > 4 ? 1 : 0.5;
    for (let t = 0; t <= tMax; t += tStep) ctx.fillText(t.toFixed(tStep < 1 ? 1 : 0) + " s", X(t) - 8, h - 10);
    // thrust window
    ctx.fillStyle = css("--water"); ctx.globalAlpha = 0.15;
    ctx.fillRect(X(0), pad.t, X(current.burn) - X(0), h - pad.t - pad.b);
    ctx.globalAlpha = 1;
    function line(log, color, dash) {
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.setLineDash(dash);
      ctx.beginPath();
      log.forEach((r, i) => { if (r[1] >= 0) (i ? ctx.lineTo(X(r[0]), Y(r[1])) : ctx.moveTo(X(r[0]), Y(r[1]))); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    line(other.log, css("--muted"), [5, 5]);
    line(current.log, css("--tube"), []);
    ctx.fillStyle = css("--text");
    ctx.fillText("peak " + current.apogee.toFixed(1) + " m", X(current.tApogee) - 90, Y(current.apogee) - 6);
  }

  function drawFlight(state) {
    const dpr = window.devicePixelRatio || 1;
    const w = flight.clientWidth, h = flight.clientHeight;
    flight.width = w * dpr; flight.height = h * dpr;
    const ctx = flight.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const top = 24, ground = h - 26;
    const scaleMax = Math.max(current.apogee, 10) * 1.1;
    const Y = (y) => ground - y / scaleMax * (ground - top);
    ctx.strokeStyle = css("--line"); ctx.fillStyle = css("--muted"); ctx.font = "11px JetBrains Mono, monospace";
    ctx.beginPath(); ctx.moveTo(0, ground); ctx.lineTo(w, ground); ctx.stroke();
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(8, Y(current.apogee)); ctx.lineTo(w - 8, Y(current.apogee)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(current.apogee.toFixed(0) + " m", 6, Y(current.apogee) - 5);
    const hNow = state ? state[1] : 0;
    const x = w / 2, y = Y(Math.max(hNow, 0));
    // rocket body
    ctx.fillStyle = css("--accent");
    ctx.fillRect(x - 5, y - 30, 10, 26);
    ctx.fillRect(x - 13, y - 14, 6, 12); ctx.fillRect(x + 7, y - 14, 6, 12);
    ctx.fillStyle = css("--tube");
    ctx.beginPath(); ctx.moveTo(x - 13, y - 2); ctx.lineTo(x - 19, y + 2); ctx.lineTo(x - 13, y - 10); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 13, y - 2); ctx.lineTo(x + 19, y + 2); ctx.lineTo(x + 13, y - 10); ctx.fill();
    if (state && state[3] > 0) {
      ctx.fillStyle = css("--water"); ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(x + 9, y + 34); ctx.lineTo(x - 9, y + 34); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = css("--text");
    ctx.fillText((state ? state[0].toFixed(2) : "0.00") + " s  " + Math.max(hNow, 0).toFixed(1) + " m", 6, 14);
  }

  function launch() {
    if (anim) cancelAnimationFrame(anim);
    const log = current.log, start = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { drawFlight(log.reduce((a, b) => (b[1] > a[1] ? b : a))); return; }
    function frame(now) {
      const t = (now - start) / 1000;
      let row = log[log.length - 1];
      for (let i = 0; i < log.length; i++) if (log[i][0] >= t) { row = log[i]; break; }
      drawFlight(row);
      if (t < log[log.length - 1][0]) anim = requestAnimationFrame(frame);
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
  window.addEventListener("resize", () => { drawChart(); drawFlight(null); });
  new MutationObserver(() => { drawChart(); drawFlight(null); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  run();
})();
