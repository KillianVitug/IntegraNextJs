export const TABLE_PAGE_PARAM = "page";
export const TABLE_SEARCH_PARAM = "search";
export const LEGACY_TABLE_SEARCH_PARAM = "searchText";
export const TABLE_SORT_PARAM = "sort";
export const TABLE_SORT_DIR_PARAM = "dir";
export const TABLE_FILTER_PREFIX = "filter.";

export type TableSort = {
  id: string;
  desc: boolean;
};

export type TableQueryOptions = {
  page?: number;
  pageSize?: number;
  search?: string | null;
  filters?: Record<string, string | null | undefined>;
  sort?: TableSort | null;
};

export type ParsedTableQuery = {
  page: number;
  search: string;
  filters: Record<string, string>;
  sort: TableSort | null;
};

export function getFilterParamName(columnId: string) {
  return `${TABLE_FILTER_PREFIX}${columnId}`;
}

export function parseTableQueryParams(
  params: Record<string, string | undefined>,
  defaultSort: TableSort | null = null
): ParsedTableQuery {
  const filters: Record<string, string> = {};

  for (const [key, value] of Object.entries(params)) {
    if (!key.startsWith(TABLE_FILTER_PREFIX)) continue;

    const columnId = key.slice(TABLE_FILTER_PREFIX.length);
    const normalizedValue = normalizeSearchValue(value);

    if (columnId && normalizedValue) {
      filters[columnId] = normalizedValue;
    }
  }

  return {
    page: parsePositiveInt(params[TABLE_PAGE_PARAM], 1),
    search: normalizeSearchValue(
      params[TABLE_SEARCH_PARAM] ?? params[LEGACY_TABLE_SEARCH_PARAM]
    ),
    filters,
    sort: parseSort(params[TABLE_SORT_PARAM], params[TABLE_SORT_DIR_PARAM]) ?? defaultSort,
  };
}

export function normalizeTableQueryOptions(
  options: TableQueryOptions,
  defaultSort: TableSort | null = null
) {
  const filters: Record<string, string> = {};

  for (const [key, value] of Object.entries(options.filters ?? {})) {
    const normalizedValue = normalizeSearchValue(value);

    if (normalizedValue) {
      filters[key] = normalizedValue;
    }
  }

  return {
    page: Math.max(1, options.page ?? 1),
    pageSize: Math.max(1, options.pageSize ?? 50),
    search: normalizeSearchValue(options.search),
    filters,
    sort: options.sort ?? defaultSort,
  };
}

function parseSort(sortId?: string, dir?: string): TableSort | null {
  const id = normalizeSearchValue(sortId);

  if (!id) {
    return null;
  }

  return {
    id,
    desc: dir === "desc",
  };
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(1, parsed) : fallback;
}

function normalizeSearchValue(value?: string | null) {
  return value?.trim() ?? "";
}
