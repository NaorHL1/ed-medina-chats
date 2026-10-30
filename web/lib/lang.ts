'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Lang } from './format';

const KEY = 'cr_lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'he' || saved === 'en') return saved;
  } catch {
    // Storage can be blocked; fall back to the browser language.
  }
  return navigator.language?.toLowerCase().startsWith('he') ? 'he' : 'en';
}

/**
 * The page language. Starts from the saved choice, then the browser language, and sets the document's
 * lang and dir so Hebrew lays out right to left. The choice is kept in this browser only.
 */
export function useLang(): [Lang, (next: Lang) => void] {
  const [lang, setLangState] = useState<Lang>('he');

  useEffect(() => {
    setLangState(initialLang());
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Not saved; the page still switches for this visit.
    }
    setLangState(next);
  }, []);

  return [lang, setLang];
}
