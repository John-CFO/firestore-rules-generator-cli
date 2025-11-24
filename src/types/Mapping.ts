//src/types/Mapping.ts
export type FieldMapping = {
  type?: string;
  required?: boolean;
};

export type SchemaMapping = {
  fields: Record<string, FieldMapping>;
  raw: string;
};

export type ZodMapping = Record<string, SchemaMapping>;
