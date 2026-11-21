// Shared selected-outfit state: ONE normalized source of truth (SelectedLook) + a pure reducer.
//
// Conflict policy (deterministic, "latest tap wins"):
//   • dress ⇄ top/bottom: adding a dress removes any top and bottom; adding a top or bottom removes the dress.
//   • bottom, dress, outerwear, shoes: one each; adding another REPLACES the previous one.
//   • top: one, replaced on tap. Two only when layering is on (enabled when a recommended look layers tops, or by the user).
//   • accessory: up to 3; a 4th is REJECTED (nothing is silently removed).
// Every change that removes something returns a notice so the UI can say what happened.
import { CATEGORY_LIMITS, LAYERED_TOP_LIMIT, type SelectedLook, type TryOnGarment } from '../../shared/tryon/contract.js'
import type { GarmentIndex, LookCard } from './teamAdapter'

export type SelectionState = SelectedLook & { allowTopLayering: boolean }
export type SelectionResult = { state: SelectionState; notice?: string; changed: boolean }

export const emptySelection = (): SelectionState => ({ garmentIds: [], allowTopLayering: false })

const names = (ids: string[], index: GarmentIndex) => ids.map(id => index.get(id)?.name ?? id).join(', ')

export function addGarment(state: SelectionState, g: TryOnGarment, index: GarmentIndex): SelectionResult {
  if (state.garmentIds.includes(g.id)) return { state, changed: false }
  let ids = [...state.garmentIds]
  const removed: string[] = []
  const drop = (pred: (x: TryOnGarment) => boolean) => { ids = ids.filter(id => { const x = index.get(id); if (x && pred(x)) { removed.push(id); return false } return true }) }
  const ofCat = (c: string) => ids.filter(id => index.get(id)?.category === c)

  if (g.category === 'dress') drop(x => x.category === 'top' || x.category === 'bottom' || x.category === 'dress')
  else if (g.category === 'top' || g.category === 'bottom') drop(x => x.category === 'dress')

  if (g.category === 'accessory') {
    if (ofCat('accessory').length >= CATEGORY_LIMITS.accessory) return { state, changed: false, notice: `You can add up to ${CATEGORY_LIMITS.accessory} accessories. Remove one first.` }
  } else if (g.category === 'top') {
    const tops = ofCat('top')
    const max = state.allowTopLayering ? LAYERED_TOP_LIMIT : CATEGORY_LIMITS.top
    if (tops.length >= max) { const victim = tops[0]; ids = ids.filter(id => id !== victim); removed.push(victim) }
  } else if (g.category !== 'dress') {
    drop(x => x.category === g.category)
  }
  ids.push(g.id)
  // Selecting manually keeps the source-look attribution only while the selection is unchanged from it.
  const next: SelectionState = { ...state, garmentIds: ids, sourceOutfitId: undefined }
  return { state: next, changed: true, notice: removed.length ? `${g.name} replaced ${names(removed, index)}.` : undefined }
}

export function removeGarment(state: SelectionState, id: string): SelectionResult {
  if (!state.garmentIds.includes(id)) return { state, changed: false }
  return { state: { ...state, garmentIds: state.garmentIds.filter(x => x !== id), sourceOutfitId: undefined }, changed: true }
}

export function toggleGarment(state: SelectionState, g: TryOnGarment, index: GarmentIndex): SelectionResult {
  return state.garmentIds.includes(g.id) ? removeGarment(state, g.id) : addGarment(state, g, index)
}

export function setTopLayering(state: SelectionState, on: boolean, index: GarmentIndex): SelectionResult {
  if (state.allowTopLayering === on) return { state, changed: false }
  if (on) return { state: { ...state, allowTopLayering: true }, changed: true }
  const tops = state.garmentIds.filter(id => index.get(id)?.category === 'top')
  const drop = tops.slice(0, Math.max(0, tops.length - 1))
  return {
    state: { ...state, allowTopLayering: false, garmentIds: state.garmentIds.filter(id => !drop.includes(id)), sourceOutfitId: drop.length ? undefined : state.sourceOutfitId },
    changed: true, notice: drop.length ? `Layering off: removed ${names(drop, index)}.` : undefined,
  }
}

/**
 * Load a recommended look. Only IDs that resolve are loaded; unresolved IDs are reported, never substituted.
 * Recommendations are taken as-is (including intentional top layering); if a look still breaks a single-slot rule,
 * the first item per slot is kept and the rest are reported.
 */
export function applyLook(look: LookCard, index: GarmentIndex): SelectionResult & { unavailableIds: string[]; skippedIds: string[] } {
  const allowTopLayering = look.layeredTops
  let state: SelectionState = { garmentIds: [], allowTopLayering, sourceOutfitId: look.id }
  const skipped: string[] = []
  for (const id of look.garmentIds) {
    const g = index.get(id)!
    const before = state.garmentIds.length
    const r = addGarment(state, g, index)
    if (!r.changed || r.state.garmentIds.length <= before) { skipped.push(id); continue } // would have replaced something
    state = { ...r.state, sourceOutfitId: look.id }
  }
  const parts: string[] = []
  if (look.unavailableIds.length) parts.push(`Unavailable in your wardrobe: ${look.unavailableIds.join(', ')}`)
  if (skipped.length) parts.push(`Not loaded (conflicts with the look's other pieces): ${names(skipped, index)}`)
  return { state, changed: true, unavailableIds: look.unavailableIds, skippedIds: skipped, notice: parts.join('. ') || undefined }
}

export function selectedGarments(state: SelectedLook, index: GarmentIndex): TryOnGarment[] {
  return state.garmentIds.map(id => index.get(id)).filter((g): g is TryOnGarment => !!g)
}
