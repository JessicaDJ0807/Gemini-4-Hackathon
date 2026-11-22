import '/shopping-chat.mjs';
import { validProfile } from '/contracts.mjs';
import { restoreSavedTrip } from '/shared/saved-trip.mjs';
import { placeDetails } from '/place-search.mjs';
import { attachOutfits } from '/outfits.mjs';

const flow = attachOutfits();
try {
  if (!validProfile(JSON.parse(sessionStorage.getItem('travel-stylist.confirmed-profile.v1')))) {
    window.location.replace('/');
  } else {
    const saved = JSON.parse(sessionStorage.getItem('travel-stylist.confirmed-trip.v1'));
    const trip = await restoreSavedTrip(saved, placeDetails);
    flow.setTrip(trip);
  }
} catch {
  document.getElementById('wardrobe-message').textContent = 'Your trip could not be loaded. Go back and confirm it again.';
  document.getElementById('wardrobe-unavailable').hidden = false;
} finally { document.getElementById('wardrobe-loading').hidden = true; }
// Back/forward navigation must not revive looks from an older trip or profile.
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
