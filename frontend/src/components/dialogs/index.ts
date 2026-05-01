// Global app dialogs
export { DisclaimerDialog } from './global/DisclaimerDialog';

export {
  ProjectEditorSelectionDialog,
  type ProjectEditorSelectionDialogProps,
} from './projects/ProjectEditorSelectionDialog';

// Task-related dialogs
export {
  TaskFormDialog,
  type TaskFormDialogProps,
} from './tasks/TaskFormDialog';
export {
  EditorSelectionDialog,
  type EditorSelectionDialogProps,
} from './tasks/EditorSelectionDialog';
export {
  DeleteTaskConfirmationDialog,
  type DeleteTaskConfirmationDialogProps,
} from './tasks/DeleteTaskConfirmationDialog';
export {
  TagEditDialog,
  type TagEditDialogProps,
  type TagEditResult,
} from './tasks/TagEditDialog';
export {
  ChangeTargetBranchDialog,
  type ChangeTargetBranchDialogProps,
  type ChangeTargetBranchDialogResult,
} from './tasks/ChangeTargetBranchDialog';
export {
  RestoreLogsDialog,
  type RestoreLogsDialogProps,
  type RestoreLogsDialogResult,
} from './tasks/RestoreLogsDialog';
export {
  ViewProcessesDialog,
  type ViewProcessesDialogProps,
} from './tasks/ViewProcessesDialog';
export {
  GitActionsDialog,
  type GitActionsDialogProps,
} from './tasks/GitActionsDialog';
export { CreateAttemptDialog } from './tasks/CreateAttemptDialog';

// Shared/Generic dialogs
export { ConfirmDialog, type ConfirmDialogProps } from './shared/ConfirmDialog';
export {
  FolderPickerDialog,
  type FolderPickerDialogProps,
} from './shared/FolderPickerDialog';
