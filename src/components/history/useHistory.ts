'use client';

import { useEffect, useState } from 'react';
import { readHistory, subscribeHistory, type HistoryData } from '@/lib/history';

const EMPTY: HistoryData = { recent: [], bookmarks: [] };

/** The two lists, read after mount (storage does not exist while the page is built) and kept live. */
export function useHistory(): HistoryData {
  const [data, setData] = useState<HistoryData>(EMPTY);
  useEffect(() => {
    const load = () => setData(readHistory());
    load();
    return subscribeHistory(load);
  }, []);
  return data;
}
