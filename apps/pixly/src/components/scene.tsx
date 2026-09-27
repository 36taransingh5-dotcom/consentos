import { useId } from "react";

/**
 * Procedural landscape "photos": a sky gradient, a sun or moon, and layered
 * ridgelines from a seeded generator. Deterministic, so server and client
 * render identical SVG.
 */

interface Palette {
  sky: [string, string, string];
  sun: string;
  glow: string;
  ridges: [string, string, string, string];
}

const PALETTES: Palette[] = [
  { sky: ["#ffb88c", "#ff8a7a", "#6d5a9c"], sun: "#fff1d6", glow: "#ffd6a5", ridges: ["#8d6a9f", "#6b4f86", "#4a3868", "#2c2146"] },
  { sky: ["#fde2c3", "#f7b9a8", "#a9c1e8"], sun: "#fffaf0", glow: "#ffe3c4", ridges: ["#9fb4d9", "#7892c2", "#56709f", "#34496f"] },
  { sky: ["#1d2b53", "#3b3f8f", "#7a5cb8"], sun: "#f4f1ff", glow: "#b9a8ff", ridges: ["#433b7e", "#2f2a63", "#211d49", "#140f2e"] },
  { sky: ["#fff0c9", "#ffcf87", "#f29b5c"], sun: "#fff7e0", glow: "#ffe0a3", ridges: ["#e3a468", "#c9824a", "#a66333", "#6e3d1f"] },
  { sky: ["#dff3e4", "#b7e0c8", "#7fb7a3"], sun: "#fbfff5", glow: "#e6f7d9", ridges: ["#5e9c7f", "#447e64", "#2d604b", "#173f31"] },
  { sky: ["#cfe9f5", "#9fd0e6", "#f2c6a0"], sun: "#fffbef", glow: "#ffe6c6", ridges: ["#6fa5b8", "#4d8599", "#33647a", "#1c4152"] },
  { sky: ["#2a1b3d", "#8e3b5f", "#f28a6a"], sun: "#ffe2c2", glow: "#ffb38a", ridges: ["#5b2d52", "#43203f", "#2c142b", "#170a17"] },
  { sky: ["#fbd3a6", "#e98a58", "#9a4a3a"], sun: "#fff0d9", glow: "#ffc89a", ridges: ["#b0573a", "#8a3f2a", "#632b1d", "#3b170f"] },
  { sky: ["#e9f1fb", "#c9d9ef", "#9fb5d6"], sun: "#ffffff", glow: "#eef4ff", ridges: ["#c2cfe3", "#9aabc7", "#6f82a5", "#44557a"] },
  { sky: ["#fff4d6", "#bfe3c0", "#6fae8c"], sun: "#fffdf2", glow: "#fff2c2", ridges: ["#7fb08d", "#5c9272", "#3d7257", "#22503c"] },
];

function mulberry32(seed: number) {
  let a = seed * 2654435761;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ridge(rand: () => number, base: number, amplitude: number): string {
  const f = [0.04 + rand() * 0.05, 0.1 + rand() * 0.1, 0.25 + rand() * 0.2];
  const p = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const points: string[] = [];
  for (let x = 0; x <= 100; x += 2) {
    const y =
      base -
      amplitude * (0.6 * Math.sin(x * f[0]! + p[0]!) + 0.3 * Math.sin(x * f[1]! + p[1]!) + 0.1 * Math.sin(x * f[2]! + p[2]!));
    points.push(`${x} ${y.toFixed(2)}`);
  }
  return `M0 100 L${points.join(" L")} L100 100 Z`;
}

export function Scene({ seed, className, label }: { seed: number; className?: string; label?: string }) {
  const id = useId().replace(/:/g, "");
  const rand = mulberry32(seed);
  const palette = PALETTES[seed % PALETTES.length]!;
  const sunX = 20 + rand() * 60;
  const sunY = 22 + rand() * 20;
  const sunR = 6 + rand() * 5;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={`sky${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={palette.sky[0]} />
          <stop offset="0.55" stopColor={palette.sky[1]} />
          <stop offset="1" stopColor={palette.sky[2]} />
        </linearGradient>
        <radialGradient id={`glow${id}`}>
          <stop offset="0" stopColor={palette.glow} stopOpacity="0.9" />
          <stop offset="1" stopColor={palette.glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#sky${id})`} />
      <circle cx={sunX} cy={sunY} r={sunR * 3.2} fill={`url(#glow${id})`} />
      <circle cx={sunX} cy={sunY} r={sunR} fill={palette.sun} />
      {palette.ridges.map((color, i) => (
        <path key={i} d={ridge(rand, 52 + i * 12, 13 - i * 2.4)} fill={color} opacity={i === 0 ? 0.85 : 1} />
      ))}
    </svg>
  );
}
