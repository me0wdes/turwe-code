import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

// Adapted from the ASCII text lens supplied by the user (Meowdes reference).
const TEXT = "Turwe code";
const CHARS = "#$%&*+=?@0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SANS = '"Inter Variable", "Segoe UI", sans-serif';
const MONO = '"Cascadia Mono", Consolas, monospace';

export function TurweTitle({ motionEnabled }: { motionEnabled: boolean }) {
  const root = useRef<HTMLHeadingElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();
  const animated = motionEnabled && !reducedMotion;

  useEffect(() => {
    const host = root.current,
      surface = canvas.current;
    const ctx = surface?.getContext("2d");
    if (!host || !surface || !ctx) return;
    const pointer = matchMedia("(hover: hover) and (pointer: fine)");
    const mask = document.createElement("canvas");
    const maskContext = mask.getContext("2d", { willReadFrequently: true });
    if (!maskContext) return;
    let width = 0,
      height = 0,
      cellHeight = 0,
      color = getComputedStyle(host).color;
    let cells: { x: number; y: number; character: string }[] = [];
    let x = 0,
      y = 0,
      targetX = 0,
      targetY = 0,
      strength = 0;
    let hovered = false,
      visible = false,
      disposed = false,
      frame = 0,
      lastFrame = 0,
      lastFlicker = 0;
    const pick = () => CHARS[Math.floor(Math.random() * CHARS.length)];
    const canDraw = () => !disposed && visible && !document.hidden && width > 0;
    const cancel = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = 0;
    };
    const kick = () => {
      if (!frame && animated && canDraw()) frame = requestAnimationFrame(draw);
    };

    function draw(now: number) {
      frame = 0;
      if (!canDraw()) return;
      // The decorative canvas has a 30fps budget; it never drives React state.
      if (animated && lastFrame && now - lastFrame < 1000 / 30) {
        kick();
        return;
      }
      const delta = lastFrame ? Math.min(now - lastFrame, 80) / (1000 / 60) : 1;
      lastFrame = now;
      if (!hovered) {
        targetX = width * (0.5 + 0.34 * Math.sin(now * 0.00042));
        targetY = height * (0.5 + 0.16 * Math.sin(now * 0.00071 + 1));
      }
      x += (targetX - x) * (1 - Math.pow(0.86, delta));
      y += (targetY - y) * (1 - Math.pow(0.86, delta));
      strength +=
        ((animated ? (hovered ? 1 : 0.45) : 0) - strength) *
        (1 - Math.pow(0.9, delta));
      if (animated && cells.length && now - lastFlicker > 70) {
        lastFlicker = now;
        for (let count = Math.ceil(cells.length * 0.04); count > 0; count--)
          cells[Math.floor(Math.random() * cells.length)].character = pick();
      }
      ctx!.clearRect(0, 0, width, height);
      ctx!.fillStyle = color;
      ctx!.font = `600 ${Math.round(cellHeight * 0.82)}px ${MONO}`;
      ctx!.textAlign = "center";
      ctx!.textBaseline = "middle";
      const radius = Math.min(width * 0.13, height * 0.45) * strength;
      for (const cell of cells) {
        let px = cell.x,
          py = cell.y;
        const dx = px - x,
          dy = py - y,
          distance = Math.hypot(dx, dy);
        if (radius > 1 && distance > 0 && distance < radius) {
          const push =
            (Math.pow(1 - distance / radius, 2) * radius * 0.7) / distance;
          px += dx * push;
          py += dy * push;
        }
        ctx!.fillText(cell.character, px, py);
      }
      host!.dataset.rendered = cells.length ? "true" : "false";
      kick();
    }
    function build(force = false) {
      if (disposed) return;
      const nextWidth = host!.clientWidth,
        nextHeight = host!.clientHeight;
      if (!nextWidth || !nextHeight) return;
      if (!force && width === nextWidth && height === nextHeight) return;
      width = nextWidth;
      height = nextHeight;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      surface!.width = Math.round(width * dpr);
      surface!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      color = getComputedStyle(host!).color;
      mask.width = width;
      mask.height = height;
      let size = height * 0.85;
      maskContext!.font = `850 ${size}px ${SANS}`;
      size *= Math.min(
        1,
        (width * 0.94) / maskContext!.measureText(TEXT).width,
      );
      maskContext!.font = `850 ${size}px ${SANS}`;
      maskContext!.textAlign = "center";
      maskContext!.textBaseline = "middle";
      maskContext!.fillStyle = "white";
      maskContext!.fillText(TEXT, width / 2, height / 2 + size * 0.04);
      const pixels = maskContext!.getImageData(0, 0, width, height).data;
      const cellWidth = width < 400 ? 3 : 4;
      cellHeight = cellWidth * 1.35;
      cells = [];
      for (let py = cellHeight / 2; py < height; py += cellHeight) {
        for (let px = cellWidth / 2; px < width; px += cellWidth) {
          if (pixels[(Math.floor(py) * width + Math.floor(px)) * 4 + 3] > 110)
            cells.push({ x: px, y: py, character: pick() });
        }
      }
      x = targetX = width / 2;
      y = targetY = height / 2;
      strength = 0;
      host!.dataset.rendered = "false";
      cancel();
      draw(performance.now());
    }
    const move = (event: PointerEvent) => {
      if (!animated || !pointer.matches || event.pointerType === "touch")
        return;
      const bounds = host.getBoundingClientRect();
      targetX = event.clientX - bounds.left;
      targetY = event.clientY - bounds.top;
      if (!hovered) {
        x = targetX;
        y = targetY;
      }
      hovered = true;
      kick();
    };
    const leave = () => {
      hovered = false;
    };
    const visibility = () => {
      cancel();
      if (canDraw()) draw(performance.now());
    };
    const resize = new ResizeObserver(() => build());
    const theme = new MutationObserver(() => {
      color = getComputedStyle(host).color;
      cancel();
      if (canDraw()) draw(performance.now());
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      visibility();
    });
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", visibility);
    resize.observe(host);
    intersection.observe(host);
    void document.fonts.ready.then(() => build(true));
    build();
    return () => {
      disposed = true;
      cancel();
      resize.disconnect();
      theme.disconnect();
      intersection.disconnect();
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", visibility);
      delete host.dataset.rendered;
    };
  }, [animated]);

  return (
    <h1 ref={root} className="turwe-title" aria-label={TEXT}>
      <span className="turwe-title-fallback">{TEXT}</span>
      <canvas ref={canvas} aria-hidden="true" />
    </h1>
  );
}
