import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  stores: (
    <>
      <path d="M3 10h18l-2-6H5l-2 6ZM5 10v10h14V10M9 20v-7h6v7" />
    </>
  ),
  catalog: (
    <>
      <path d="M4 5c3-1 5-1 8 1 3-2 5-2 8-1v14c-3-1-5-1-8 1-3-2-5-2-8-1V5ZM12 6v14" />
    </>
  ),
  inventory: (
    <>
      <path d="m3 7 9-4 9 4v10l-9 4-9-4V7ZM3 7l9 4 9-4M12 11v10" />
    </>
  ),
  orders: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3ZM9 8h6M9 12h6" />
    </>
  ),
  users: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3-6 8-6s8 2 8 6" />
    </>
  ),
  rental: (
    <>
      <path d="M4 5h13v14H4zM7 8h7M7 12h7M17 9h3v11h-9" />
    </>
  ),
  fulfillment: (
    <>
      <path d="M3 6h11v12H3zM14 10h4l3 3v5h-7M6 18a2 2 0 1 0 4 0M16 18a2 2 0 1 0 4 0" />
    </>
  ),
  content: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m10 8 6 4-6 4V8Z" />
    </>
  ),
  ai: (
    <>
      <path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z" />
    </>
  ),
  cms: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 9v12" />
    </>
  ),
  franchise: (
    <>
      <path d="M4 20V8l8-5 8 5v12M4 20h16M9 20v-7h6v7" />
    </>
  ),
  payments: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M6 15h4" />
    </>
  ),
  commission: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9c0-2 6-2 6 0s-6 2-6 4 6 2 6 0M12 6v12" />
    </>
  ),
  finance: (
    <>
      <path d="M4 20h16M6 16V9M11 16V5M16 16v-4M21 16V8" />
    </>
  ),
  staff: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19c0-4 2-6 6-6s6 2 6 6M17 8h5M19.5 5.5v5" />
    </>
  ),
  system: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
};

export function NavIcon({ name }: { name: string }) {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
