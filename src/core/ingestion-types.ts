export type ParsingStrategy = "auto" | "delimited" | "whitespace" | "fixed-width";
export interface ImportOptions { strategy?: ParsingStrategy; delimiter?: string; boundaries?: number[]; headerRow?: number | null; }
export interface ColumnTransform { dateOrder?: "auto" | "ymd" | "dmy" | "mdy"; frequencyUnit?: "auto" | "MHz" | "kHz" | "Hz"; constant?: string; uppercase?: boolean; }
export interface ImportColumn { id: string; name: string; field: string; confidence: number; reasons: string[]; transform: ColumnTransform; locked?: boolean; }
export interface ImportRow { id: string; sourceIndex: number; original: string; cells: string[]; originalCells?: string[]; kind: "qso" | "header" | "comment" | "blank" | "metadata" | "summary"; included: boolean; warnings: string[]; errors?: string[]; }
export interface ParsingCandidate { id: string; strategy: Exclude<ParsingStrategy, "auto">; delimiter?: string; boundaries?: number[]; score: number; reasons: string[]; width: number; }
export type ImportRecipeStep = { kind: "add-column" } | { kind: "split"; index: number; separator: string; width: number } | { kind: "join"; indexes: number[] };
export interface ImportRecipe { baseSignature: string[]; steps: ImportRecipeStep[]; structured?: boolean; }
export interface ImportSession { source: string; options: ImportOptions; candidates: ParsingCandidate[]; selectedCandidateId: string; columns: ImportColumn[]; rows: ImportRow[]; metadata: Record<string, string>; warnings: string[]; userModified?: boolean; recipe?: ImportRecipe; }
export interface ImportIssue { code: string; message: string; severity: "error" | "warning"; rowId?: string; field?: string; }
export interface ValueProvenance { columnId: string; sourceIndex: number; original: string; normalized: string; confidence: number; transformations: string[]; classification?: "preserved" | "lossless-normalization" | "suggested-repair" | "user-supplied" | "ambiguous" | "unsupported"; }
export interface CanonicalRecord { id: string; sourceIndex: number; original: string; values: Record<string, string>; provenance: Record<string, ValueProvenance[]>; unmapped: Record<string, string>; issues: ImportIssue[]; }
export interface NormalizedImport { records: CanonicalRecord[]; metadata: Record<string, string>; issues: ImportIssue[]; warnings: string[]; }
export interface BuiltinImportPreset { id: string; name: string; signatures: string[][]; strategies: Exclude<ParsingStrategy, "auto">[]; headerAliases: Record<string, string>; fields: string[]; transforms: Record<string, ColumnTransform>; confidence: number; applicableFormats: string[]; }
