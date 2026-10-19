import { useBranchContext, BranchType } from './useBranchContext';

export interface BrandingConfig {
  systemName: string;
  tagline: string;
  sidebarColor: string;
  logoAlt: string;
  logoSrc: string;
}

const brandingMap: Record<BranchType, BrandingConfig> = {
  pharmacy: {
    systemName: 'PharmaXpert',
    tagline: 'Pharmacy Management System',
    sidebarColor: 'bg-[hsl(187,38%,48%)]', // teal/pharma
    logoAlt: 'PharmaXpert Logo',
    logoSrc: '/stocxpert-uploads/SPharmacyIcon.svg',
  },
  general: {
    systemName: 'StockXpert',
    tagline: 'Inventory Management System',
    sidebarColor: 'bg-[hsl(220,60%,45%)]', // blue/business
    logoAlt: 'StockXpert Logo',
    logoSrc: '/stocxpert-uploads/SIcon.svg',
  },
};

export function useBranding(): BrandingConfig {
  const { branchType } = useBranchContext();
  return brandingMap[branchType];
}

/** Standalone helper when context isn't available (e.g. auth page) */
export function getBranding(type: BranchType): BrandingConfig {
  return brandingMap[type];
}
