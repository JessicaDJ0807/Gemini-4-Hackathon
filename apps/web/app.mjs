import { validProfile } from '/contracts.mjs';
import { PHOTO_LIMIT, PHOTO_BYTES, PHOTO_TYPES, validateInspirationRequest, validateInspirationResponse } from '/shared/style-inspiration.mjs';
import { DETAIL_FIELDS, addLabel, buildStyleProfile, emptyStyleProfile, validNestedProfile,
  applyStyleAnalysis } from '/shared/style-profile.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'travel-stylist.confirmed-profile.v1';
// A visit to this page starts a new style; only confirmation passes it to the trip.
try {
  sessionStorage.removeItem('travel-stylist.style-draft.v1');
  sessionStorage.removeItem(storageKey);
} catch { /* Confirmation reports unavailable session storage. */ }
window.addEventListener('pageshow', event => {
  if (event.persisted) window.location.reload();
});
let profile = emptyStyleProfile(), edited = false, pending = null;
let photos = [], revision = 0, controller, available = false, reading = false, analyzing = false;
function error(message) { $('error').textContent = message; $('error').hidden = false; }
function changed(nested = false) {
  if (nested) edited = true;
  try { sessionStorage.removeItem(storageKey); } catch { /* Handled on confirmation. */ }
  update();
  if (nested) renderStyleLabels();
}
function update() {
  const count = profile.directions.length;
  $('photo-status').classList.toggle('is-loading', analyzing);
  $('continue').disabled = !validNestedProfile(profile) || (!count && !profile.userTags.length) || reading || analyzing;
  $('continue').textContent = pending ? 'Continue with current style →' : 'Continue to trip →';
  $('selection-count').textContent = analyzing ? 'Finding your style…' : count || profile.userTags.length ?
    '' :
    (available ? 'Add photos or a personal tag to continue.' : 'Add a personal style tag to continue.');
  const atPhotoLimit = photos.length >= PHOTO_LIMIT;
  document.querySelector('.upload-button').hidden = atPhotoLimit;
  $('photos').disabled = !available || reading || atPhotoLimit;
  $('retry-photos').disabled = !available || reading || analyzing;
  for (const button of $('photo-previews').querySelectorAll('button')) button.disabled = reading;
  $('pending-analysis').hidden = !pending;
}
function invalidatePhotos() {
  revision++; controller?.abort(); analyzing = false; pending = null;
  $('error').hidden = true; $('retry-photos').hidden = true;
  $('photo-status').textContent = photos.length ? '' : 'Photos removed. Your current style details are kept.';
  update();
}
function chipList(values, remove, label) {
  const group = document.createElement('div'); group.className = 'editable-chips';
  values.forEach((value, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'style-chip';
    button.textContent = `${value} ×`; button.setAttribute('aria-label', `Remove ${value} from ${label}`);
    button.addEventListener('click', () => remove(index)); group.append(button);
  });
  return group;
}
function renderManualTags() {
  $('manual-tags').replaceChildren(chipList(profile.userTags, index => {
    profile.userTags.splice(index, 1); changed(); renderManualTags(); $('manual-tag').focus();
  }, 'your tags'));
}
const labels = { colors: 'Colors', silhouettes: 'Silhouettes', stylingPatterns: 'Styling details', keyPieces: 'Key pieces' };
function renderStyleLabels() {
  const names = profile.directions.map(direction => direction.name);
  const seen = new Set(names.map(name => name.trim().toLowerCase()));
  const tags = [];
  // Interleave categories so the preview includes more than just a color palette.
  const groups = ['stylingPatterns', 'silhouettes', 'colors', 'keyPieces']
    .map(key => profile.directions.flatMap(direction => direction[key]));
  for (let index = 0; index < Math.max(0, ...groups.map(group => group.length)) && tags.length < 8; index++) {
    for (const group of groups) {
      const value = group[index], key = value?.trim().toLowerCase();
      if (!key || seen.has(key) || tags.length >= 8) continue;
      seen.add(key); tags.push(value);
    }
  }
  $('style-labels').replaceChildren(chipList(names, index => {
    profile.directions.splice(index, 1); changed(true); renderProfile(); $('manual-tag').focus();
  }, 'your styles'), chipList(tags, index => {
    const key = tags[index].trim().toLowerCase();
    // Remove every matching nested label so a duplicate cannot reappear in the preview.
    for (const direction of profile.directions) {
      for (const field of DETAIL_FIELDS) direction[field] = direction[field].filter(value => value.trim().toLowerCase() !== key);
    }
    changed(true); renderProfile(); $('manual-tag').focus();
  }, 'your style details'));
}
function renderProfile() {
  $('photo-result').hidden = !profile.directions.length;
  renderStyleLabels();
  renderManualTags(); update();
}
$('manual-tag-form').addEventListener('submit', event => {
  event.preventDefault();
  try { profile.userTags = addLabel(profile.userTags, $('manual-tag').value); $('manual-tag').value = ''; $('error').hidden = true; changed(); renderManualTags(); }
  catch (cause) { error(cause.message); }
  $('manual-tag').focus();
});
$('apply-analysis').addEventListener('click', () => {
  if (!pending) return;
  profile = applyStyleAnalysis(profile, pending); pending = null; edited = false;
  changed(); renderProfile(); $('suggestions-title').focus();
});
$('keep-edits').addEventListener('click', () => { pending = null; update(); $('manual-tag').focus(); });
function renderPhotos() {
  const row = $('photo-previews');
  row.replaceChildren(); row.hidden = !photos.length;
  row.style.setProperty('--photo-count', photos.length || 1);
  photos.forEach((photo, index) => {
    const figure = document.createElement('figure'), img = document.createElement('img');
    figure.tabIndex = 0;
    figure.setAttribute('role', 'group');
    figure.setAttribute('aria-label', `Inspiration photo ${index + 1} of ${photos.length}`);
    figure.style.setProperty('--photo-position', photos.length > 1 ? index / (photos.length - 1) : .5);
    figure.style.setProperty('--photo-layer', index + 1);
    img.src = photo.url; img.alt = 'Your style inspiration'; img.draggable = false;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = '×'; button.className = 'remove-photo'; button.disabled = reading;
    button.setAttribute('aria-label', `Remove ${photo.file.name}`);
    button.addEventListener('click', () => {
      photos = photos.filter(item => item !== photo); URL.revokeObjectURL(photo.url);
      invalidatePhotos(); renderPhotos();
      (photos.length ? row.children[Math.min(index, photos.length - 1)] : $('photos')).focus();
      void analyzePhotos();
    });
    // Tap or keyboard focus gives touch users the same expanded preview as hover.
    figure.addEventListener('click', event => { if (!event.target.closest('button')) figure.focus(); });
    figure.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const next = (index + (event.key === 'ArrowLeft' ? -1 : 1) + photos.length) % photos.length;
        row.children[next].focus();
      }
      if (event.key === 'Escape') figure.blur();
    });
    figure.append(img, button); row.append(figure);
  });
}
$('photos').addEventListener('change', async () => {
  const files = [...$('photos').files]; $('photos').value = '';
  if (!files.length) return;
  $('error').hidden = true;
  if (photos.length + files.length > PHOTO_LIMIT) return error(`You can add up to ${PHOTO_LIMIT} photos. Remove one before adding another.`);
  if (files.some(file => !PHOTO_TYPES.includes(file.type))) return error('Choose JPG, PNG, or WebP photos.');
  if (files.some(file => !file.size || file.size > PHOTO_BYTES)) return error('Each photo must be between 1 byte and 2 MB.');
  reading = true; update();
  const added = [];
  let accepted = false;
  try {
    for (const file of files) {
      const url = URL.createObjectURL(file); added.push({ file, url, id: `photo-${crypto.randomUUID()}` });
      const image = new Image(); image.src = url; await image.decode();
      if (image.naturalWidth * image.naturalHeight > 16000000) throw new Error('Choose photos smaller than 16 megapixels.');
    }
    photos.push(...added); invalidatePhotos(); renderPhotos(); accepted = true;
  } catch (cause) {
    added.forEach(photo => URL.revokeObjectURL(photo.url));
    error(cause.message.includes('megapixels') ? cause.message : 'One photo could not be opened. Choose another image.');
  } finally { reading = false; update(); }
  if (accepted) void analyzePhotos();
});
function base64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(new Error('Could not read a photo. Choose it again.')); reader.readAsDataURL(file);
  });
}
async function analyzePhotos() {
  if (!available || !photos.length || reading || analyzing) return;
  controller = new AbortController();
  const activeController = controller, requestRevision = revision, snapshot = [...photos];
  analyzing = true; $('retry-photos').hidden = true; $('error').hidden = true;
  update(); $('photo-status').textContent = 'Finding the details that make your style…';
  try {
    const request = { requestId: crypto.randomUUID(), inputRevision: requestRevision, tags: [...profile.userTags],
      photos: await Promise.all(snapshot.map(async photo => ({ id: photo.id, mimeType: photo.file.type, data: await base64(photo.file) }))) };
    if (revision !== requestRevision) return;
    validateInspirationRequest(request);
    const response = await fetch('/api/style-inspiration', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
      signal: AbortSignal.any([activeController.signal, AbortSignal.timeout(60000)])
    });
    const result = await response.json();
    if (revision !== requestRevision) return;
    if (!response.ok) throw new Error(result.error?.message ?? 'Photo analysis is unavailable. Retry or try different photos.');
    validateInspirationResponse(result, request);
    if (!result.suggestedProfile.directions.length) {
      $('photo-status').textContent = `${result.summary} Your existing styles and tags are kept.`;
    } else if (edited) {
      pending = result.suggestedProfile;
      $('pending-summary').textContent = pending.summary;
      $('pending-details').replaceChildren(...pending.directions.map(direction => {
        const item = document.createElement('li');
        item.textContent = `${direction.name}: ${direction.description} ${DETAIL_FIELDS.map(key => direction[key].length ? `${labels[key]}: ${direction[key].join(', ')}` : '').filter(Boolean).join(' · ')}`;
        return item;
      }));
      $('photo-status').textContent = 'New analysis is ready. Your edits are kept until you choose to replace them.';
    } else {
      profile = applyStyleAnalysis(profile, result.suggestedProfile); changed(); renderProfile();
      $('photo-status').textContent = '';
    }
  } catch (cause) {
    if (revision !== requestRevision || cause.name === 'AbortError') return;
    error(cause.name === 'TimeoutError' ? 'Photo analysis timed out. Your styles and tags are kept. Try again.' : cause.message);
    $('photo-status').textContent = ''; $('retry-photos').hidden = false;
  } finally { if (revision === requestRevision) { analyzing = false; update(); } }
}
$('retry-photos').addEventListener('click', () => { invalidatePhotos(); void analyzePhotos(); });
$('continue').addEventListener('click', () => {
  try {
    const confirmed = buildStyleProfile(profile);
    if (!validProfile(confirmed)) return error('Add at least one style or personal tag to continue.');
    sessionStorage.setItem(storageKey, JSON.stringify(confirmed));
    photos.forEach(photo => URL.revokeObjectURL(photo.url));
    window.location.assign('/trip');
  } catch { error('Could not save your style. Check your edits and enable browser session storage, then try again.'); }
});
renderProfile();
try {
  const response = await fetch('/api/config', { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error();
  const config = await response.json();
  available = config.photoAnalysis === true && !config.shoppingTestMode;
  if (config.shoppingTestMode) {
    $('payment-test-notice').hidden = false;
    document.querySelector('.inspiration').hidden = true;
    document.querySelector('.intro').textContent = 'Add a personal style tag to start the payment demo.';
    document.querySelector('.personal-tags .optional')?.remove();
  }
  $('photo-help').hidden = available || config.shoppingTestMode;
  $('photo-help').textContent = available ? '' : 'Photo analysis is unavailable. You can still add your own tags below.';
} catch { $('photo-help').hidden = false; $('photo-help').textContent = 'Photo analysis is unavailable. You can still add your own tags below.'; }
update();
