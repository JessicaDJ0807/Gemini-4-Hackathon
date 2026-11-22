import { ApiError } from './style-analysis.mjs';

// Reject likely payment/contact data before it reaches chat history or a provider.
// This is a guard for shopping text, not a payment-data collection interface.
export function sensitiveShoppingText(value) {
  if (typeof value !== 'string') return false;
  const text = value.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
  return /(?:\d[\s-]*){13,}/.test(text) ||
    /\b(?:cvv|cvc|security code|card number|billing address|shipping address|iban|routing number)\b/i.test(text) ||
    /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(text);
}
export function validateShoppingChat(body) {
  if (!body || typeof body.requestId !== 'string' || !body.requestId.trim() || body.requestId.length > 128 ||
      !Number.isSafeInteger(body.inputRevision) || body.inputRevision < 0 ||
      typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000 ||
      (body.lastQuery !== undefined && (typeof body.lastQuery !== 'string' || body.lastQuery.length > 1000))) {
    throw new ApiError(400, 'INVALID_SHOPPING_MESSAGE', 'Describe the piece you’re looking for in up to 1,000 characters.');
  }
  if (sensitiveShoppingText(body.message) || sensitiveShoppingText(body.lastQuery)) {
    throw new ApiError(400, 'PRIVATE_PAYMENT_DETAILS', 'Please keep card, payment, and contact details out of chat. Use Shop Pay to manage payment details securely.');
  }
  return body;
}
