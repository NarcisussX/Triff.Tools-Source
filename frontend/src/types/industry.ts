/*
 * TypeScript type definitions for industry.
 * Exports shared frontend shapes used by React pages and API response handling.
 */

export type IndustryActivity = 'manufacturing' | 'reaction';

export interface IndustryGoal {
  typeId: number;
  typeName: string;
  quantity: number;
  costPerUnit: number;
  totalCost: number;
}

export type FacilityStructure =
  | 'NPC_STATION'
  | 'RAITARU'
  | 'AZBEL'
  | 'SOTIYO'
  | 'ATHANOR'
  | 'TATARA';

export type FacilityRig = 'NONE' | 'T1' | 'T2';

export type FacilitySecurity = 'HIGH' | 'LOW' | 'NULL_WH';

export interface FacilityConfig {
  structure: FacilityStructure;
  rig: FacilityRig;
  security: FacilitySecurity;
}

export interface IndustrySettings {
  systemCostIndexManufacturing: number;
  systemCostIndexReactions: number;
  facilityTax: number;
  sccSurcharge: number;
  includeReactions: boolean;
  additionalCost: number;

  productMe: number;
  componentMe: number;
  reactionMe: number;
  productFacility: FacilityConfig;
  componentFacility: FacilityConfig;
  reactionFacility: FacilityConfig;

  inputPriceMode: 'buy' | 'sell';
  outputPriceMode: 'buy' | 'sell';

  overrideRoutes?: Record<number, 'build' | 'buy'>;
}

export interface IndustrySummary {
  totalMaterialCost: number;
  totalJobCost: number;
  additionalCost: number;
  grandTotal: number;
}

export interface BomRow {
  typeId: number;
  typeName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface JobMaterial {
  typeId: number;
  typeName: string;
  quantity: number;
}

export interface FlatJob {
  id: string;
  activity: IndustryActivity;
  blueprintId: number;
  outputTypeId: number;
  outputTypeName: string;
  runs: number;
  productPerRun: number;
  outputQuantity: number;
  materials: JobMaterial[];
  eiv: number;
  jobCost: number;
  jobCostPerUnit: number;
}

export interface TreeNode {
  id: string;
  label: string;
  children: TreeNode[];
}

export interface IndustryStockUsage {
  typeId: number;
  typeName: string;
  available: number;
  applied: number;
  unused: number;
}

export interface IndustryPlanResponse {
  goals: IndustryGoal[];
  settings: IndustrySettings;
  summary: IndustrySummary;
  bom: BomRow[];
  jobs: FlatJob[];
  tree: TreeNode[];
  stockUsage?: IndustryStockUsage[];
}
