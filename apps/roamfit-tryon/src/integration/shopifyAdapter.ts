// Shopify product adapter. Input: Storefront API product nodes (shape of server/shopify.js SEARCH_QUERY).
// MissingItem / shoppingGaps are NEEDS; only a normalized CommerceProduct with a chosen variant becomes a TryOnGarment.
// Nothing is invented: no image, size, price or merchant is filled in when Shopify did not return it.
import { GARMENT_CATEGORIES, type GarmentCategory, type Money, type TryOnGarment } from '../../shared/tryon/contract.js'

export type StorefrontProductNode = {
  id: string
  handle: string
  title: string
  vendor?: string | null
  productType?: string | null
  tags?: string[]
  onlineStoreUrl?: string | null
  featuredImage?: { url: string; altText?: string | null } | null
  images?: { nodes: { url: string; altText?: string | null }[] } | null
  priceRange?: { minVariantPrice: Money; maxVariantPrice?: Money } | null
  variants?: { nodes: StorefrontVariantNode[] } | null
}
export type StorefrontVariantNode = {
  id: string
  title: string
  availableForSale: boolean
  price?: Money | null
  selectedOptions?: { name: string; value: string }[]
  image?: { url: string } | null
}

export type CommerceVariant = { id: string; title: string; availableForSale: boolean; price?: Money; size?: string; color?: string; imageUrl?: string; options: { name: string; value: string }[] }
export type CommerceProduct = {
  source: 'shopify'
  productId: string
  handle: string
  title: string
  merchant?: string
  productType?: string
  tags: string[]
  productUrl: string
  imageUrl?: string
  images: string[]
  priceRange?: { min: Money; max?: Money }
  variants: CommerceVariant[]
  storeDomain: string
  /** The shopping gap this product was searched for, if any. Not proof that it fits the need. */
  matchedGapId?: string
}

const opt = (v: StorefrontVariantNode, re: RegExp) => v.selectedOptions?.find(o => re.test(o.name))?.value

export function normalizeStorefrontProduct(node: StorefrontProductNode, storeDomain: string, matchedGapId?: string): CommerceProduct {
  if (!node?.id || !node.handle || !node.title) throw new Error('Storefront product is missing id, handle or title')
  const images = [node.featuredImage?.url, ...(node.images?.nodes ?? []).map(i => i.url)].filter((u, i, a): u is string => !!u && a.indexOf(u) === i)
  return {
    source: 'shopify',
    productId: node.id,
    handle: node.handle,
    title: node.title,
    merchant: node.vendor || undefined,
    productType: node.productType || undefined,
    tags: node.tags ?? [],
    // Prefer the store's own URL; otherwise the canonical /products/<handle> on the configured domain.
    productUrl: node.onlineStoreUrl || `https://${storeDomain}/products/${node.handle}`,
    imageUrl: images[0],
    images,
    priceRange: node.priceRange ? { min: node.priceRange.minVariantPrice, max: node.priceRange.maxVariantPrice } : undefined,
    variants: (node.variants?.nodes ?? []).map(v => ({
      id: v.id, title: v.title, availableForSale: !!v.availableForSale, price: v.price ?? undefined,
      size: opt(v, /^size$/i), color: opt(v, /^(colou?r)$/i), imageUrl: v.image?.url, options: v.selectedOptions ?? [],
    })),
    storeDomain,
    matchedGapId,
  }
}

const TYPE_MAP: [RegExp, GarmentCategory][] = [
  [/\b(dress|jumpsuit)\b/i, 'dress'],
  [/\b(coat|jacket|blazer|cardigan|parka|trench|vest|gilet|raincoat)\b/i, 'outerwear'],
  [/\b(shoe|sneaker|boot|sandal|loafer|trainer|heel|flat)s?\b/i, 'shoes'],
  [/\b(pant|trouser|jean|skirt|short|legging|chino)s?\b/i, 'bottom'],
  [/\b(shirt|tee|t-shirt|top|blouse|sweater|knit|hoodie|polo|tank)s?\b/i, 'top'],
  [/\b(bag|scarf|hat|cap|belt|sunglasses|jewel|necklace|earring|watch|umbrella|tote)s?\b/i, 'accessory'],
]

/** Best-effort category from productType/tags/title. Returns undefined when ambiguous; the UI must then ask the user. */
export function inferCategory(p: Pick<CommerceProduct, 'productType' | 'tags' | 'title'>, hint?: string | null): GarmentCategory | undefined {
  if (hint && GARMENT_CATEGORIES.includes(hint as GarmentCategory)) return hint as GarmentCategory
  for (const text of [p.productType, p.tags.join(' '), p.title]) {
    if (!text) continue
    const hits = new Set(TYPE_MAP.filter(([re]) => re.test(text)).map(([, c]) => c))
    if (hits.size === 1) return [...hits][0]
    if (hits.size > 1) return undefined
  }
  return undefined
}

export type ProductToGarmentResult = { ok: true; garment: TryOnGarment } | { ok: false; code: 'VARIANT_REQUIRED' | 'VARIANT_UNKNOWN' | 'IMAGE_MISSING' | 'CATEGORY_REQUIRED'; message: string }

/**
 * Turn a chosen variant into a TryOnGarment. A product with several variants requires an explicit variantId.
 * Image: the variant's own image if Shopify has one, else the product image. Never a placeholder.
 */
export function productToGarment(p: CommerceProduct, choice: { variantId?: string; category?: GarmentCategory }): ProductToGarmentResult {
  let variant: CommerceVariant | undefined
  if (choice.variantId) {
    variant = p.variants.find(v => v.id === choice.variantId)
    if (!variant) return { ok: false, code: 'VARIANT_UNKNOWN', message: `${p.title}: variant ${choice.variantId} does not belong to this product` }
  } else if (p.variants.length === 1) variant = p.variants[0]
  else return { ok: false, code: 'VARIANT_REQUIRED', message: `${p.title}: choose a size/colour before adding it to the look` }
  if (!variant) return { ok: false, code: 'VARIANT_REQUIRED', message: `${p.title}: Shopify returned no variants` }
  const imageUrl = variant.imageUrl || p.imageUrl
  if (!imageUrl) return { ok: false, code: 'IMAGE_MISSING', message: `${p.title}: Shopify returned no product image, so it cannot be previewed` }
  const category = choice.category ?? inferCategory(p)
  if (!category) return { ok: false, code: 'CATEGORY_REQUIRED', message: `${p.title}: pick a category (top, bottom, …) before adding it` }
  return {
    ok: true,
    garment: {
      id: `shopify:${variant.id}`,
      category,
      name: p.title,
      imageUrl,
      source: 'shopify',
      productId: p.productId,
      variantId: variant.id,
      productUrl: p.productUrl,
      selectedSize: variant.size,
      color: variant.color,
      merchant: p.merchant,
      price: variant.price,
      imageStatus: 'ok',
      origin: { kind: 'shopify', ref: p.productId },
    },
  }
}
