import type { Metadata } from 'next';

import { PrototypeExperience } from '@/components/prototype/PrototypeExperience';

export const metadata: Metadata = {
  title: 'Aftershock — Commit QA prototype',
};

const sessions = [
  { id: 'cart', title: 'Cart persistence', sessionId: '416eefd1-49a8-4e26-85ed-815e81d86bbe' },
  { id: 'inventory', title: 'Inventory route', sessionId: 'ab5016e0-3a9f-4e42-9c05-3ebacd46d050' },
  { id: 'checkout', title: 'Checkout subtotal', sessionId: 'eaf251fe-b4f8-40dd-a332-95e63c498ab2' },
];

export default function PrototypePage() {
  return <PrototypeExperience sessions={sessions} />;
}
