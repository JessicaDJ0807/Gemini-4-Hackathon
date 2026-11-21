import { validProfile } from '/contracts.mjs';
import { PHOTO_LIMIT, PHOTO_BYTES, PHOTO_TYPES, validateInspirationRequest, validateInspirationResponse } from '/shared/style-inspiration.mjs';
import { DETAIL_FIELDS, DETAIL_LIMIT, addLabel, buildStyleProfile, emptyStyleProfile, validNestedProfile,
  applyStyleAnalysis, restoreStyleProfile } from '/shared/style-profile.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'travel-stylist.confirmed-profile.v1';
const draftKey = 'travel-stylist.style-draft.v1';
let profile = emptyStyleProfile(), edited = false, pending = null;
let photos = [], revision = 0, controller, available = false, reading = false, analyzing = false;
function error(message) { $('error').textContent = message; $('error').hidden = false; }
function saveDraft() {
  if (!validNestedProfile(profile)) return;
  try { sessionStorage.setItem(draftKey, JSON.stringify({ profile: buildStyleProfile(profile), edited })); }
  catch { /* Confirmation reports a storage failure and prevents navigation. */ }
}
function changed(nested = false) {
  if (nested) edited = true;
  try { sessionStorage.removeItem(storageKey); } catch { /* Handled on confirmation. */ }
  saveDraft(); update();
}
function update() {
  const count = profile.directions.length;
  $('photo-status').classList.toggle('is-loading', analyzing);
  $('continue').disabled = !validNestedProfile(profile) || (!count && !profile.userTags.length) || reading || analyzing;
  $('continue').textContent = pending ? 'Continue with current style →' : 'Continue to trip →';
  $('selection-count').textContent = analyzing ? 'Finding your style…' : count || profile.userTags.length ?
    [count ? `${count} style${count === 1 ? '' : 's'}` : '', profile.userTags.length ? `${profile.userTags.length} personal tag${profile.userTags.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') :
    'Add photos or a personal tag to continue.';
  $('photos').disabled = !available || reading;
  $('retry-photos').disabled = !available || reading || analyzing;
  for (const button of $('photo-previews').querySelectorAll('button')) button.disabled = reading;
  $('pending-analysis').hidden = !pending;
}
function invalidatePhotos() {
  revision++; controller?.abort(); analyzing = false; pending = null;
  $('error').hidden = true; $('retry-photos').hidden = true;
  $('photo-status').textContent = photos.length ? '' : 'Photos removed. Your saved style details are kept.';
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
function renderDirections() {
  const open = new Set([...$('style-directions').querySelectorAll('details[open]')].map(item => item.dataset.id));
  $('style-directions').replaceChildren();
  profile.directions.forEach(direction => {
    const card = document.createElement('details'); card.className = 'direction-card'; card.dataset.id = direction.id; card.open = open.has(direction.id);
    const summary = document.createElement('summary'), title = document.createElement('span'), meta = document.createElement('span');
    title.textContent = direction.name; meta.textContent = 'Edit details'; meta.className = 'direction-meta'; summary.append(title, meta);
    const body = document.createElement('div'); body.className = 'direction-body';
    for (const [key, caption, max] of [['name', 'Style name', 100], ['description', 'Description', 500]]) {
      const label = document.createElement('label'), input = document.createElement(key === 'description' ? 'textarea' : 'input');
      label.className = 'editor-field'; label.textContent = caption; input.value = direction[key]; input.maxLength = max;
      if (key === 'name') input.required = true; else input.rows = 2;
      input.addEventListener('input', () => {
        const previousName = direction.name; direction[key] = input.value;
        if (key === 'name') {
          title.textContent = input.value || 'Name your style';
          for (const button of body.querySelectorAll('button[aria-label]')) {
            button.setAttribute('aria-label', button.getAttribute('aria-label').replace(previousName, input.value));
          }
          const chip = $('style-labels').querySelectorAll('button')[profile.directions.indexOf(direction)];
          if (chip) { chip.textContent = `${input.value || 'Name your style'} ×`; chip.setAttribute('aria-label', `Remove ${input.value} from your styles`); }
        }
        changed(true);
      });
      input.addEventListener('change', () => { direction[key] = input.value.trim(); input.value = direction[key]; changed(true); });
      label.append(input); body.append(label);
    }
    DETAIL_FIELDS.forEach(key => {
      const section = document.createElement('div'), label = document.createElement('label'), form = document.createElement('form');
      section.className = 'detail-category'; label.textContent = labels[key]; label.htmlFor = `${direction.id}-${key}`;
      const chips = document.createElement('div');
      const input = document.createElement('input'), add = document.createElement('button');
      input.id = label.htmlFor; input.maxLength = 100; input.placeholder = `Add ${labels[key].toLowerCase()}`; input.autocomplete = 'off';
      add.type = 'submit'; add.textContent = 'Add'; add.className = 'secondary'; add.setAttribute('aria-label', `Add to ${labels[key].toLowerCase()} for ${direction.name}`);
      const render = () => chips.replaceChildren(chipList(direction[key], index => {
        direction[key].splice(index, 1); changed(true); render(); input.focus();
      }, `${direction.name}: ${labels[key].toLowerCase()}`));
      render(); form.className = 'tag-entry'; form.append(input, add);
      form.addEventListener('submit', event => {
        event.preventDefault();
        try { direction[key] = addLabel(direction[key], input.value, DETAIL_LIMIT); input.value = ''; $('error').hidden = true; changed(true); render(); input.focus(); }
        catch (cause) { error(cause.message); input.focus(); }
      });
      section.append(label, chips, form); body.append(section);
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-direction'; remove.textContent = 'Remove this style';
    remove.addEventListener('click', () => {
      profile.directions = profile.directions.filter(item => item.id !== direction.id); changed(true); renderProfile();
      ($('style-directions').querySelector('summary') ?? $('manual-tag')).focus();
    });
    body.append(remove); card.append(summary, body); $('style-directions').append(card);
  });
}
function renderProfile() {
  $('photo-result').hidden = !profile.directions.length;
  $('style-summary').textContent = profile.summary;
  $('style-labels').replaceChildren(chipList(profile.directions.map(direction => direction.name), index => {
    profile.directions.splice(index, 1); changed(true); renderProfile(); $('manual-tag').focus();
  }, 'your styles'));
  renderDirections(); renderManualTags(); update();
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
  $('photo-previews').replaceChildren();
  photos.forEach(photo => {
    const figure = document.createElement('figure'), img = document.createElement('img'), button = document.createElement('button');
    img.src = photo.url; img.alt = 'Your style inspiration';
    button.type = 'button'; button.textContent = 'Remove'; button.className = 'remove-photo';
    button.setAttribute('aria-label', `Remove ${photo.file.name}`);
    button.addEventListener('click', () => {
      photos = photos.filter(item => item !== photo); URL.revokeObjectURL(photo.url);
      invalidatePhotos(); renderPhotos();
      void analyzePhotos();
    });
    figure.append(img, button); $('photo-previews').append(figure);
  });
}
$('photos').addEventListener('change', async () => {
  const files = [...$('photos').files]; $('photos').value = '';
  if (!files.length) return;
  $('error').hidden = true;
  if (photos.length + files.length > PHOTO_LIMIT) return error('You can add up to 3 photos. Remove one before adding another.');
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
      $('photo-status').textContent = 'Your styles are ready. Open a style to fine-tune it.';
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
    saveDraft(); photos.forEach(photo => URL.revokeObjectURL(photo.url));
    window.location.assign('/trip');
  } catch { error('Could not save your style. Check your edits and enable browser session storage, then try again.'); }
});
try {
  const draft = JSON.parse(sessionStorage.getItem(draftKey));
  const saved = JSON.parse(sessionStorage.getItem(storageKey));
  if (validNestedProfile(draft?.profile)) { profile = buildStyleProfile(draft.profile); edited = Boolean(draft.edited); }
  else if (validProfile(saved)) { profile = restoreStyleProfile(saved); edited = profile.directions.length > 0; }
} catch { /* Start fresh if stored data cannot be read. */ }
renderProfile();
try {
  const response = await fetch('/api/config', { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error();
  available = (await response.json()).photoAnalysis === true;
  $('photo-help').textContent = available ? 'Photos are analyzed automatically with Google Gemini.' : 'Photo analysis is unavailable. You can still add your own tags below.';
} catch { $('photo-help').textContent = 'Photo analysis is unavailable. You can still add your own tags below.'; }
update();
