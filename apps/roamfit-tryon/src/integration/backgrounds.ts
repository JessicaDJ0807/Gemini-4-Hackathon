// Real travel photographs used as stationary backgrounds. Stable IDs; composition data for placing the character.
// Backgrounds are NEVER part of the preview cache key: characters are generated on a neutral backdrop.
import type { Destination } from '../studio2/TurnaroundViewer'

export type PhotoCredit = { author: string; license: string; licenseUrl: string | null; sourceUrl: string | null; note?: string }
export type BackgroundAsset = {
  id: string
  destinationId: string
  title: string
  imageUrl: string
  composition: Pick<Destination, 'focal' | 'ground' | 'sun' | 'tint'>
  credit: PhotoCredit
}
export type DestinationOption = { id: string; name: string; aliases: string[]; backgrounds: BackgroundAsset[] }

export const DESTINATIONS: DestinationOption[] = [
  {
    id: 'montreal', name: 'Old Montréal', aliases: ['montreal', 'montréal', 'old montreal'],
    backgrounds: [{
      id: 'bg-montreal-old-port-street-v1', destinationId: 'montreal', title: 'Rue Saint-Paul corner',
      imageUrl: '/backgrounds/montreal-old-port-street.jpg',
      composition: { focal: [0.5, 0.86], ground: { x: 0.42, y: 0.935, height: 0.6 }, sun: 'left', tint: '#ffd9ad' },
      credit: { author: 'Unknown', license: 'Not recorded', licenseUrl: null, sourceUrl: null, note: 'Existing Roamfit demo asset (assets/bg_test_montreal.png). Source and licence were not recorded; confirm before public use.' },
    }],
  },
  {
    id: 'kyoto', name: 'Kyoto', aliases: ['kyoto', '京都'],
    backgrounds: [
      {
        id: 'bg-kyoto-ninenzaka-morning-v1', destinationId: 'kyoto', title: 'Ninenzaka, early morning',
        imageUrl: '/backgrounds/kyoto-ninenzaka-morning.jpg',
        composition: { focal: [0.5, 0.85], ground: { x: 0.44, y: 0.94, height: 0.6 }, sun: 'left', tint: '#ece6dc' },
        credit: { author: 'Basile Morin', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:Pedestrian_road_with_pavements_and_paper_umbrellas,_Higashiyama-ku,_Kyoto,_Japan,_early_morning.jpg' },
      },
      {
        id: 'bg-kyoto-ninenzaka-sunlit-v1', destinationId: 'kyoto', title: 'Ninenzaka, sunlit lane',
        imageUrl: '/backgrounds/kyoto-ninenzaka-sunlit.jpg',
        composition: { focal: [0.5, 0.85], ground: { x: 0.48, y: 0.94, height: 0.6 }, sun: 'right', tint: '#ffe2b8' },
        credit: { author: 'Domenico Convertini', license: 'CC BY-SA 2.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0',
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:Gion_-_Nineizaka_(Ninenzaka),_Kyoto,_Japan_(48923334473).jpg' },
      },
    ],
  },
]

export const findBackground = (id: string) => DESTINATIONS.flatMap(d => d.backgrounds).find(b => b.id === id)

/** Match a team TripContext destination (id or name) to a Roamfit destination; undefined = no approved photo yet. */
export function matchDestination(team: { id?: string; name?: string } | undefined): DestinationOption | undefined {
  if (!team) return undefined
  const keys = [team.id, team.name].filter(Boolean).map(s => s!.toLowerCase().trim())
  return DESTINATIONS.find(d => keys.includes(d.id) || d.aliases.some(a => keys.includes(a)))
}

/** Adapter to the existing TurnaroundViewer composition type. */
export function toViewerDestination(bg: BackgroundAsset, destinationName: string): Destination {
  return { id: bg.id, name: destinationName, url: bg.imageUrl, ...bg.composition }
}
