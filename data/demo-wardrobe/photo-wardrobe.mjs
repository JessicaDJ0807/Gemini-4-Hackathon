import manifest from '../../services/ai/tests/fixtures/wardrobe/manifest.json' with { type: 'json' };

// Reuse A's checked-in photos and IDs; no duplicate image downloads or relabeling.
export const photoWardrobeVersion = manifest.dataset;
export const photoWardrobe = manifest.items.map(item => ({
  id: item.id, name: item.name, category: item.category, color: item.color,
  styleTags: item.style_tags, imageUrl: `/wardrobe-photos/${item.id}.jpg`
}));
// Credit every photo: source link when known, plus author and license (required for the CC BY / BY-SA items).
export const photoCredits = manifest.items.map(item => ({ name: item.name, url: item.source_url ?? null,
  source: item.source ?? (item.source_url?.includes('pexels.com') ? 'Pexels' : null),
  author: item.author ?? null, license: item.license ?? null, licenseUrl: item.license_url ?? null }));
