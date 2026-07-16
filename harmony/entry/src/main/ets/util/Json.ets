// Typed JSON helpers. Server frames arrive as strings; we parse them into
// Record<string, Object> and read fields through typeof-guarded accessors so the
// code stays free of `any` and survives ArkTS's strict type checks.

export function parseObj(text: string): Record<string, Object> {
  if (!text || text.length === 0) {
    return {};
  }
  try {
    const v: Object = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, Object>;
    }
    return {};
  } catch (e) {
    return {};
  }
}

export function jstr(o: Record<string, Object>, key: string, def: string = ''): string {
  const v: Object = o[key];
  return typeof v === 'string' ? (v as string) : def;
}

export function jnum(o: Record<string, Object>, key: string, def: number = 0): number {
  const v: Object = o[key];
  return typeof v === 'number' ? (v as number) : def;
}

export function jbool(o: Record<string, Object>, key: string, def: boolean = false): boolean {
  const v: Object = o[key];
  return typeof v === 'boolean' ? (v as boolean) : def;
}

export function jobj(o: Record<string, Object>, key: string): Record<string, Object> | null {
  const v: Object = o[key];
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, Object>;
  }
  return null;
}

export function jarr(o: Record<string, Object>, key: string): Record<string, Object>[] {
  const v: Object = o[key];
  const out: Record<string, Object>[] = [];
  if (Array.isArray(v)) {
    const arr: Object[] = v as Object[];
    for (const e of arr) {
      if (e && typeof e === 'object' && !Array.isArray(e)) {
        out.push(e as Record<string, Object>);
      }
    }
  }
  return out;
}
