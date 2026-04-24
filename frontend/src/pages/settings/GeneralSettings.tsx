import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cloneDeep, merge, isEqual } from 'lodash';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Volume2 } from 'lucide-react';
import {
  EditorType,
  SoundFile,
  ThemeMode,
  UiLanguage,
} from 'shared/types';
import { getLanguageOptions } from '@/i18n/languages';

import { toPrettyCase } from '@/utils/string';
import { useEditorAvailability } from '@/hooks/useEditorAvailability';
import { EditorAvailabilityIndicator } from '@/components/EditorAvailabilityIndicator';
import { useTheme } from '@/components/ThemeProvider';
import { useUserSystem } from '@/components/ConfigProvider';
import { TagManager } from '@/components/TagManager';

export function GeneralSettings() {
  const { t } = useTranslation(['settings', 'common']);

  // Get language options with proper display names
  const languageOptions = getLanguageOptions(
    t('language.browserDefault', {
      ns: 'common',
      defaultValue: 'Browser Default',
    })
  );
  const {
    config,
    loading,
    updateAndSaveConfig, // Use this on Save
  } = useUserSystem();

  // Draft state management
  const [draft, setDraft] = useState(() => (config ? cloneDeep(config) : null));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchPrefixError, setBranchPrefixError] = useState<string | null>(
    null
  );
  const latestDraftRef = useRef(draft);
  const saveSeqRef = useRef(0);
  const { setTheme } = useTheme();

  // Check editor availability when draft editor changes
  const editorAvailability = useEditorAvailability(draft?.editor.editor_type);

  const validateBranchPrefix = useCallback(
    (prefix: string): string | null => {
      if (!prefix) return null; // empty allowed
      if (prefix.includes('/'))
        return t('settings.general.git.branchPrefix.errors.slash');
      if (prefix.startsWith('.'))
        return t('settings.general.git.branchPrefix.errors.startsWithDot');
      if (prefix.endsWith('.') || prefix.endsWith('.lock'))
        return t('settings.general.git.branchPrefix.errors.endsWithDot');
      if (prefix.includes('..') || prefix.includes('@{'))
        return t('settings.general.git.branchPrefix.errors.invalidSequence');
      if (/[ \t~^:?*[\\]/.test(prefix))
        return t('settings.general.git.branchPrefix.errors.invalidChars');
      // Control chars check
      for (let i = 0; i < prefix.length; i++) {
        const code = prefix.charCodeAt(i);
        if (code < 0x20 || code === 0x7f)
          return t('settings.general.git.branchPrefix.errors.controlChars');
      }
      return null;
    },
    [t]
  );

  // When config loads or changes externally, update draft only if not dirty
  useEffect(() => {
    if (!config) return;
    if (!dirty) {
      setDraft(cloneDeep(config));
    }
  }, [config, dirty]);

  useEffect(() => {
    latestDraftRef.current = draft;
  }, [draft]);

  // Generic draft update helper
  const updateDraft = useCallback(
    (patch: Partial<typeof config>) => {
      setDraft((prev: typeof config) => {
        if (!prev) return prev;
        const next = merge({}, prev, patch);
        // Mark dirty if changed
        if (!isEqual(next, config)) {
          setDirty(true);
        }
        return next;
      });
    },
    [config]
  );

  const playSound = async (soundFile: SoundFile) => {
    const audio = new Audio(`/api/sounds/${soundFile}`);
    try {
      await audio.play();
    } catch (err) {
      console.error('Failed to play sound:', err);
    }
  };

  useEffect(() => {
    if (!draft || !config || !dirty || branchPrefixError) return;
    if (isEqual(draft, config)) {
      setDirty(false);
      return;
    }

    const saveSnapshot = cloneDeep(draft);
    ++saveSeqRef.current;
    const timer = window.setTimeout(async () => {
      setError(null);

      try {
        const saved = await updateAndSaveConfig(saveSnapshot);
        if (!saved) {
          setError(t('settings.general.save.error'));
          return;
        }

        if (isEqual(latestDraftRef.current, saveSnapshot)) {
          setTheme(saveSnapshot.theme);
          setDirty(false);
        }
      } catch (err) {
        setError(t('settings.general.save.error'));
        console.error('Error saving config:', err);
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [
    branchPrefixError,
    config,
    dirty,
    draft,
    setTheme,
    t,
    updateAndSaveConfig,
  ]);

  const resetDisclaimer = async () => {
    if (!config) return;
    updateAndSaveConfig({ disclaimer_acknowledged: false });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">{t('settings.general.loading')}</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="py-8">
        <Alert variant="destructive">
          <AlertDescription>{t('settings.general.loadError')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('settings.general.appearance.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="theme">
              {t('settings.general.appearance.theme.label')}
            </Label>
            <Select
              value={draft?.theme}
              onValueChange={(value: ThemeMode) =>
                updateDraft({ theme: value })
              }
            >
              <SelectTrigger id="theme">
                <SelectValue
                  placeholder={t(
                    'settings.general.appearance.theme.placeholder'
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {Object.values(ThemeMode).map((theme) => (
                  <SelectItem key={theme} value={theme}>
                    {toPrettyCase(theme)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="language">
              {t('settings.general.appearance.language.label')}
            </Label>
            <Select
              value={draft?.language}
              onValueChange={(value: UiLanguage) =>
                updateDraft({ language: value })
              }
            >
              <SelectTrigger id="language">
                <SelectValue
                  placeholder={t(
                    'settings.general.appearance.language.placeholder'
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {languageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('settings.general.editor.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="editor-type">
              {t('settings.general.editor.type.label')}
            </Label>
            <Select
              value={draft?.editor.editor_type}
              onValueChange={(value: EditorType) =>
                updateDraft({
                  editor: { ...draft!.editor, editor_type: value },
                })
              }
            >
              <SelectTrigger id="editor-type">
                <SelectValue
                  placeholder={t('settings.general.editor.type.placeholder')}
                />
              </SelectTrigger>
              <SelectContent>
                {Object.values(EditorType).map((editor) => (
                  <SelectItem key={editor} value={editor}>
                    {toPrettyCase(editor)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Editor availability status indicator */}
            {draft?.editor.editor_type !== EditorType.CUSTOM && (
              <EditorAvailabilityIndicator availability={editorAvailability} />
            )}

            <p className="text-sm text-muted-foreground">
              {t('settings.general.editor.type.helper')}
            </p>
          </div>

          {draft?.editor.editor_type === EditorType.CUSTOM && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="custom-command-workspace">
                  {t('settings.general.editor.customCommand.workspaceLabel', {
                    defaultValue: 'Workspace Open Command',
                  })}
                </Label>
                <Input
                  id="custom-command-workspace"
                  placeholder={t(
                    'settings.general.editor.customCommand.workspacePlaceholder',
                    { defaultValue: 'konsole --workdir %repo_root%' }
                  )}
                  value={draft?.editor.custom_ide_dir_cmd || ''}
                  onChange={(e) =>
                    updateDraft({
                      editor: {
                        ...draft!.editor,
                        custom_ide_dir_cmd: e.target.value || null,
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-command-file">
                  {t('settings.general.editor.customCommand.fileLabel', {
                    defaultValue: 'File Open Command',
                  })}
                </Label>
                <Input
                  id="custom-command-file"
                  placeholder={t(
                    'settings.general.editor.customCommand.filePlaceholder',
                    {
                      defaultValue:
                        'konsole --workdir %repo_root% -e nvim %file%',
                    }
                  )}
                  value={draft?.editor.custom_ide_file_cmd || ''}
                  onChange={(e) =>
                    updateDraft({
                      editor: {
                        ...draft!.editor,
                        custom_ide_file_cmd: e.target.value || null,
                      },
                    })
                  }
                />
              </div>
            </div>
          )}

          {(draft?.editor.editor_type === EditorType.VS_CODE ||
            draft?.editor.editor_type === EditorType.CURSOR ||
            draft?.editor.editor_type === EditorType.WINDSURF) && (
            <>
              <div className="space-y-2">
                <Label htmlFor="remote-ssh-host">
                  {t('settings.general.editor.remoteSsh.host.label')}
                </Label>
                <Input
                  id="remote-ssh-host"
                  placeholder={t(
                    'settings.general.editor.remoteSsh.host.placeholder'
                  )}
                  value={draft?.editor.remote_ssh_host || ''}
                  onChange={(e) =>
                    updateDraft({
                      editor: {
                        ...draft!.editor,
                        remote_ssh_host: e.target.value || null,
                      },
                    })
                  }
                />
                <p className="text-sm text-muted-foreground">
                  {t('settings.general.editor.remoteSsh.host.helper')}
                </p>
              </div>

              {draft?.editor.remote_ssh_host && (
                <div className="space-y-2">
                  <Label htmlFor="remote-ssh-user">
                    {t('settings.general.editor.remoteSsh.user.label')}
                  </Label>
                  <Input
                    id="remote-ssh-user"
                    placeholder={t(
                      'settings.general.editor.remoteSsh.user.placeholder'
                    )}
                    value={draft?.editor.remote_ssh_user || ''}
                    onChange={(e) =>
                      updateDraft({
                        editor: {
                          ...draft!.editor,
                          remote_ssh_user: e.target.value || null,
                        },
                      })
                    }
                  />
                  <p className="text-sm text-muted-foreground">
                    {t('settings.general.editor.remoteSsh.user.helper')}
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('settings.general.git.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="git-branch-prefix">
              {t('settings.general.git.branchPrefix.label')}
            </Label>
            <Input
              id="git-branch-prefix"
              type="text"
              placeholder={t('settings.general.git.branchPrefix.placeholder')}
              value={draft?.git_branch_prefix ?? ''}
              onChange={(e) => {
                const value = e.target.value.trim();
                updateDraft({ git_branch_prefix: value });
                setBranchPrefixError(validateBranchPrefix(value));
              }}
              aria-invalid={!!branchPrefixError}
              className={branchPrefixError ? 'border-destructive' : undefined}
            />
            {branchPrefixError && (
              <p className="text-sm text-destructive">{branchPrefixError}</p>
            )}
            <p className="text-sm text-muted-foreground">
              {t('settings.general.git.branchPrefix.helper')}{' '}
              {draft?.git_branch_prefix ? (
                <>
                  {t('settings.general.git.branchPrefix.preview')}{' '}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    {t('settings.general.git.branchPrefix.previewWithPrefix', {
                      prefix: draft.git_branch_prefix,
                    })}
                  </code>
                </>
              ) : (
                <>
                  {t('settings.general.git.branchPrefix.preview')}{' '}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    {t('settings.general.git.branchPrefix.previewNoPrefix')}
                  </code>
                </>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>
            {t('settings.general.taskCreation.title', {
              defaultValue: 'Task Creation Guidance',
            })}
          </CardTitle>
          <CardDescription>
            {t('settings.general.taskCreation.description', {
              defaultValue:
                'These descriptions are given to agents when they are tasked with creating tasks in viboard.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="global-task-title-prompt">
              {t('settings.general.taskCreation.titlePrompt.label', {
                defaultValue: 'Title guidance',
              })}
            </Label>
            <Input
              id="global-task-title-prompt"
              type="text"
              value={draft?.task_title_prompt ?? ''}
              onChange={(e) =>
                updateDraft({ task_title_prompt: e.target.value || null })
              }
              placeholder={t(
                'settings.general.taskCreation.titlePrompt.placeholder',
                {
                  defaultValue: 'Succinct 2-5 words',
                }
              )}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="global-task-description-prompt">
              {t('settings.general.taskCreation.descriptionPrompt.label', {
                defaultValue: 'Description guidance',
              })}
            </Label>
            <Input
              id="global-task-description-prompt"
              type="text"
              value={draft?.task_description_prompt ?? ''}
              onChange={(e) =>
                updateDraft({
                  task_description_prompt: e.target.value || null,
                })
              }
              placeholder={t(
                'settings.general.taskCreation.descriptionPrompt.placeholder',
                {
                  defaultValue: 'Do not write tests',
                }
              )}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('settings.general.notifications.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="sound-enabled"
              checked={draft?.notifications.sound_enabled}
              onCheckedChange={(checked: boolean) =>
                updateDraft({
                  notifications: {
                    ...draft!.notifications,
                    sound_enabled: checked,
                  },
                })
              }
            />
            <div className="space-y-0.5">
              <Label htmlFor="sound-enabled" className="cursor-pointer">
                {t('settings.general.notifications.sound.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('settings.general.notifications.sound.helper')}
              </p>
            </div>
          </div>
          {draft?.notifications.sound_enabled && (
            <div className="ml-6 space-y-2">
              <Label htmlFor="sound-file">
                {t('settings.general.notifications.sound.fileLabel')}
              </Label>
              <div className="flex gap-2">
                <Select
                  value={draft.notifications.sound_file}
                  onValueChange={(value: SoundFile) =>
                    updateDraft({
                      notifications: {
                        ...draft.notifications,
                        sound_file: value,
                      },
                    })
                  }
                >
                  <SelectTrigger id="sound-file" className="flex-1">
                    <SelectValue
                      placeholder={t(
                        'settings.general.notifications.sound.filePlaceholder'
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(SoundFile).map((soundFile) => (
                      <SelectItem key={soundFile} value={soundFile}>
                        {toPrettyCase(soundFile)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => playSound(draft.notifications.sound_file)}
                  className="px-3"
                >
                  <Volume2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="badge-notifications"
              checked={draft?.notifications.badge_enabled}
              onCheckedChange={(checked: boolean) =>
                updateDraft({
                  notifications: {
                    ...draft!.notifications,
                    badge_enabled: checked,
                  },
                })
              }
            />
            <div className="space-y-0.5">
              <Label htmlFor="badge-notifications" className="cursor-pointer">
                {t('settings.general.notifications.badge.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('settings.general.notifications.badge.helper')}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="toast-notifications"
              checked={draft?.notifications.toast_enabled}
              onCheckedChange={(checked: boolean) =>
                updateDraft({
                  notifications: {
                    ...draft!.notifications,
                    toast_enabled: checked,
                  },
                })
              }
            />
            <div className="space-y-0.5">
              <Label htmlFor="toast-notifications" className="cursor-pointer">
                {t('settings.general.notifications.toast.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('settings.general.notifications.toast.helper')}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="system-notifications"
              checked={draft?.notifications.system_enabled}
              onCheckedChange={(checked: boolean) =>
                updateDraft({
                  notifications: {
                    ...draft!.notifications,
                    system_enabled: checked,
                  },
                })
              }
            />
            <div className="space-y-0.5">
              <Label htmlFor="system-notifications" className="cursor-pointer">
                {t('settings.general.notifications.system.label')}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t('settings.general.notifications.system.helper')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('settings.general.taskTemplates.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <TagManager />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{t('settings.general.safety.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">
                {t('settings.general.safety.disclaimer.title')}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('settings.general.safety.disclaimer.description')}
              </p>
            </div>
            <Button variant="outline" onClick={resetDisclaimer}>
              {t('settings.general.safety.disclaimer.button')}
            </Button>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="show-new-attempt-drag-warning"
              checked={draft?.show_new_attempt_drag_warning}
              onCheckedChange={(checked: boolean) =>
                updateDraft({ show_new_attempt_drag_warning: checked })
              }
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="show-new-attempt-drag-warning"
                className="cursor-pointer"
              >
                {t('settings.general.safety.newAttemptWarning.label', {
                  defaultValue:
                    'Show warning before starting a new attempt from drag-and-drop',
                })}
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
