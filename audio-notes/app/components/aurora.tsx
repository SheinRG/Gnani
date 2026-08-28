"use client";

/**
 * The hero's background: four families of thin sine "sheets" drawn on a
 * canvas, each family a stack of phase-offset lines that reads as a twisting
 * wireframe ribbon. Ported line-for-line from the approved design file
 * (Gnani Audio Notes.dc.html). Colors are the system's accent/sage ramps.
 * The cursor steers drift (x) and amplitude (y), eased so it feels like the
 * ribbons notice the pointer rather than track it.
 */
import { useEffect, useRef } from "react";

interface Family {
  color: string;
  base: number;
  amp: number;
  len: number;
  speed: number;
  phase: number;
  n: number;
  gap: number;
}

const FAMILIES: Family[] = [
  { color: "198,113,57", base: 0.24, amp: 0.15, len: 1.7, speed: 0.00042, phase: 0, n: 9, gap: 0.028 },
  { color: "122,138,94", base: 0.46, amp: 0.19, len: 2.3, speed: 0.0003, phase: 2.1, n: 10, gap: 0.03 },
  { color: "246,160,107", base: 0.66, amp: 0.14, len: 1.3, speed: 0.00052, phase: 4.2, n: 8, gap: 0.024 },
  { color: "174,191,146", base: 0.84, amp: 0.11, len: 2.9, speed: 0.00036, phase: 5.6, n: 7, gap: 0.026 },
];

export function Aurora() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseTarget = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const mouse = { x: 0.5, y: 0.5 };
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      mouseTarget.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    };
    window.addEventListener("pointermove", onMove);

    const yAt = (
      F: Family,
      p: number,
      t: number,
      amp: number,
      drift: number,
      off: number,
    ) =>
      Math.sin(p * Math.PI * 2 * F.len + t * F.speed + F.phase + off + drift) * amp +
      Math.sin(p * Math.PI * 2 * F.len * 0.5 - t * F.speed * 1.7 + F.phase * 1.3 + off * 0.6) *
        amp *
        0.5 +
      Math.sin(p * Math.PI * 2 * F.len * 2.3 + t * F.speed * 0.8 + off) * amp * 0.18;

    const draw = (t: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) {
        cv.width = w * dpr;
        cv.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mouse.x += (mouseTarget.current.x - mouse.x) * 0.035;
      mouse.y += (mouseTarget.current.y - mouse.y) * 0.035;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      for (const F of FAMILIES) {
        const drift = (mouse.x - 0.5) * 2.0;
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, `rgba(${F.color},0)`);
        g.addColorStop(0.18, `rgba(${F.color},1)`);
        g.addColorStop(0.82, `rgba(${F.color},1)`);
        g.addColorStop(1, `rgba(${F.color},0)`);
        ctx.strokeStyle = g;
        for (let i = 0; i < F.n; i++) {
          const z = i / (F.n - 1); // 0 = front, 1 = back
          const amp = h * F.amp * (1 - z * 0.45) * (0.8 + mouse.y * 0.6);
          const off = i * 0.42; // twist between lines
          const base =
            h *
            (F.base +
              (z - 0.5) * F.gap * F.n * (0.72 + 0.28 * Math.sin(t * F.speed * 0.6 + F.phase)));
          ctx.globalAlpha = 0.62 - z * 0.44;
          ctx.lineWidth = 1.8 - z * 1.1;
          ctx.beginPath();
          let px = 0;
          let py = base + yAt(F, 0, t, amp, drift, off);
          ctx.moveTo(px, py);
          for (let x = 10; x <= w + 10; x += 10) {
            const y = base + yAt(F, x / w, t, amp, drift, off);
            ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
            px = x;
            py = y;
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    // Full-bleed breakout: the page content lives in a 960px column, but the
    // ribbons must run edge-to-edge behind the header like the design file.
    // -106px rewinds the header (~62px) plus main's top padding (44px); the
    // bottom fade mask makes the exact figure non-critical.
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute left-1/2 -z-10 w-screen -translate-x-1/2"
      style={{
        top: -106,
        height: "min(72vh, 620px)",
        maskImage: "linear-gradient(to bottom, black 55%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent 100%)",
      }}
    />
  );
}
