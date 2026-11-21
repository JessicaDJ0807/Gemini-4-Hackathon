// Place photos are presentation-only. Custom uploads never enter API/model requests.
export function attachPlacePhotos({ onChange, onError }) {
  let catalog = {}, activeIds = new Set();
  const uploads = new Map(), broken = new Set(), pending = new Map();
  fetch('/api/place-photos').then(response => {
    if (!response.ok) throw new Error(); return response.json();
  }).then(result => { catalog = result; onChange(); }).catch(() => { /* Upload placeholders remain usable. */ });
  function prune(places) {
    activeIds = new Set(places.map(place => place.id));
    for (const [id, url] of uploads) if (!activeIds.has(id)) { URL.revokeObjectURL(url); uploads.delete(id); }
  }
  function thumbnail(place) {
    const photo = catalog[place.id], src = uploads.get(place.id) ?? (!broken.has(place.id) ? photo?.imageUrl : null);
    const box = document.createElement('div'); box.className = 'place-photo';
    if (src) {
      const img = document.createElement('img'); img.src = src; img.alt = place.name;
      img.width = 88; img.height = 72; img.loading = 'lazy';
      img.addEventListener('error', () => { if (!uploads.has(place.id)) { broken.add(place.id); onChange(); } }, { once: true });
      box.append(img);
    }
    if (!photo || broken.has(place.id)) {
      const label = document.createElement('label'); label.className = 'place-photo-upload';
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
      input.setAttribute('aria-label', `${src ? 'Change' : 'Add'} photo for ${place.name}`);
      const caption = document.createElement('span'); caption.textContent = src ? 'Change' : '+ Photo';
      label.title = 'Local preview only; choose again after leaving this page.';
      input.addEventListener('change', async () => {
        const file = input.files[0]; input.value = ''; if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 2 * 1024 * 1024) {
          onError('Choose a JPG, PNG, or WebP place photo up to 2 MB.'); return;
        }
        const token = Symbol(); pending.set(place.id, token);
        const url = URL.createObjectURL(file);
        try {
          const img = new Image(); img.src = url; await img.decode();
          if (img.naturalWidth * img.naturalHeight > 16000000) throw new Error();
          if (!activeIds.has(place.id) || pending.get(place.id) !== token) { URL.revokeObjectURL(url); return; }
          if (uploads.has(place.id)) URL.revokeObjectURL(uploads.get(place.id));
          uploads.set(place.id, url); onChange();
        } catch { URL.revokeObjectURL(url); onError('That photo could not be opened. Try a smaller image.'); }
      });
      label.append(input, caption); box.append(label);
    }
    return box;
  }
  function credits(places) {
    const details = document.createElement('details'); details.className = 'photo-credits';
    const summary = document.createElement('summary'); summary.textContent = 'Photo credits'; details.append(summary);
    const list = document.createElement('ul');
    for (const place of places) {
      const photo = catalog[place.id]; if (!photo || uploads.has(place.id) || broken.has(place.id)) continue;
      const item = document.createElement('li'), link = document.createElement('a');
      link.href = photo.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = place.name;
      item.append(link, document.createTextNode(` — ${photo.author} · `));
      if (photo.licenseUrl) {
        const license = document.createElement('a'); license.href = photo.licenseUrl; license.target = '_blank'; license.rel = 'noopener noreferrer'; license.textContent = photo.license; item.append(license);
      } else item.append(document.createTextNode(photo.license));
      list.append(item);
    }
    const note = document.createElement('p'); note.textContent = 'Photos are cropped to fit the thumbnails.'; details.append(list, note); if (!list.childElementCount) details.hidden = true;
    return details;
  }
  return { thumbnail, credits, prune };
}
