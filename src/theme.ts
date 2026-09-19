// Palette for "Conta com o Diguidas" — a professional SaaS look: strong
// orange brand, white/light-gray surfaces, and one distinct color per
// time category.
export const BrandColors = {
  // Brand
  primary: '#EA580C',
  primaryDark: '#C2410C',
  primaryLightBg: '#FFEDD5',

  // Surfaces
  background: '#F8FAFC',
  cardBg: '#FFFFFF',
  tableHeader: '#F1F5F9',
  tableHover: '#F8FAFC',
  border: '#E2E8F0',

  // Selected state
  selectedBg: '#FFF7ED',
  selectedBorder: '#EA580C',

  // Warnings / alerts
  warning: '#F59E0B',
  warningBg: '#FFFBEB',

  // Generic danger (connection errors, etc. — not a time category)
  danger: '#DC2626',

  // Time categories — used consistently across cards, chart bars and tables
  triage: '#6366F1', // organização e espera inicial
  queue: '#F59E0B', // aguardando ação
  developer: '#2563EB', // categoria principal
  user: '#22C55E', // validação/aprovação
  vendor: '#A855F7', // dependências externas
  general: '#06B6D4', // tempos variados
  total: '#1D4ED8', // visão executiva geral

  // Tags
  tagUserStoryBg: '#DBEAFE',
  tagUserStoryFg: '#1D4ED8',
  tagFeatureBg: '#EDE9FE',
  tagFeatureFg: '#7C3AED',
  tagActiveBg: '#DCFCE7',
  tagActiveFg: '#15803D',
  tagDoneBg: '#E5E7EB',
  tagDoneFg: '#374151',
} as const;
