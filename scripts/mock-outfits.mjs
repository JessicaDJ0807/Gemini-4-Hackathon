import { validateOutfitRequest, validateOutfitResponse } from '../packages/contracts/outfit-plans.mjs';

export function mockOutfits(request) {
  validateOutfitRequest(request);
  const outfits = request.trip.weather.map((weather, index) => {
    const selected = [], missingItems = [];
    const pick = (category) => {
      const options = request.wardrobe.filter((item) => item.category === category);
      const item = options[index % options.length];
      if (item) selected.push(item.id);
      return item;
    };
    const gap = (category, description, priority, reason) => missingItems.push({
      id: `gap-${weather.date}-${category}`, description, searchQuery: description, priority, reason
    });
    const has = (category) => request.wardrobe.some((item) => item.category === category);
    // Prefer separates; wear a dress on odd days when one exists, or whenever separates are incomplete.
    const wantsDress = has('dress') && (!has('top') || !has('bottom') || index % 2 === 1);
    if (!(wantsDress && pick('dress'))) {
      if (!pick('top')) gap('top', 'An everyday top', 'essential', 'No top is selected in the demo wardrobe.');
      if (!pick('bottom')) gap('bottom', 'Everyday trousers', 'essential', 'No bottoms are selected in the demo wardrobe.');
    }
    if (!pick('shoes')) gap('shoes', 'Comfortable walking shoes', 'essential', 'No shoes are selected in the demo wardrobe.');
    const cold = weather.minTempC !== null && weather.minTempC < 12;
    if (cold && !pick('outerwear')) gap('outerwear', 'A warm outer layer', 'essential', 'The forecast low is below 12 °C; no outerwear is selected.');
    if (weather.minTempC !== null && weather.minTempC < 5) pick('accessory');
    if (weather.precipitationProbabilityPct !== null && weather.precipitationProbabilityPct >= 50) {
      gap('umbrella', 'A compact umbrella', 'optional', 'The forecast precipitation probability is at least 50%; check conditions.');
    }
    return {
      id: `look-${weather.date}`, date: weather.date, attractionIds: [], wardrobeItemIds: selected,
      rationale: `Mock combination ${index + 1} for ${request.trip.destination.name}, using the items you selected. ${cold ? 'A simple temperature rule adds an outer layer when available.' : 'Items rotate by category for this demo.'}`,
      missingItems, stylingTips: [weather.kind === 'unavailable' ? 'Weather is unavailable; check conditions before packing.' : 'Illustrations do not verify garment warmth or weather resistance.']
    };
  });
  return validateOutfitResponse({
    requestId: request.requestId, inputRevision: request.inputRevision, outfits,
    warnings: ['Mock outfits, not AI recommendations. Review all choices before use.',
      'Free-text preferences and avoidances are not interpreted by this mock. Uncheck unsuitable items.']
  }, request);
}
