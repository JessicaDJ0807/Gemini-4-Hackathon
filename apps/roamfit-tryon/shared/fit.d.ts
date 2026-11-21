export const CM_PER_IN: number
export function toCm(v: number | string | null | undefined, unit: 'cm' | 'in'): number | null
export function fromCm(v: number | null | undefined, unit: 'cm' | 'in'): number | null
export function round1(v: number | null): number
export type FitRow = { dim: string; label: string; body: number | null; garment: number | null; range?: [number, number]; ease: number | null; verdict: string; note: string }
export type FitResult = { size: string; provenance: string; rows: FitRow[]; warnings: string[]; evidence: string }
export function compareFit(body: Record<string, number | null>, garment: { category: string; stretch?: string; sizeChart?: any }, size: string | undefined): FitResult
export function suggestSize(body: Record<string, number | null>, garment: { category: string; sizeChart?: any }): { size: string | null; reason: string }
