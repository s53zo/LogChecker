import { validAdifDate } from './adif-schema';
import type { NormalizedImport } from './ingestion-types';

/** Existing log headers take precedence; otherwise use selected valid QSO dates. */
export function importDateRange(document: Pick<NormalizedImport, 'records' | 'metadata'>): { start: string; end: string } {
  if (document.metadata.TDate) {
    const [start = '', end = ''] = document.metadata.TDate.split(';');
    return { start, end };
  }
  let start = '', end = '';
  for (const record of document.records) {
    const date = record.values.QSO_DATE ?? '';
    if (!validAdifDate(date)) continue;
    if (!start || date < start) start = date;
    if (!end || date > end) end = date;
  }
  return { start, end };
}
