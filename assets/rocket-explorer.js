/*
 * Interactive 3D explorer for the six-bottle rocket.
 * Geometry: assets/rocket-6-bottle.glb, exported from the SOLIDWORKS assembly
 * Main_Bottle_Fin_Assembly.SLDASM (one mesh per unique part, placed with the assembly transforms).
 * Colours are illustrative. Falls back to the static render when WebGL is unavailable.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const host = document.getElementById("explorer");
const stage = host && host.querySelector(".explorer-stage");
const info = host && host.querySelector("#explorer-info");

const PARTS = [
  { match: /^Main_Bottle_2L/, title: "Main bottle · 2 L", text: "Holds the water. Compressed air pushes the water out of the nozzle to make thrust.", color: 0x9fd8f0, opacity: 0.55 },
  { match: /^Auxiliary_Bottle_1L-(5|7|8)$/, title: "Side air bottle · 1 L", text: "One of three bottles spaced 120° around the main bottle. Stores extra compressed air.", color: 0x38c172, opacity: 0.6 },
  { match: /^Auxiliary_Bottle_1L-1$/, title: "Stacked air bottle · 1 L", text: "Sits on top of the main bottle through a coupling. The bent tubes from the side bottles join here.", color: 0x38c172, opacity: 0.6 },
  { match: /^Auxiliary_Bottle_1L-6$/, title: "Top bottle · 1 L", text: "The top of the stack, carrying the three small fins.", color: 0xd8e6ec, opacity: 0.55 },
  { match: /^Upper_Bottle_Blue_Cap/, title: "Bottle cap", text: "Caps close the bottle necks; the side caps have a 7 mm air port.", color: 0x2f5fd0, opacity: 1 },
  { match: /^Upper_Bottle_Coupling/, title: "Coupling", text: "Joins two stacked bottles neck to neck (Ø36 mm).", color: 0xf2c230, opacity: 1 },
  { match: /^Bent exterior tube/, title: "Bent air tube · Ø6 mm", text: "Carries air from a side bottle up to the stacked bottles.", color: 0x9a6a3a, opacity: 1 },
  { match: /^Triangle wrap-1$/, title: "Wrap band", text: "Triangular band that holds the three side bottles against the main bottle.", color: 0xb8733a, opacity: 1 },
  { match: /^Triangle wrap-2$/, title: "Tie wire", text: "Fine triangular tie lower down on the base bottles.", color: 0xb8733a, opacity: 1 },
  { match: /^Fin_Large/, title: "Large fin · 145 × 80 × 3 mm", text: "One on the outside of each base bottle, wide end at the bottom.", color: 0xff7a2f, opacity: 1 },
  { match: /^Fin_Small/, title: "Small fin · 100 × 60 × 3 mm", text: "Three around the top bottle, lined up with the large fins.", color: 0xff7a2f, opacity: 1 },
];

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
  } catch (e) { return false; }
}

function start() {
  if (!webglOk()) { host.classList.add("no-webgl"); return; }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(1.2, 2, 1.5);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  fill.position.set(-1.5, 0.5, -1);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0.4, 0);
  camera.position.set(0.95, 0.75, 1.15);
  controls.minDistance = 0.4;
  controls.maxDistance = 4;

  const pickables = [];
  let exploded = 0, explodeTarget = 0, selected = null, needsRender = true;

  new GLTFLoader().load(new URL("rocket-6-bottle.glb", import.meta.url).href, (gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    model.traverse((node) => {
      if (!node.isMesh) return;
      const part = PARTS.find((p) => p.match.test(node.name)) || { title: node.name, text: "", color: 0xcccccc, opacity: 1 };
      node.material = new THREE.MeshStandardMaterial({
        color: part.color, roughness: 0.45, metalness: 0.05,
        transparent: part.opacity < 1, opacity: part.opacity, side: THREE.DoubleSide, depthWrite: part.opacity === 1,
      });
      node.userData.part = part;
      const box = new THREE.Box3().setFromObject(node);
      const c = box.getCenter(new THREE.Vector3());
      const radial = new THREE.Vector3(c.x, 0, c.z);
      const r = radial.length();
      const out = r > 0.02 ? radial.normalize().multiplyScalar(/^Fin/.test(node.name) ? 0.22 : 0.12) : new THREE.Vector3();
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

  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    select(hit ? hit.object : null);
  });

  function select(mesh) {
    if (selected) selected.material.emissive.setHex(0x000000);
    selected = mesh;
    if (mesh) {
      mesh.material.emissive.setHex(0x553300);
      const p = mesh.userData.part;
      info.innerHTML = "<b></b><span></span>";
      info.querySelector("b").textContent = p.title;
      info.querySelector("span").textContent = p.text;
    } else {
      info.innerHTML = "<span>Tap or click a part to see what it is.</span>";
    }
    needsRender = true;
  }

  host.querySelectorAll("[data-explode]").forEach((btn) => btn.addEventListener("click", () => {
    explodeTarget = +btn.dataset.explode;
    host.querySelectorAll("[data-explode]").forEach((b) => b.setAttribute("aria-pressed", b === btn));
  }));
  host.querySelector("#explorer-reset").addEventListener("click", () => {
    camera.position.set(0.95, 0.75, 1.15);
    controls.target.set(0, 0.4, 0);
    controls.update();
    select(null);
  });

  let visible = true;
  new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }).observe(stage);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  (function loop() {
    requestAnimationFrame(loop);
    if (!visible) return;
    controls.update();
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
