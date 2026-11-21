export const wardrobeVersion = 'demo-wardrobe-v1';
// Original illustrative assets; these are fictional garments, not product listings.
export const wardrobe = [
  { id: 'top-01', name: 'Cream sweater', category: 'top', color: 'cream', styleTags: ['minimal', 'classic'] },
  { id: 'top-02', name: 'Navy shirt', category: 'top', color: 'navy', styleTags: ['classic'] },
  { id: 'top-03', name: 'White T-shirt', category: 'top', color: 'white', styleTags: ['casual', 'minimal'] },
  { id: 'bottom-01', name: 'Black trousers', category: 'bottom', color: 'black', styleTags: ['minimal', 'classic'] },
  { id: 'bottom-02', name: 'Blue jeans', category: 'bottom', color: 'blue', styleTags: ['casual'] },
  { id: 'outer-01', name: 'Beige coat', category: 'outerwear', color: 'beige', styleTags: ['classic', 'minimal'] },
  { id: 'shoes-01', name: 'White sneakers', category: 'shoes', color: 'white', styleTags: ['casual', 'sporty'] },
  { id: 'shoes-02', name: 'Black ankle boots', category: 'shoes', color: 'black', styleTags: ['classic'] },
  { id: 'accessory-01', name: 'Gray scarf', category: 'accessory', color: 'gray', styleTags: ['minimal'] }
].map((item) => ({ ...item, imageUrl: `/wardrobe/${item.id}.svg` }));
