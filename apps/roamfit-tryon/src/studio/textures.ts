// Procedural canvas textures (no downloads). Fabric textures are world-scaled: one texture tile = tileM metres,
// matching the metre-based UVs from tubeGeometry so a 14 mm gingham check is 14 mm everywhere.
import * as THREE from 'three'
import type { Pattern } from './wardrobe/catalog'

const cache = new Map<string, THREE.Texture>()
function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, tileM: number, srgb = true) {
  const k = `${key}:${tileM}`
  if (cache.has(k)) return cache.get(k)!
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d')!; draw(g, size)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / tileM, 1 / tileM)
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  cache.set(k, t)
  return t
}
function noise(g: CanvasRenderingContext2D, s: number, alpha: number, n = 4000) {
  for (let i = 0; i < n; i++) { g.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`; g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1) }
}

export function fabricTexture(p: Pattern) {
  const key = `${p.kind}:${p.a}:${p.b}`
  switch (p.kind) {
    case 'gingham': return canvasTex(key, 256, (g, s) => {
      // 2×2 checks per tile: light, mid (50% overlap), dark
      g.fillStyle = p.a; g.fillRect(0, 0, s, s)
      g.globalAlpha = 0.55; g.fillStyle = p.b!; g.fillRect(0, 0, s / 2, s); g.fillRect(0, 0, s, s / 2)
      g.globalAlpha = 1; g.fillRect(0, 0, s / 2, s / 2)
      g.globalAlpha = 1; noise(g, s, 0.05, 3000)
    }, (p.scaleM ?? 0.014) * 2)
    case 'stripes': return canvasTex(key, 128, (g, s) => {
      g.fillStyle = p.a; g.fillRect(0, 0, s, s); g.fillStyle = p.b!; g.fillRect(0, s * 0.62, s, s * 0.38); noise(g, s, 0.04, 800)
    }, p.scaleM ?? 0.026)
    case 'rib': return canvasTex(key, 128, (g, s) => {
      g.fillStyle = p.a; g.fillRect(0, 0, s, s)
      for (let x = 0; x < s; x += 8) { g.fillStyle = p.b!; g.fillRect(x, 0, 3, s) }
      noise(g, s, 0.03, 600)
    }, p.scaleM ?? 0.006)
    case 'linen': return canvasTex(key, 256, (g, s) => {
      g.fillStyle = p.a; g.fillRect(0, 0, s, s)
      for (let i = 0; i < 900; i++) { g.strokeStyle = Math.random() > 0.5 ? p.b! : 'rgba(255,255,255,0.25)'; g.globalAlpha = 0.35; const y = Math.random() * s; g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + (Math.random() - 0.5) * 2); g.stroke() }
      g.globalAlpha = 1; noise(g, s, 0.05)
    }, p.scaleM ?? 0.05)
    case 'pleats': return canvasTex(key, 128, (g, s) => {
      const grd = g.createLinearGradient(0, 0, s, 0)
      grd.addColorStop(0, p.b!); grd.addColorStop(0.45, p.a); grd.addColorStop(0.55, p.a); grd.addColorStop(1, p.b!)
      g.fillStyle = grd; g.fillRect(0, 0, s, s); noise(g, s, 0.03, 500)
    }, p.scaleM ?? 0.035)
    default: return null
  }
}

// ---- scene textures ----
export const cobbleTexture = () => canvasTex('cobble', 512, (g, s) => {
  g.fillStyle = '#5d5147'; g.fillRect(0, 0, s, s)
  const rows = 10, h = s / rows
  for (let r = 0; r < rows; r++) {
    let x = (r % 2) * -h * 0.6
    while (x < s) {
      const w = h * (1.2 + Math.random() * 0.6)
      const tone = 120 + Math.random() * 50
      g.fillStyle = `rgb(${tone + 25},${tone + 8},${tone - 12})`
      g.beginPath(); g.roundRect(x + 2, r * h + 2, w - 4, h - 4, 7); g.fill()
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 5, r * h + 4, w - 12, 3)
      x += w
    }
  }
  noise(g, s, 0.06, 9000)
}, 1.6)

export const pavementTexture = () => canvasTex('pave', 256, (g, s) => {
  g.fillStyle = '#b7aa98'; g.fillRect(0, 0, s, s)
  g.strokeStyle = 'rgba(60,50,40,0.35)'; g.lineWidth = 2
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, (i * s) / 4); g.lineTo(s, (i * s) / 4); g.stroke(); g.beginPath(); g.moveTo((i * s) / 4, 0); g.lineTo((i * s) / 4, s); g.stroke() }
  noise(g, s, 0.07, 5000)
}, 2)

/** Facade with window grid. kind: stone (grey limestone) | brick */
export function facadeTexture(kind: 'stone' | 'brick', floors: number, bays: number) {
  return canvasTex(`facade:${kind}:${floors}:${bays}`, 1024, (g, s) => {
    g.fillStyle = kind === 'stone' ? '#9d968c' : '#9a4a33'; g.fillRect(0, 0, s, s)
    // masonry
    const bh = s / (kind === 'stone' ? 40 : 90)
    for (let y = 0; y < s; y += bh) {
      const bw = kind === 'stone' ? bh * 2.6 : bh * 2.2
      for (let x = ((y / bh) % 2) * -bw / 2; x < s; x += bw) {
        const t = (Math.random() - 0.5) * 22
        g.fillStyle = kind === 'stone' ? `rgb(${160 + t},${153 + t},${142 + t})` : `rgb(${150 + t},${70 + t / 2},${50 + t / 3})`
        g.fillRect(x + 1, y + 1, bw - 2, bh - 2)
      }
    }
    const fh = s / floors, bw = s / bays
    for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) {
      const ground = f === floors - 1
      const wx = b * bw + bw * 0.2, ww = bw * 0.6, wy = f * fh + fh * (ground ? 0.25 : 0.18), wh = fh * (ground ? 0.75 : 0.6)
      g.fillStyle = '#f2eee6'; g.fillRect(wx - 6, wy - 6, ww + 12, wh + 12) // white frame
      const sky = g.createLinearGradient(0, wy, 0, wy + wh); sky.addColorStop(0, '#3b4a5a'); sky.addColorStop(1, '#1b2129')
      g.fillStyle = ground && b % 3 === 1 ? '#4a2d1e' : sky; g.fillRect(wx, wy, ww, wh)
      if (!(ground && b % 3 === 1)) { g.fillStyle = '#f2eee6'; g.fillRect(wx + ww / 2 - 2, wy, 4, wh); g.fillRect(wx, wy + wh * 0.4, ww, 4) }
      if (!ground) { g.beginPath(); g.ellipse(wx + ww / 2, wy, ww / 2 + 6, fh * 0.07, 0, Math.PI, 0); g.fillStyle = '#e9e3d8'; g.fill() }
    }
    noise(g, s, 0.05, 20000)
  }, 1, true)
}

export const slateTexture = () => canvasTex('slate', 256, (g, s) => {
  g.fillStyle = '#34363b'; g.fillRect(0, 0, s, s)
  for (let y = 0; y < s; y += 16) for (let x = ((y / 16) % 2) * 10; x < s; x += 20) { const t = Math.random() * 18; g.fillStyle = `rgb(${50 + t},${53 + t},${60 + t})`; g.fillRect(x, y, 18, 14) }
}, 1.2)

/** Clone a world-scaled texture for a mesh whose UVs span 0..1 over w×h metres. */
export function tiled(tex: THREE.Texture, w: number, h: number, tileM: number) {
  const t = tex.clone(); t.needsUpdate = true; t.repeat.set(w / tileM, h / tileM); return t
}
