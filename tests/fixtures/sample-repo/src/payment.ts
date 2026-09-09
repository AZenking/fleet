import { getRate } from './config-driven.js';

export class PaymentService {
  charge(amount: number): number {
    const rate = getRate('default');
    return Math.round(amount * rate);
  }
}

export function parseInvoice(raw: string): { amount: number } {
  const match = /amount[:=]\s*(\d+(?:\.\d+)?)/.exec(raw);
  const amount = match ? Number(match[1]) : 0;
  return { amount };
}
