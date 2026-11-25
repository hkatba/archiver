"use client";

import { useEffect, useRef } from "react";
import type * as T from "three";
import { cn } from "@/lib/utils";

export interface CairnStone { name: string; count: number; color: string; href: string }
export interface CairnApi {
  /** 0 = stacked, 1 = lifted apart (driven by scroll) */
  setExplode(v: number): void;
  /** Highlight one stone (index in base-first order), or none */
  setActive(i: number | null): void;
}

// The cairn plays its drop-in once per visit, not on every data refresh
let dropped = false;

/** Deterministic lumpy-sphere noise: three random sine waves, enough to make each pebble its own. */
function lumps(seed: number) {
  const r = (n: number) => { const x = Math.sin(seed * 999 + n * 77.7) * 43758.5453; return x - Math.floor(x); };
  const w = Array.from({ length: 3 }, (_, i) => ({ a: 1 + r(i) * 2.2, b: 1 + r(i + 3) * 2.2, c: 1 + r(i + 6) * 2.2, p: r(i + 9) * 6.28, k: 0.5 / (i + 1) }));
  return (x: number, y: number, z: number) => w.reduce((s, o) => s + o.k * Math.sin(o.a * x + o.p) * Math.sin(o.b * y + o.p * 0.7) * Math.sin(o.c * z + o.p * 1.3), 0);
}

/**
 * Three.js cairn: one pebble per category, sized by its share, largest at the base.
 * Loads three on demand, drops the stones in on a spring, leans towards the cursor, lifts apart on
 * scroll (through the returned API), and links each stone to its category. Calls onFail when WebGL
 * is unavailable so the page can show its CSS chart instead.
 */
export function Cairn3D({ stones, apiRef, onSelect, onFail, className }: {
  stones: CairnStone[];
  apiRef: React.RefObject<CairnApi | null>;
  onSelect: (i: number) => void;
  onFail: () => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  const fail = useRef(onFail);
  useEffect(() => { select.current = onSelect; fail.current = onFail; });
  const signature = stones.map((s) => `${s.name}:${s.count}`).join("|");

  useEffect(() => {
    const el = host.current;
    if (!el || !stones.length) return;
    let cleanup = () => {};
    let disposed = false;

    (async () => {
      const THREE = await import("three");
      if (disposed) return;
      let renderer: T.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      } catch {
        fail.current();
        return;
      }
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.domElement.className = "block size-full";
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      scene.add(new THREE.HemisphereLight(0xfff8ec, 0x2a2720, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(4, 9, 7);
      const rim = new THREE.DirectionalLight(0xdbe7a6, 1.1); // lichen-tinted rim from behind
      rim.position.set(-6, 4, -6);
      scene.add(key, rim);

      // Pebbles, base first
      const max = Math.max(...stones.map((s) => s.count));
      const group = new THREE.Group();
      scene.add(group);
      const disposables: { dispose(): void }[] = [];
      let top = 0;
      const items = stones.map((s, i) => {
        const r = 0.55 + 1.35 * Math.sqrt(s.count / max);
        const geo = new THREE.SphereGeometry(1, 72, 44);
        const n = lumps(i + s.name.length * 0.37);
        const pos = geo.attributes.position as T.BufferAttribute;
        const colors = new Float32Array(pos.count * 3);
        const base = new THREE.Color(s.color);
        for (let v = 0; v < pos.count; v++) {
          let x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
          const d = 1 + 0.16 * n(x * 1.6, y * 1.6, z * 1.6);
          x *= d; y *= d; z *= d;
          if (y < 0) y *= 0.7; // rests on a flatter underside
          pos.setXYZ(v, x * r, y * r * 0.42, z * r * 0.86);
          const speck = 0.86 + 0.14 * (0.5 + 0.5 * n(x * 9, y * 9, z * 9)); // weathered mottling
          colors.set([base.r * speck, base.g * speck, base.b * speck], v * 3);
        }
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, emissive: 0x000000 });
        const mesh = new THREE.Mesh(geo, mat);
        const half = r * 0.42;
        const restY = top + half * 0.78;
        top = restY + half * 0.8;
        mesh.rotation.set((i % 2 ? 1 : -1) * 0.05, i * 1.7, (i % 3 - 1) * 0.04);
        mesh.position.set((i % 2 ? 1 : -1) * 0.08 * r, restY, 0);
        mesh.userData.index = i;
        group.add(mesh);
        disposables.push(geo, mat);
        return {
          mesh, mat, restY, r,
          y: reduced || dropped ? restY : restY + 7 + i * 0.9,
          vy: 0, delay: i * 0.14, lift: 0, glow: 0, dim: 0,
        };
      });
      const height = top;
      const widest = Math.max(...items.map((it) => it.r));

      // Soft contact shadow
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(10,10,8,0.5)");
      grad.addColorStop(1, "rgba(10,10,8,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      const shadowTex = new THREE.CanvasTexture(c);
      const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
      const shadowGeo = new THREE.PlaneGeometry(widest * 3.4, widest * 2.4);
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = -0.02;
      group.add(shadow);
      disposables.push(shadowTex, shadowMat, shadowGeo);

      const center = height * 0.5;
      group.position.y = -center;

      const spread = (stones.length - 1) * 0.62; // how far the top stone rises when fully lifted
      // The camera pulls back and re-centres as the stones lift, so the whole column stays in frame
      function place(e: number) {
        const half = Math.tan((camera.fov * Math.PI) / 360);
        const dist = Math.max((height + e * spread + 1.6) / (2 * half), (widest * 2.6) / (2 * half * camera.aspect)) * 1.05;
        const lookY = 0.3 + e * spread * 0.5;
        camera.position.set(0, lookY + dist * 0.2, dist);
        camera.lookAt(0, lookY, 0);
      }
      function fit() {
        const w = el!.clientWidth, h = el!.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        place(0);
      }
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);

      // State driven from outside (scroll) and from the pointer
      let explode = 0, explodeTarget = 0, active: number | null = null, hovered: number | null = null;
      const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
      apiRef.current = {
        setExplode: (v) => { explodeTarget = reduced ? 0 : v; },
        setActive: (i) => { active = i; },
      };

      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      function pick(e: PointerEvent) {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObjects(items.map((it) => it.mesh))[0];
        return hit ? (hit.object.userData.index as number) : null;
      }
      function onMove(e: PointerEvent) {
        const r = el!.getBoundingClientRect();
        tilt.tx = ((e.clientY - r.top) / r.height - 0.5) * 0.22;
        tilt.ty = ((e.clientX - r.left) / r.width - 0.5) * 0.5;
        hovered = e.pointerType === "mouse" ? pick(e) : null;
        renderer.domElement.style.cursor = hovered === null ? "" : "pointer";
      }
      function onLeave() { tilt.tx = tilt.ty = 0; hovered = null; renderer.domElement.style.cursor = ""; }
      function onClick(e: PointerEvent) { const i = pick(e); if (i !== null) select.current(i); }
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerleave", onLeave);
      renderer.domElement.addEventListener("click", onClick as EventListener);

      const timer = new THREE.Timer();
      timer.connect(document);
      let spin = 0;
      const lichen = new THREE.Color(0xc4d36c);
      function frame() {
        timer.update();
        const dt = Math.min(timer.getDelta(), 0.25); // real time, so a throttled tab still settles
        const t = timer.getElapsed();
        explode = THREE.MathUtils.damp(explode, explodeTarget, 6, dt);
        tilt.x = THREE.MathUtils.damp(tilt.x, reduced ? 0 : tilt.tx, 4, dt);
        tilt.y = THREE.MathUtils.damp(tilt.y, reduced ? 0 : tilt.ty, 4, dt);
        if (!reduced) spin += dt * 0.12;
        group.rotation.set(tilt.x, spin + tilt.y + explode * 1.1, 0);

        items.forEach((it, i) => {
          // Drop in on a damped spring, bottom stone first
          if (t > it.delay) {
            const target = it.restY + explode * i * 0.62 + it.lift;
            // Fixed 1/120 s substeps keep the spring stable at any frame rate
            for (let left = dt; left > 0; left -= 1 / 120) {
              const h = Math.min(left, 1 / 120);
              it.vy += (target - it.y) * 70 * h - it.vy * 11 * h;
              it.y += it.vy * h;
              // Land on the stone below instead of sinking into it: a short, damped bounce
              if (it.y < target - 0.06 && it.vy < 0) { it.y = target - 0.06; it.vy = -it.vy * 0.28; }
            }
          }
          const focus = i === hovered || i === active;
          it.lift = THREE.MathUtils.damp(it.lift, i === hovered ? 0.16 : 0, 10, dt);
          it.glow = THREE.MathUtils.damp(it.glow, focus ? 1 : 0, 8, dt);
          it.dim = THREE.MathUtils.damp(it.dim, active !== null && !focus ? 1 : 0, 6, dt);
          it.mesh.position.y = it.y;
          it.mesh.position.x = (i % 2 ? 1 : -1) * (0.08 * it.r + explode * 0.35);
          it.mesh.scale.setScalar(1 + it.glow * 0.06);
          it.mat.emissive.copy(lichen).multiplyScalar(it.glow * 0.18);
          it.mat.color.setScalar(1 - it.dim * 0.55);
        });
        shadow.scale.setScalar(1 - explode * 0.25);
        place(explode);
        renderer.render(scene, camera);
      }

      // Render only while on screen and in a visible tab; re-check whenever either changes
      let running = false, inView = false;
      const sync = () => {
        const on = inView && !document.hidden;
        if (on !== running) { renderer.setAnimationLoop(on ? frame : null); running = on; }
      };
      const io = new IntersectionObserver(([en]) => { inView = en.isIntersecting; sync(); });
      io.observe(el);
      document.addEventListener("visibilitychange", sync);
      dropped = true;

      cleanup = () => {
        renderer.setAnimationLoop(null);
        io.disconnect();
        ro.disconnect();
        document.removeEventListener("visibilitychange", sync);
        timer.dispose();
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerleave", onLeave);
        renderer.domElement.removeEventListener("click", onClick as EventListener);
        disposables.forEach((d) => d.dispose());
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        apiRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only when the categories or their counts change
  }, [signature]);

  return <div ref={host} aria-hidden="true" className={cn("size-full", className)} />;
}
