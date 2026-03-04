import { createSemanticHook } from './useSemanticKey';
import { Action } from './registry';

/**
 * Semantic keyboard shortcut hooks
 *
 * These hooks provide a clean, semantic interface for common keyboard actions.
 * All key bindings are centrally managed in the registry.
 */

/**
 * Exit/Close action - typically Esc key
 *
 * @example
 * // In a dialog
 * useKeyExit(() => closeDialog(), { scope: Scope.DIALOG });
 *
 * @example
 * // In kanban board
 * useKeyExit(() => navigateToProjects(), { scope: Scope.KANBAN });
 */
export const useKeyExit = createSemanticHook(Action.EXIT);

/**
 * Create action - typically 'c' key
 *
 * @example
 * // Create new task
 * useKeyCreate(() => openTaskForm(), { scope: Scope.KANBAN });
 *
 * @example
 * // Create new project
 * useKeyCreate(() => openProjectForm(), { scope: Scope.PROJECTS });
 */
export const useKeyCreate = createSemanticHook(Action.CREATE);

/**
 * Submit action - typically Enter key
 *
 * @example
 * // Submit form in dialog
 * useKeySubmit(() => submitForm(), { scope: Scope.DIALOG });
 */
export const useKeySubmit = createSemanticHook(Action.SUBMIT);

/**
 * Focus search action - typically '/' key
 *
 * @example
 * useKeyFocusSearch(() => focusSearchInput(), { scope: Scope.KANBAN });
 */
export const useKeyFocusSearch = createSemanticHook(Action.FOCUS_SEARCH);

/**
 * Submit follow-up action - typically Cmd+Enter
 * Intelligently sends or queues based on current state (running vs idle)
 *
 * @example
 * useKeySubmitFollowUp(() => handleSubmit(), { scope: Scope.FOLLOW_UP_READY });
 */
export const useKeySubmitFollowUp = createSemanticHook(Action.SUBMIT_FOLLOW_UP);

/**
 * Submit task action - typically Cmd+Enter
 * Primary submit action in task dialog (Create & Start or Update)
 *
 * @example
 * useKeySubmitTask(() => handleSubmit(), { scope: Scope.DIALOG, when: canSubmit });
 */
export const useKeySubmitTask = createSemanticHook(Action.SUBMIT_TASK);

/**
 * Submit comment action - typically Cmd+Enter
 * Submit review comment in diff view
 *
 * @example
 * useKeySubmitComment(() => handleSave(), { scope: Scope.EDIT_COMMENT, when: hasContent });
 */
export const useKeySubmitComment = createSemanticHook(Action.SUBMIT_COMMENT);

/**
 * Cycle view backward action - typically Cmd+Shift+Enter
 * Cycle views backward in attempt area
 *
 * @example
 * useKeyCycleViewBackward(() => cycleBackward(), { scope: Scope.KANBAN });
 */
export const useKeyCycleViewBackward = createSemanticHook(
  Action.CYCLE_VIEW_BACKWARD
);

/**
 * Next notification action - typically 'n'
 * Open and clear the oldest task notification
 *
 * @example
 * useKeyNextNotification(() => resolveNextNotification(), { scope: Scope.KANBAN });
 */
export const useKeyNextNotification = createSemanticHook(
  Action.NEXT_NOTIFICATION
);
