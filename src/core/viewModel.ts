/**
 * What the sidebar shows, computed in core so it can be tested without a webview.
 *
 * One view remains. The hint-ladder card and the lesson card were retired when chat became the
 * single teaching surface — two UIs whose appearance depended on whether a model was configured was
 * the unscalable part. The conversation renders from chat state directly; only the lesson list
 * needs shaping, because "which lesson is current" is a rule, not a rendering detail.
 */

export interface CourseMenuView {
  kind: 'menu';
  heading: string;
  subheading: string;
  progress: { done: number; total: number };
  lessons: Array<{ id: string; title: string; goal: string; done: boolean; current: boolean }>;
  /** Shown when no model is configured — the course works regardless. */
  setupNotice: string | null;
}
