"use client";

import {
  getFilterParamName,
  TABLE_FILTER_PREFIX,
  TABLE_PAGE_PARAM,
  TABLE_SORT_DIR_PARAM,
  TABLE_SORT_PARAM,
  type TableSort,
} from "@/lib/queries/tableQuery";
import type {
  ColumnFiltersState,
  OnChangeFn,
  SortingState,
} from "@tanstack/react-table";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

type Options = {
  defaultSort: TableSort;
  filterColumnIds: string[];
};

export function useServerTableUrlState({
  defaultSort,
  filterColumnIds,
}: Options) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();

  const replaceParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParamString);
      mutate(params);

      const nextQuery = params.toString();
      if (nextQuery === searchParamString) {
        return;
      }

      router.replace(nextQuery ? `?${nextQuery}` : "?", { scroll: false });
    },
    [router, searchParamString]
  );

  const pageIndex = useMemo(() => {
    const page = searchParams.get(TABLE_PAGE_PARAM);
    const parsed = page ? Number.parseInt(page, 10) : 1;

    return Number.isFinite(parsed) ? Math.max(0, parsed - 1) : 0;
  }, [searchParams]);

  const sorting = useMemo<SortingState>(() => {
    const sortId = searchParams.get(TABLE_SORT_PARAM);

    if (!sortId) {
      return [defaultSort];
    }

    return [
      {
        id: sortId,
        desc: searchParams.get(TABLE_SORT_DIR_PARAM) === "desc",
      },
    ];
  }, [defaultSort, searchParams]);

  const columnFilters = useMemo<ColumnFiltersState>(() => {
    return filterColumnIds
      .map((columnId) => ({
        id: columnId,
        value: searchParams.get(getFilterParamName(columnId)) ?? "",
      }))
      .filter((filter) => filter.value);
  }, [filterColumnIds, searchParams]);

  const getColumnFilterValue = useCallback(
    (columnId: string) => searchParams.get(getFilterParamName(columnId)) ?? "",
    [searchParams]
  );

  const setColumnFilterValue = useCallback(
    (columnId: string, value: string) => {
      replaceParams((params) => {
        const nextValue = value.trim();
        params.set(TABLE_PAGE_PARAM, "1");

        if (nextValue) {
          params.set(getFilterParamName(columnId), nextValue);
        } else {
          params.delete(getFilterParamName(columnId));
        }
      });
    },
    [replaceParams]
  );

  const onSortingChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const nextSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      const nextSort = nextSorting[0];

      replaceParams((params) => {
        params.set(TABLE_PAGE_PARAM, "1");

        if (!nextSort) {
          params.delete(TABLE_SORT_PARAM);
          params.delete(TABLE_SORT_DIR_PARAM);
          return;
        }

        params.set(TABLE_SORT_PARAM, nextSort.id);
        params.set(TABLE_SORT_DIR_PARAM, nextSort.desc ? "desc" : "asc");
      });
    },
    [replaceParams, sorting]
  );

  const setPageIndex = useCallback(
    (pageIndex: number) => {
      replaceParams((params) => {
        params.set(TABLE_PAGE_PARAM, String(Math.max(0, pageIndex) + 1));
      });
    },
    [replaceParams]
  );

  const resetSorting = useCallback(() => {
    replaceParams((params) => {
      params.set(TABLE_PAGE_PARAM, "1");
      params.delete(TABLE_SORT_PARAM);
      params.delete(TABLE_SORT_DIR_PARAM);
    });
  }, [replaceParams]);

  const resetColumnFilters = useCallback(() => {
    replaceParams((params) => {
      params.set(TABLE_PAGE_PARAM, "1");

      for (const key of Array.from(params.keys())) {
        if (key.startsWith(TABLE_FILTER_PREFIX)) {
          params.delete(key);
        }
      }
    });
  }, [replaceParams]);

  return {
    router,
    searchParams,
    pageIndex,
    sorting,
    columnFilters,
    getColumnFilterValue,
    setColumnFilterValue,
    onSortingChange,
    setPageIndex,
    resetSorting,
    resetColumnFilters,
  };
}
