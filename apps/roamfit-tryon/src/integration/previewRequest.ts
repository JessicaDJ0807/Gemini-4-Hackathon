// B. Preview request builder: avatar + SelectedLook + garment index + background → TryOnPreviewRequestV1.
import { CONTRACT_VERSION, previewLookKey, validatePreviewRequest, type TryOnPreviewRequestV1, type ValidationError } from '../../shared/tryon/contract.js'
import type { BackgroundAsset } from './backgrounds'
import type { SelectionState } from './selection'
import type { GarmentIndex } from './teamAdapter'

export type AvatarInput = {
  mode: 'stylized' | 'realistic'
  creationMethod: 'text' | 'photo'
  description: string
  /** Upload id from POST /api/studio/upload (content-addressed), or 'demo-person-v1' for the bundled demo photo. */
  personMediaId: string | null
  approvedCharacterMediaId?: string
}

export type BuildInput = {
  requestId: string
  inputRevision: number
  avatar: AvatarInput
  selection: SelectionState
  index: GarmentIndex
  background: BackgroundAsset
  previewMode: 'photo' | 'turnaround'
  authorization?: TryOnPreviewRequestV1['authorization']
}

export type BuildResult = { request: TryOnPreviewRequestV1; lookKey: string; ok: boolean; errors: ValidationError[] }

export function buildPreviewRequest(i: BuildInput): BuildResult {
  const realistic = i.avatar.mode === 'realistic'
  const method = realistic ? 'photo' : i.avatar.creationMethod
  const desc = i.avatar.description.trim()
  const garments = i.selection.garmentIds.flatMap(id => { const g = i.index.get(id); return g ? [g] : [] })
  const request: TryOnPreviewRequestV1 = {
    contractVersion: CONTRACT_VERSION,
    requestId: i.requestId,
    inputRevision: i.inputRevision,
    avatar: {
      mode: i.avatar.mode,
      creationMethod: method,
      ...(desc ? { description: desc } : {}),
      ...(method === 'photo' && i.avatar.personMediaId ? { personMediaId: i.avatar.personMediaId } : {}),
      ...(i.avatar.approvedCharacterMediaId ? { approvedCharacterMediaId: i.avatar.approvedCharacterMediaId } : {}),
    },
    selectedLook: {
      garmentIds: [...i.selection.garmentIds],
      ...(i.selection.sourceOutfitId ? { sourceOutfitId: i.selection.sourceOutfitId } : {}),
      ...(i.selection.allowTopLayering ? { allowTopLayering: true } : {}),
    },
    garments,
    background: { id: i.background.id, destinationId: i.background.destinationId, imageUrl: i.background.imageUrl },
    previewMode: i.previewMode,
    ...(i.authorization ? { authorization: i.authorization } : {}),
  }
  const v = validatePreviewRequest(request)
  return { request, lookKey: previewLookKey(request), ok: v.ok, errors: v.errors }
}
