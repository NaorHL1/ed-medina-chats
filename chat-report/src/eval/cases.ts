import type { SyntheticSpec } from '../synthetic.js';
import type { DateOrder, Platform } from '../types.js';

/**
 * One synthetic export in the eval set. Each planted pattern is written into the spec,
 * so the truth is known. Controls plant nothing and must produce no detections.
 */
export interface EvalCase {
  id: string;
  spec: SyntheticSpec;
  platform: Platform;
  dateOrder: DateOrder;
  android12h?: boolean;
}

const BASE: Omit<SyntheticSpec, 'seed' | 'language'> = {
  startDate: '2026-10-01',
  days: 30,
  people: ['Naor', 'Dana'],
  conversationsPerDay: 2,
  firstPersonOpenRate: 0.5,
};

export const EVAL_CASES: EvalCase[] = [
  { id: 'control-ios-en', spec: { ...BASE, seed: 101, language: 'en' }, platform: 'ios', dateOrder: 'dmy' },
  { id: 'control-android-he', spec: { ...BASE, seed: 102, language: 'he' }, platform: 'android', dateOrder: 'dmy', android12h: true },
  {
    id: 'joke-ios-en',
    spec: { ...BASE, seed: 103, language: 'en', insideJoke: 'pineapple express' },
    platform: 'ios',
    dateOrder: 'mdy',
  },
  {
    id: 'joke-android-he',
    spec: { ...BASE, seed: 104, language: 'he', insideJoke: 'פיצה חמה' },
    platform: 'android',
    dateOrder: 'dmy',
  },
  { id: 'fight-ios-en', spec: { ...BASE, seed: 105, language: 'en', fightDay: 15 }, platform: 'ios', dateOrder: 'dmy' },
  { id: 'fight-android-he', spec: { ...BASE, seed: 106, language: 'he', fightDay: 20 }, platform: 'android', dateOrder: 'dmy', android12h: true },
  {
    id: 'slow-ios-en',
    spec: { ...BASE, seed: 107, language: 'en', slowReplyFromDay: 15 },
    platform: 'ios',
    dateOrder: 'dmy',
  },
  {
    id: 'slow-android-he',
    spec: { ...BASE, seed: 108, language: 'he', slowReplyFromDay: 12 },
    platform: 'android',
    dateOrder: 'mdy',
  },
  { id: 'quiet-ios-en', spec: { ...BASE, seed: 109, language: 'en', quietFromDay: 18 }, platform: 'ios', dateOrder: 'dmy' },
  { id: 'quiet-android-he', spec: { ...BASE, seed: 110, language: 'he', quietFromDay: 14 }, platform: 'android', dateOrder: 'dmy' },
  {
    id: 'combo-ios-en',
    spec: { ...BASE, seed: 111, days: 60, language: 'en', insideJoke: 'pineapple express', fightDay: 30, slowReplyFromDay: 40 },
    platform: 'ios',
    dateOrder: 'mdy',
  },
  {
    id: 'combo-android-he',
    spec: { ...BASE, seed: 112, days: 60, language: 'he', insideJoke: 'פיצה חמה', quietFromDay: 45 },
    platform: 'android',
    dateOrder: 'dmy',
    android12h: true,
  },
];

/**
 * Held-out set. Written after the detectors were tuned on EVAL_CASES, and not used for tuning.
 * A pass here is the honest number; a fail means the detectors overfit the dev set.
 */
export const HOLDOUT_CASES: EvalCase[] = [
  { id: 'holdout-control-ios-he', spec: { ...BASE, seed: 201, language: 'he' }, platform: 'ios', dateOrder: 'dmy' },
  { id: 'holdout-control-android-en', spec: { ...BASE, seed: 202, language: 'en' }, platform: 'android', dateOrder: 'mdy', android12h: true },
  {
    id: 'holdout-joke-ios-en',
    spec: { ...BASE, seed: 203, language: 'en', insideJoke: 'road trip' },
    platform: 'ios',
    dateOrder: 'dmy',
  },
  {
    id: 'holdout-joke-android-he',
    spec: { ...BASE, seed: 204, language: 'he', insideJoke: 'נדבר בבוקר' },
    platform: 'android',
    dateOrder: 'mdy',
  },
  {
    id: 'holdout-slow-android-en',
    spec: { ...BASE, seed: 205, language: 'en', slowReplyFromDay: 10 },
    platform: 'android',
    dateOrder: 'dmy',
    android12h: true,
  },
  {
    id: 'holdout-quiet-ios-he',
    spec: { ...BASE, seed: 206, language: 'he', quietFromDay: 20 },
    platform: 'ios',
    dateOrder: 'mdy',
  },
  {
    id: 'holdout-combo-ios-en',
    spec: { ...BASE, seed: 207, days: 60, language: 'en', insideJoke: 'road trip', slowReplyFromDay: 35, quietFromDay: 50 },
    platform: 'ios',
    dateOrder: 'dmy',
  },
  {
    id: 'holdout-control-android-he-2',
    spec: { ...BASE, seed: 208, days: 60, language: 'he', firstPersonOpenRate: 0.7 },
    platform: 'android',
    dateOrder: 'dmy',
    android12h: true,
  },
];
