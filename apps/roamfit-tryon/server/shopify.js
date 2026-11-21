import { demoProducts, scoreProduct } from './catalog.js'

const QUERY = `query Products($first: Int!, $query: String) {
  products(first: $first, query: $query) {
    nodes { id title handle productType tags featuredImage { url altText } priceRange { minVariantPrice { amount currencyCode } } }
  }
}`

export async function getProducts(outfitId, destinationId) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN, token = process.env.SHOPIFY_STOREFRONT_TOKEN
  if (!domain || !token) return { mode:'demo', products:demoProducts }
  const response = await fetch(`https://${domain}/api/2026-10/graphql.json`, {method:'POST',headers:{'content-type':'application/json','X-Shopify-Storefront-Access-Token':token},body:JSON.stringify({query:QUERY,variables:{first:20,query:'available_for_sale:true'}})})
  const json = await response.json()
  if (!response.ok || json.errors) throw new Error(`Shopify Storefront API: ${json.errors?.[0]?.message || response.status}`)
  const ranked = json.data.products.nodes.sort((a,b)=>scoreProduct(b,outfitId,destinationId)-scoreProduct(a,outfitId,destinationId)).slice(0,3)
  return { mode:'live', products:ranked.map(p=>({id:p.id,title:p.title,handle:p.handle,imageUrl:p.featuredImage?.url,price:p.priceRange.minVariantPrice.amount,currency:p.priceRange.minVariantPrice.currencyCode,reason:scoreProduct(p,outfitId,destinationId)>0?'Matched to trip and look':'Versatile travel piece',productUrl:`https://${domain}/products/${p.handle}`})) }
}

// Try-on integration: product search for a shopping gap. Returns raw Storefront nodes (normalized client-side by
// src/integration/shopifyAdapter.ts) or { mode: 'unconfigured' }. Never substitutes demo products.
const SEARCH_QUERY = `query Search($first: Int!, $query: String!) {
  products(first: $first, query: $query) {
    nodes { id handle title vendor productType tags onlineStoreUrl
      featuredImage { url altText } images(first: 4) { nodes { url altText } }
      priceRange { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
      variants(first: 25) { nodes { id title availableForSale price { amount currencyCode } selectedOptions { name value } image { url } } } }
  }
}`
export async function searchProducts(q, { first = 8 } = {}) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN, token = process.env.SHOPIFY_STOREFRONT_TOKEN
  if (!domain || !token) return { mode: 'unconfigured' }
  const query = `${String(q).slice(0, 120)} available_for_sale:true`
  const response = await fetch(`https://${domain}/api/2026-10/graphql.json`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Shopify-Storefront-Access-Token': token }, body: JSON.stringify({ query: SEARCH_QUERY, variables: { first: Math.min(first, 20), query } }), signal: AbortSignal.timeout(15_000) })
  const json = await response.json().catch(() => ({}))
  if (!response.ok || json.errors) throw new Error(`Shopify Storefront API: ${json.errors?.[0]?.message || response.status}`)
  return { mode: 'live', storeDomain: domain, nodes: json.data.products.nodes }
}
