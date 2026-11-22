export const walletDocument = () => ({ id: 'checkout-with-private-key', status: 'ready_for_complete', currency: 'USD',
  line_items: [{ id: 'line-one', item: { id: 'exact-variant', title: 'Everyday cotton shirt', price: 8000 }, quantity: 1 }],
  totals: [{ type: 'subtotal', display_text: 'Subtotal', amount: 8000 }, { type: 'discount', display_text: 'Discount', amount: -1000 },
    { type: 'fulfillment', display_text: 'Delivery', amount: 500 }, { type: 'tax', display_text: 'Tax', amount: 600 }, { type: 'total', display_text: 'Total', amount: 8100 }],
  fulfillment: { methods: [{ id: 'ship-one', type: 'shipping', destinations: [], groups: [{ id: 'group-one', options: [{ id: 'standard', title: 'Standard delivery', totals: [{ display_text: 'Delivery', amount: 500 }] }] }] }] },
  payment: { instruments: [{ id: 'wallet-one', type: 'shop_pay', handler_id: 'shop_pay', credential: { type: 'shop_token', token: 'private-test-instrument' }, extra: { keep: true } }] },
  messages: [{ type: 'warning', content: 'Final sale: please check the size.', path: '$.line_items[0]' }],
  links: [{ type: 'terms_of_service', title: 'Terms of sale', url: 'https://merchant.example/terms' }],
  continue_url: 'https://merchant.example/checkout?key=private&attribution=keep',
  buyer: { email: 'masked@example.test' }, unknown_future_field: { preserve: true }, next: ['read'], signals: {}, attribution: {} });
export const walletAccount = () => ({ addresses: [{ id: 'address-one', first_name: 'Demo', last_name: 'Shopper', street_address: '1 Example Way', address_locality: 'New York', address_region: 'NY', postal_code: '10001', address_country: 'US', provider_field: 'preserve' }],
  messages: [], links: [{ type: 'manage_connection', title: 'Manage on Shop', url: 'https://shop.com/account' }] });
