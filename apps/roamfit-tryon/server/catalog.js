export const demoProducts = [
  { id:'demo-linen-shirt',title:'Air Linen Camp Shirt',handle:'air-linen-camp-shirt',price:'89.00',currency:'USD',reason:'Breathable hero layer',imageUrl:'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80' },
  { id:'demo-travel-trouser',title:'Easy Travel Trouser',handle:'easy-travel-trouser',price:'118.00',currency:'USD',reason:'Packable, relaxed tailoring',imageUrl:'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=800&q=80' },
  { id:'demo-sun-bag',title:'Woven Sun Bag',handle:'woven-sun-bag',price:'72.00',currency:'USD',reason:'Destination-ready accent',imageUrl:'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=80' },
]

export function scoreProduct(product, outfitId, destinationId) {
  const text = `${product.title} ${product.tags?.join(' ') || ''} ${product.productType || ''}`.toLowerCase()
  const terms = outfitId === 'coastal-linen' ? ['linen','shirt','trouser','sand','woven'] : ['jacket','black','dress','night','structured']
  const destinationTerms = destinationId === 'amalfi' ? ['summer','resort','beach'] : ['city','night','layer']
  return [...terms,...destinationTerms].reduce((n,term)=>n+(text.includes(term)?1:0),0)
}
