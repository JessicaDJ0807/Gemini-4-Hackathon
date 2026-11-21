// Curated highlights, not live popularity rankings. Sources checked 2026-11-21.
const nycSource = 'https://www.business.nyctourism.com/press-media/press-releases/nyc-company-invites-visitors-to-see-manhattan-like-a-new-yorker';
const parisSource = 'https://parisjetaime.com/eng/article/the-essentials-a264';
const tokyoSource = 'https://www.gotokyo.org/en/see-and-do/attractions/';
export const catalog = [
  {
    destination: { id: 'nyc', name: 'New York City', countryCode: 'US', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' },
    aliases: ['nyc', 'new york', 'new york city'], sourceUrl: nycSource,
    places: [
      ['central-park', 'Central Park', ['outdoor', 'walking']],
      ['times-square', 'Times Square', ['outdoor', 'walking']],
      ['empire-state', 'Empire State Building', ['sightseeing']],
      ['statue-liberty', 'Statue of Liberty', ['outdoor', 'sightseeing']],
      ['rockefeller', 'Rockefeller Center', ['walking', 'sightseeing']],
      ['911-memorial', '9/11 Memorial & Museum', ['museum', 'walking']]
    ]
  },
  {
    destination: { id: 'paris', name: 'Paris', countryCode: 'FR', latitude: 48.8534, longitude: 2.3488, timezone: 'Europe/Paris' },
    aliases: ['paris'], sourceUrl: parisSource,
    places: [
      ['eiffel', 'Eiffel Tower', ['sightseeing']],
      ['louvre', 'Louvre Museum', ['indoor', 'museum']],
      ['montmartre', 'Montmartre', ['outdoor', 'walking']],
      ['notre-dame', 'Notre-Dame de Paris', ['sightseeing']],
      ['champs-elysees', 'Champs-Élysées', ['outdoor', 'shopping']],
      ['arc-triomphe', 'Arc de Triomphe', ['sightseeing']]
    ]
  },
  {
    destination: { id: 'tokyo', name: 'Tokyo', countryCode: 'JP', latitude: 35.6895, longitude: 139.6917, timezone: 'Asia/Tokyo' },
    aliases: ['tokyo', 'tokio'], sourceUrl: tokyoSource,
    places: [
      ['sensoji', 'Sensoji Temple', ['walking', 'sightseeing']],
      ['meiji', 'Meiji Jingu', ['outdoor', 'walking']],
      ['tokyo-tower', 'Tokyo Tower', ['sightseeing']],
      ['shibuya', 'Shibuya Crossing', ['outdoor', 'walking']],
      ['skytree', 'Tokyo Skytree', ['sightseeing']],
      ['ueno', 'Ueno Park', ['outdoor', 'walking']]
    ]
  }
];

export function suggestAttractions(destinationId, random = Math.random) {
  const city = catalog.find((entry) => entry.destination.id === destinationId);
  if (!city) return { attractions: [], sourceUrl: null };
  const pool = [...city.places];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return {
    attractions: pool.slice(0, 5).map(([id, name, activityTags]) => ({ id: `${destinationId}-${id}`, name, source: 'curated', activityTags: [...activityTags] })),
    sourceUrl: city.sourceUrl
  };
}
