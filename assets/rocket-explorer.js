/*
 * Interactive 3D explorer for the six-bottle rocket.
 * Geometry: assets/rocket-6-bottle.glb, exported from the SOLIDWORKS assembly
 * Main_Bottle_Fin_Assembly.SLDASM (one mesh per unique part, placed with the assembly transforms).
 * Colours are illustrative. Falls back to the static render when WebGL is unavailable.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const host = document.getElementById("explorer");
const stage = host && host.querySelector(".explorer-stage");
const info = host && host.querySelector("#explorer-info");
const tip = host && host.querySelector(".explorer-tip");

const PET = { kind: "pet" };
const PARTS = [
  { group: "main", match: /^Main_Bottle_2L/, title: "Main bottle · 2 L", text: "Holds the water. Compressed air pushes the water out of the nozzle to make thrust.", color: 0x9fd8f0, ...PET, opacity: 0.6 },
  { group: "air", match: /^Auxiliary_Bottle_1L-(5|7|8)$/, title: "Side air bottle · 1 L", text: "One of three bottles spaced 120° around the main bottle. Stores extra compressed air.", color: 0x2fbf68, ...PET, opacity: 0.7 },
  { group: "air", match: /^Auxiliary_Bottle_1L-1$/, title: "Stacked air bottle · 1 L", text: "Sits on top of the main bottle through a coupling. The bent tubes from the side bottles join here.", color: 0x2fbf68, ...PET, opacity: 0.7 },
  { group: "air", match: /^Auxiliary_Bottle_1L-6$/, title: "Top bottle · 1 L", text: "The top of the stack, carrying the three small fins.", color: 0xdfe9ee, ...PET, opacity: 0.6 },
  { group: "joints", match: /^Upper_Bottle_Blue_Cap/, title: "Bottle cap", text: "Caps close the bottle necks; the side caps have a 7 mm air port.", color: 0x2f5fd0 },
  { group: "joints", match: /^Upper_Bottle_Coupling/, title: "Coupling", text: "Joins two stacked bottles neck to neck (Ø36 mm). The first six-bottle launch failed because of an air leak here.", color: 0xf2c230 },
  { group: "tubes", match: /^Bent exterior tube/, title: "Bent air tube · Ø6 mm", text: "Carries air from a side bottle up to the stacked bottles.", color: 0x9a6a3a },
  { group: "bands", match: /^Triangle wrap-1$/, title: "Wrap band", text: "Triangular band that holds the three side bottles against the main bottle.", color: 0xc0783c, metal: true },
  { group: "bands", match: /^Triangle wrap-2$/, title: "Tie wire", text: "Fine triangular tie lower down on the base bottles.", color: 0xc0783c, metal: true },
  { group: "fins", match: /^Fin_Large/, title: "Large fin · 145 × 80 × 3 mm", text: "One on the outside of each base bottle, wide end at the bottom.", color: 0xff7a2f },
  { group: "fins", match: /^Fin_Small/, title: "Small fin · 100 × 60 × 3 mm", text: "Three around the top bottle, lined up with the large fins.", color: 0xff7a2f },
];
const GROUPS = {
  main: "Main bottle", air: "Air bottles", fins: "Fins", tubes: "Air tubes", bands: "Wrap bands", joints: "Caps & couplings",
};

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch (e) { return false; }
}

function makeMaterial(part) {
  if (part.kind === "pet") {
    return new THREE.MeshPhysicalMaterial({
      color: part.color, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08,
      transparent: true, opacity: part.opacity, side: THREE.DoubleSide, depthWrite: false,
    });
  }
  return new THREE.MeshStandardMaterial({
    color: part.color, roughness: part.metal ? 0.35 : 0.55, metalness: part.metal ? 0.6 : 0.05, side: THREE.DoubleSide,
  });
}

function start() {
  if (!webglOk()) { host.classList.add("no-webgl"); return; }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(0.8, 2.2, 1.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6, near: 0.5, far: 5 });
  sun.shadow.radius = 6;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(0.9, 64), new THREE.ShadowMaterial({ opacity: 0.28 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  ground.receiveShadow = true;
  scene.add(ground);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.425, 96), new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.4, 0);
  camera.position.set(1.08, 0.82, 1.3);
  controls.minDistance = 0.4;
  controls.maxDistance = 4;
  controls.maxPolarAngle = Math.PI * 0.52;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotate = !reduce;
  controls.autoRotateSpeed = 1.2;

  const pickables = [];
  let exploded = 0, explodeTarget = 0, selected = [], hovered = null, needsRender = true;

  new GLTFLoader().load(new URL("rocket-6-bottle.glb", import.meta.url).href, (gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    model.traverse((node) => {
      if (!node.isMesh) return;
      const part = PARTS.find((p) => p.match.test(node.name)) || { group: "joints", title: node.name, text: "", color: 0xcccccc };
      node.material = makeMaterial(part);
      node.castShadow = part.kind !== "pet" || true;
      node.userData.part = part;
      const box = new THREE.Box3().setFromObject(node);
      const c = box.getCenter(new THREE.Vector3());
      const radial = new THREE.Vector3(c.x, 0, c.z);
      const out = radial.length() > 0.02 ? radial.normalize().multiplyScalar(/^Fin/.test(node.name) ? 0.22 : 0.12) : new THREE.Vector3();
      node.userData.home = node.position.clone();
      node.userData.explode = new THREE.Vector3(out.x, (c.y - 0.15) * 0.3, out.z);
      pickables.push(node);
    });
    scene.add(model);
    host.classList.add("ready");
    needsRender = true;
  }, undefined, () => host.classList.add("no-webgl"));

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    needsRender = true;
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  controls.addEventListener("change", () => { needsRender = true; });
  controls.addEventListener("start", () => setAuto(false));

  const autoBtn = host.querySelector("#explorer-auto");
  function setAuto(on) {
    controls.autoRotate = on && !reduce;
    if (autoBtn) autoBtn.setAttribute("aria-pressed", controls.autoRotate);
  }
  if (autoBtn) {
    autoBtn.setAttribute("aria-pressed", controls.autoRotate);
    autoBtn.addEventListener("click", () => setAuto(!controls.autoRotate));
  }

  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  function pick(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? hit.object : null;
  }

  function paint() {
    pickables.forEach((m) => {
      const on = selected.includes(m), hov = m === hovered;
      m.material.emissive.setHex(on ? 0x7a3a10 : hov ? 0x2a2a2a : 0x000000);
    });
    needsRender = true;
  }

  function showInfo(title, body) {
    info.innerHTML = "<b></b><span></span>";
    info.querySelector("b").textContent = title;
    info.querySelector("span").textContent = body;
  }

  function select(meshes, title, body) {
    selected = meshes;
    if (meshes.length) showInfo(title, body);
    else info.innerHTML = "<span>Tap or click a part, or a chip below, to see what it is.</span>";
    host.querySelectorAll("[data-group]").forEach((chip) => chip.setAttribute("aria-pressed", "false"));
    paint();
  }

  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const m = pick(e);
    if (m) select([m], m.userData.part.title, m.userData.part.text);
    else select([]);
  });
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const m = pick(e);
    if (m !== hovered) { hovered = m; paint(); }
    if (m && tip) {
      const rect = stage.getBoundingClientRect();
      tip.textContent = m.userData.part.title;
      tip.style.left = (e.clientX - rect.left + 14) + "px";
      tip.style.top = (e.clientY - rect.top + 14) + "px";
      tip.hidden = false;
      renderer.domElement.style.cursor = "pointer";
    } else if (tip) {
      tip.hidden = true;
      renderer.domElement.style.cursor = "";
    }
  });
  renderer.domElement.addEventListener("pointerleave", () => { hovered = null; if (tip) tip.hidden = true; paint(); });

  host.querySelectorAll("[data-group]").forEach((chip) => chip.addEventListener("click", () => {
    const g = chip.dataset.group;
    const meshes = pickables.filter((m) => m.userData.part.group === g);
    const wasOn = chip.getAttribute("aria-pressed") === "true";
    if (wasOn) { select([]); return; }
    const first = meshes[0] && meshes[0].userData.part;
    select(meshes, GROUPS[g] + " · " + meshes.length + (meshes.length === 1 ? " part" : " parts"), first ? first.text : "");
    chip.setAttribute("aria-pressed", "true");
  }));

  host.querySelectorAll("[data-explode]").forEach((btn) => btn.addEventListener("click", () => {
    explodeTarget = +btn.dataset.explode;
    host.querySelectorAll("[data-explode]").forEach((b) => b.setAttribute("aria-pressed", b === btn));
  }));
  host.querySelector("#explorer-reset").addEventListener("click", () => {
    camera.position.set(1.08, 0.82, 1.3);
    controls.target.set(0, 0.4 + exploded * 0.1 * 1, 0);
    controls.update();
    select([]);
    setAuto(true);
  });

  let visible = true;
  new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }).observe(stage);

  (function loop() {
    requestAnimationFrame(loop);
    if (!visible) return;
    controls.update();
    if (controls.autoRotate) needsRender = true;
    if (Math.abs(exploded - explodeTarget) > 0.001) {
      const before = exploded;
      exploded = reduce ? explodeTarget : exploded + (explodeTarget - exploded) * 0.12;
      pickables.forEach((m) => m.position.copy(m.userData.home).addScaledVector(m.userData.explode, exploded));
      const lift = (exploded - before) * 0.1;      // keep the taller exploded stack in frame
      controls.target.y += lift;
      camera.position.y += lift;
      needsRender = true;
    }
    if (needsRender) { renderer.render(scene, camera); needsRender = false; }
  })();
}

if (host) {
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) { io.disconnect(); start(); }
  }, { rootMargin: "200px" });
  io.observe(host);
}
