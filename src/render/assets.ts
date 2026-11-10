import type { CharDef } from '../game/chars';
import { clamp } from '../core/math';

export interface CharArt {
  key: string;
  sprite: HTMLCanvasElement;
  portrait: string;
  aspect: number;
}

const cache = new Map<string, CharArt>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${src}`));
    img.src = src;
  });
}

/**
 * The source art is a yellow character on a pure white background.
 * Knock the white out with a soft alpha ramp, mask the watermark in the
 * bottom-right corner, then crop to the character's bounding box.
 */
function cutout(img: HTMLImageElement): HTMLCanvasElement {
  // Downscale before pixel work: 18 full-size JPEGs at once can exhaust the
  // canvas memory budget on phones and silently fall back to blob sprites.
  const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const ctx = full.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  const maskX = w * 0.7;
  const maskY = h * 0.925;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const whiteness = 255 - Math.min(r, g, b);
      let a = clamp((whiteness - 14) / 34, 0, 1);
      if (x > maskX && y > maskY) a = 0;
      // keep only the character, drop faint jpeg noise
      if (a < 0.06) a = 0;
      d[i + 3] = Math.round(a * 255);

      if (a > 0.35) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX > maxX) {
    minX = 0;
    minY = 0;
    maxX = w - 1;
    maxY = h - 1;
  }

  ctx.putImageData(image, 0, 0);

  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const octx = out.getContext('2d')!;
  octx.drawImage(full, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

function makePortrait(sprite: HTMLCanvasElement, color: string): string {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const grad = ctx.createRadialGradient(size * 0.5, size * 0.42, 10, size * 0.5, size * 0.5, size * 0.62);
  grad.addColorStop(0, `${color}66`);
  grad.addColorStop(0.6, `${color}22`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const maxW = size * 0.84;
  const maxH = size * 0.86;
  const scale = Math.min(maxW / sprite.width, maxH / sprite.height);
  const w = sprite.width * scale;
  const h = sprite.height * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sprite, (size - w) / 2, size * 0.93 - h, w, h);

  return c.toDataURL('image/png');
}

function fallbackSprite(def: CharDef): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 220;
  c.height = 260;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.ellipse(110, 150, 86, 100, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2b2417';
  ctx.beginPath();
  ctx.arc(82, 116, 13, 0, Math.PI * 2);
  ctx.arc(140, 116, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(86, 112, 4, 0, Math.PI * 2);
  ctx.arc(144, 112, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4a3a22';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(110, 150, 26, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  return c;
}

export async function loadCharArt(def: CharDef): Promise<CharArt> {
  const hit = cache.get(def.id);
  if (hit) return hit;

  let sprite: HTMLCanvasElement;
  try {
    const img = await loadImage(new URL(def.sprite, document.baseURI).href);
    sprite = cutout(img);
  } catch (err) {
    console.warn('[naiwa] sprite fallback for', def.id, err);
    sprite = fallbackSprite(def);
  }

  const art: CharArt = {
    key: def.id,
    sprite,
    portrait: makePortrait(sprite, def.color),
    aspect: sprite.width / sprite.height,
  };
  cache.set(def.id, art);
  return art;
}

export async function loadAllArts(defs: readonly CharDef[]): Promise<Record<string, CharArt>> {
  // sequential: mobile Safari hates 18 simultaneous image decodes + canvases
  const list: CharArt[] = [];
  for (const d of defs) list.push(await loadCharArt(d));
  return Object.fromEntries(list.map((a) => [a.key, a]));
}
