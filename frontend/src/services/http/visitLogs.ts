export interface VisitLogPage<Row = Record<string, unknown>> {
  data: Row[];
  total: number;
  page: number;
  limit: number;
}
