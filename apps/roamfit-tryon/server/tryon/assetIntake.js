// AssetIntake: sniff real type from bytes (extensions lie — two test assets are WebP named .png), check size/dimensions.
export const MAX_BYTES = 12 * 1024 * 1024
const MIN_SIDE = 256

export function sniff(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8 ') return { mime: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { mime: 'image/webp', width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 } }
    if (chunk === 'VP8X') return { mime: 'image/webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { mime: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
    return { mime: 'image/jpeg', width: 0, height: 0 }
  }
  return null
}

/** role: person | garment | scene. Returns {ok, image?, warnings[], errors[]} */
export function intake(role, buf, name = role) {
  const errors = [], warnings = []
  if (buf.length > MAX_BYTES) errors.push(`${name}: ${(buf.length / 1e6).toFixed(1)}MB exceeds ${MAX_BYTES / 1e6}MB limit`)
  const info = sniff(buf)
  if (!info) errors.push(`${name}: not a PNG, JPEG or WebP image`)
  if (errors.length) return { ok: false, errors, warnings }
  const { width, height, mime } = info
  if (Math.min(width, height) < MIN_SIDE) errors.push(`${name}: ${width}x${height} is too small (min side ${MIN_SIDE}px)`)
  const aspect = height / width
  if (role === 'person') {
    if (aspect < 1.2) warnings.push('person photo is not portrait; a full-body, front-facing photo works best')
    if (width < 600) warnings.push(`person photo is low resolution (${width}px wide); face detail may drift`)
  }
  if (role === 'scene' && aspect > 1) warnings.push('scene is portrait; wide scenes leave more room to place a person')
  if (role === 'garment') warnings.push('confirm this image shows exactly one garment (not an outfit collage)')
  return { ok: errors.length === 0, errors, warnings, image: { mime, width, height, bytes: buf.length, data: buf.toString('base64') } }
}
