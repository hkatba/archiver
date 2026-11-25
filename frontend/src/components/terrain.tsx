"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/*
  A live contour map: iso-lines of a slowly drifting noise field, every fifth line heavier, the way
  survey maps draw index contours. The cursor raises a small hill (lines bend round it) and carries a
  lamp that warms the nearest lines towards lichen. WebGL2, one context, no dependencies.
  Rests as a still frame under prefers-reduced-motion; renders nothing if WebGL2 is unavailable
  (the paper ground shows instead). Pauses offscreen and in background tabs.
*/

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uDpr;
uniform float uTime;
uniform vec2 uMouse;
uniform float uMouseAmt;
uniform vec3 uInk;
uniform vec3 uLamp;
uniform float uAlpha;
uniform float uDensity;
out vec4 outColor;

vec2 g(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(g(i), f), dot(g(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
             mix(dot(g(i + vec2(0, 1)), f - vec2(0, 1)), dot(g(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = r * p * 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec2 css = gl_FragCoord.xy / uDpr;
  vec2 p = css / 560.0;
  float t = uTime * 0.018;
  float h = fbm(p + vec2(t, -0.6 * t));
  h += 0.35 * fbm(p * 1.7 + vec2(h * 1.4) - vec2(0.4 * t, t));

  vec2 d = css - uMouse / uDpr;
  float r2 = dot(d, d);
  h += 0.22 * uMouseAmt * exp(-r2 / 26000.0);

  float v = h * uDensity;
  float f = fract(v);
  float e = min(f, 1.0 - f);
  float w = fwidth(v);
  float minor = 1.0 - smoothstep(0.0, w * 1.1, e);
  float major = 1.0 - smoothstep(w * 0.8, w * 2.1, e);
  float isMajor = step(mod(floor(v + 0.5), 5.0), 0.5);
  float line = mix(minor * 0.55, major, isMajor);

  float lamp = uMouseAmt * exp(-r2 / 70000.0);
  vec3 col = mix(uInk, uLamp, clamp(lamp * 1.15, 0.0, 1.0));
  float a = line * uAlpha * (0.7 + 1.1 * lamp);
  outColor = vec4(col * a, a);
}`;

function cssColor(name: string): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  probe.remove();
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

export function Terrain({ className, strength = 1, density = 16 }: { className?: string; strength?: number; density?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    // A fresh canvas per mount: a released context can never be reused (React re-runs effects in dev)
    const canvas = document.createElement("canvas");
    canvas.className = "block size-full";
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" });
    if (!gl) return;
    host.appendChild(canvas);

    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    } catch {
      canvas.remove();
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u("uRes"), uDpr = u("uDpr"), uTime = u("uTime"), uMouse = u("uMouse"), uMouseAmt = u("uMouseAmt");
    const uInk = u("uInk"), uLamp = u("uLamp"), uAlpha = u("uAlpha"), uDensity = u("uDensity");

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = matchMedia("(pointer: fine)").matches;
    const dpr = fine ? Math.min(devicePixelRatio || 1, 1.5) : 1;

    function setColors() {
      const dark = document.documentElement.classList.contains("dark");
      gl!.uniform3fv(uInk, cssColor("--foreground"));
      gl!.uniform3fv(uLamp, cssColor("--lichen"));
      gl!.uniform1f(uAlpha, (dark ? 0.2 : 0.24) * strength);
    }
    setColors();
    gl.uniform1f(uDensity, density);
    gl.uniform1f(uDpr, dpr);

    function resize() {
      const w = Math.max(1, Math.round(canvas!.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas!.clientHeight * dpr));
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
        gl!.viewport(0, 0, w, h);
        gl!.uniform2f(uRes, w, h);
      }
    }

    // Spring-smoothed pointer (device px, GL y-up); presence eases in and out
    const target = { x: 0, y: 0, in: 0 };
    const pos = { x: 0, y: 0, vx: 0, vy: 0, amt: 0 };
    let lastMove = -1e9;
    let first = true;
    function onMove(e: PointerEvent) {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      const r = canvas!.getBoundingClientRect();
      target.x = (e.clientX - r.left) * dpr;
      target.y = (r.height - (e.clientY - r.top)) * dpr;
      const m = 120;
      target.in = e.clientX > r.left - m && e.clientX < r.right + m && e.clientY > r.top - m && e.clientY < r.bottom + m ? 1 : 0;
      if (first) { pos.x = target.x; pos.y = target.y; first = false; }
      lastMove = performance.now();
    }
    function onLeave() { target.in = 0; }

    const start = performance.now() - Math.random() * 60_000;
    let visible = true;
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) kick(); });
    io.observe(canvas);
    const ro = new ResizeObserver(() => { resize(); if (reduced) draw(start); });
    ro.observe(canvas);
    const mo = new MutationObserver(() => { setColors(); if (reduced) draw(start); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    let raf = 0;
    let lastDraw = 0;

    function draw(now: number) {
      resize();
      gl!.uniform1f(uTime, (now - start) / 1000);
      gl!.uniform2f(uMouse, pos.x, pos.y);
      gl!.uniform1f(uMouseAmt, pos.amt);
      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }

    function frame(now: number) {
      raf = 0;
      if (!visible || document.hidden) return;
      // Critically damped-ish spring towards the pointer
      const k = 0.075, damp = 0.78;
      pos.vx = (pos.vx + (target.x - pos.x) * k) * damp;
      pos.vy = (pos.vy + (target.y - pos.y) * k) * damp;
      pos.x += pos.vx;
      pos.y += pos.vy;
      pos.amt += (target.in - pos.amt) * 0.06;
      const busy = now - lastMove < 1800 || Math.abs(pos.vx) + Math.abs(pos.vy) > 0.05 || Math.abs(target.in - pos.amt) > 0.01;
      // Idle drift needs little: ~24 fps; the cursor gets the full frame rate
      if (busy || now - lastDraw > 41) {
        draw(now);
        lastDraw = now;
      }
      raf = requestAnimationFrame(frame);
    }
    function kick() { if (!reduced && !raf) raf = requestAnimationFrame(frame); }
    function onVisibility() { if (!document.hidden) kick(); }

    if (reduced) {
      draw(start);
    } else {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", onVisibility);
      kick();
    }

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [strength, density]);

  return <div ref={ref} aria-hidden="true" className={cn("pointer-events-none size-full", className)} />;
}
