# Shared Contracts

This is the integration boundary among the app, AI, and 3D modules. **Agree on schemas first, then freeze a v1 for the demo.** Prefer JSON Schema / typed definitions and example payloads in this directory.

## Core types (conceptual)

```ts
type StyleProfile = {
  aesthetics: string[];
  colors: string[];
  silhouettes: string[];
  stylingPatterns: string[];
  avoidances?: string[];
  visualReferenceIds: string[];
};

type WardrobeItem = {
  id: string;
  imageUrl: string;
  category: string;
  color?: string;
  styleTags?: string[];
  avatarAssetId?: string;
};

type TripContext = {
  destination: string;
  startDate: string;
  endDate: string;
  attractionsByDay: Record<string, string[]>;
  weatherByDay: Record<string, unknown>;
  optionalInspirationIds?: string[];
};

type MissingItem = {
  id: string; // unique within the response
  description: string;
  searchQuery: string;
  priority: 'essential' | 'optional';
  reason: string;
  category?: string;
};

type DailyOutfit = {
  id: string;
  date: string;
  attractionIds: string[];
  wardrobeItemIds: string[];
  missingItems: MissingItem[];
  rationale: string;
};
```

`avatarAssetId` is optional because not every real garment can be represented exactly by the prepared 3D catalog. Person C should define fallback mapping and report unsupported garments. AI responses should use IDs, not fabricated clothing images or products. Checkout state belongs to Person B, not the outfit planning response.

## Contract rules

- Use ISO dates and stable IDs; validate all referenced IDs server-side.
- Version endpoints and schemas when changes break another workstream.
- Store uploaded media securely and pass references, not raw binary, through shared data objects.
- `missingItems` are *needs*, not Shopify products; commerce resolves actual listings.
- Generated images are illustrative, not guaranteed to depict precise fit or real destination conditions.
