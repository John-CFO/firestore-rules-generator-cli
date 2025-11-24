//src/types/Config.ts
export type CollectionConfig = {
  path: string;
  ownerField?: string;
  schema?: string;
  customChecks?: string[];
  subcollections?: CollectionConfig[];
};

export type RulesConfig = {
  collections: CollectionConfig[];
};
