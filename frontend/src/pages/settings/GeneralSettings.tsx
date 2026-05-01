import { useCallback, useEffect, useRef, useState } from 'react';
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
import { EditorType, SoundFile, ThemeMode } from 'shared/types';

import { toPrettyCase } from '@/utils/string';
import { useEditorAvailability } from '@/hooks/useEditorAvailability';
import { EditorAvailabilityIndicator } from '@/components/EditorAvailabilityIndicator';
import { useTheme } from '@/components/ThemeProvider';
import { useUserSystem } from '@/components/ConfigProvider';
import { TagManager } from '@/components/TagManager';
import { ExecutorProfileSelector } from '@/components/settings';

export function GeneralSettings() {
  const {
    config,
    loading,
    updateAndSaveConfig, // Use this on Save
    profiles,
    projectLocalConfigPath,
    projectLocalOverridePaths,
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

  const validateBranchPrefix = useCallback((prefix: string): string | null => {
    if (!prefix) return null; // empty allowed
    if (prefix.includes('/')) return "Prefix cannot contain '/'.";
    if (prefix.startsWith('.')) return "Prefix cannot start with '.'.";
    if (prefix.endsWith('.') || prefix.endsWith('.lock'))
      return "Prefix cannot end with '.' or '.lock'.";
    if (prefix.includes('..') || prefix.includes('@{'))
      return 'Contains invalid sequence (.., @{).';
    if (/[ \t~^:?*[\\]/.test(prefix)) return 'Contains invalid characters.';
    // Control chars check
    for (let i = 0; i < prefix.length; i++) {
      const code = prefix.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) return 'Contains control characters.';
    }
    return null;
  }, []);

  const isProjectManaged = useCallback(
    (path: string): boolean => {
      if (!projectLocalConfigPath) return false;
      return projectLocalOverridePaths.some(
        (overridePath) =>
          overridePath === path || path.startsWith(`${overridePath}.`)
      );
    },
    [projectLocalConfigPath, projectLocalOverridePaths]
  );

  const managedHint = projectLocalConfigPath
    ? `Managed in ${projectLocalConfigPath}`
    : null;

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
          setError('Failed to save configuration');
          return;
        }

        if (isEqual(latestDraftRef.current, saveSnapshot)) {
          setTheme(saveSnapshot.theme);
          setDirty(false);
        }
      } catch (err) {
        setError('Failed to save configuration');
        console.error('Error saving config:', err);
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [branchPrefixError, config, dirty, draft, setTheme, updateAndSaveConfig]);

  const resetDisclaimer = async () => {
    if (!config) return;
    updateAndSaveConfig({ disclaimer_acknowledged: false });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading settings...</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="py-8">
        <Alert variant="destructive">
          <AlertDescription>Failed to load configuration.</AlertDescription>
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
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="theme">Theme</Label>
            <Select
              value={draft?.theme}
              disabled={isProjectManaged('theme')}
              onValueChange={(value: ThemeMode) =>
                updateDraft({ theme: value })
              }
            >
              <SelectTrigger id="theme">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(ThemeMode).map((theme) => (
                  <SelectItem key={theme} value={theme}>
                    {toPrettyCase(theme)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isProjectManaged('theme') && managedHint && (
              <p className="text-sm text-muted-foreground">{managedHint}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Default Coding Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ExecutorProfileSelector
            profiles={profiles}
            selectedProfile={draft?.executor_profile ?? null}
            onProfileSelect={(profile) => updateDraft({ executor_profile: profile })}
            itemClassName="w-full"
            disabled={isProjectManaged('executor_profile')}
          />
          {isProjectManaged('executor_profile') && managedHint && (
            <p className="text-sm text-muted-foreground">{managedHint}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Editor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="editor-type">Editor Type</Label>
            <Select
              value={draft?.editor.editor_type}
              disabled={isProjectManaged('editor.editor_type')}
              onValueChange={(value: EditorType) =>
                updateDraft({
                  editor: { ...draft!.editor, editor_type: value },
                })
              }
            >
              <SelectTrigger id="editor-type">
                <SelectValue placeholder="Select editor" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(EditorType).map((editor) => (
                  <SelectItem key={editor} value={editor}>
                    {toPrettyCase(editor)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isProjectManaged('editor.editor_type') && managedHint && (
              <p className="text-sm text-muted-foreground">{managedHint}</p>
            )}

            {/* Editor availability status indicator */}
            {draft?.editor.editor_type !== EditorType.CUSTOM && (
              <EditorAvailabilityIndicator availability={editorAvailability} />
            )}

            <p className="text-sm text-muted-foreground">
              Choose your preferred code editor interface.
            </p>
          </div>

          {draft?.editor.editor_type === EditorType.CUSTOM && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="custom-command-workspace">
                  Workspace Open Command
                </Label>
                <Input
                  id="custom-command-workspace"
                  placeholder="konsole --workdir %repo_root%"
                  value={draft?.editor.custom_ide_dir_cmd || ''}
                  disabled={isProjectManaged('editor.custom_ide_dir_cmd')}
                  onChange={(e) =>
                    updateDraft({
                      editor: {
                        ...draft!.editor,
                        custom_ide_dir_cmd: e.target.value || null,
                      },
                    })
                  }
                />
                {isProjectManaged('editor.custom_ide_dir_cmd') && managedHint && (
                  <p className="text-sm text-muted-foreground">{managedHint}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-command-file">File Open Command</Label>
                <Input
                  id="custom-command-file"
                  placeholder="konsole --workdir %repo_root% -e nvim %file%"
                  value={draft?.editor.custom_ide_file_cmd || ''}
                  disabled={isProjectManaged('editor.custom_ide_file_cmd')}
                  onChange={(e) =>
                    updateDraft({
                      editor: {
                        ...draft!.editor,
                        custom_ide_file_cmd: e.target.value || null,
                      },
                    })
                  }
                />
                {isProjectManaged('editor.custom_ide_file_cmd') && managedHint && (
                  <p className="text-sm text-muted-foreground">{managedHint}</p>
                )}
              </div>
            </div>
          )}

          {(draft?.editor.editor_type === EditorType.VS_CODE ||
            draft?.editor.editor_type === EditorType.CURSOR ||
            draft?.editor.editor_type === EditorType.WINDSURF) && (
            <>
              <div className="space-y-2">
                <Label htmlFor="remote-ssh-host">
                  Remote SSH Host (Optional)
                </Label>
                <Input
                  id="remote-ssh-host"
                  placeholder="e.g., hostname or IP address"
                  value={draft?.editor.remote_ssh_host || ''}
                  disabled={isProjectManaged('editor.remote_ssh_host')}
                  onChange={(e) =>
                    updateDraft({
                      editor: {
                        ...draft!.editor,
                        remote_ssh_host: e.target.value || null,
                      },
                    })
                  }
                />
                {isProjectManaged('editor.remote_ssh_host') && managedHint && (
                  <p className="text-sm text-muted-foreground">{managedHint}</p>
                )}
                <p className="text-sm text-muted-foreground">
                  Set this if Viboard is running on a remote server. When set,
                  clicking "Open in Editor" will generate a URL to open your
                  editor via SSH instead of spawning a local command.
                </p>
              </div>

              {draft?.editor.remote_ssh_host && (
                <div className="space-y-2">
                  <Label htmlFor="remote-ssh-user">
                    Remote SSH User (Optional)
                  </Label>
                  <Input
                    id="remote-ssh-user"
                    placeholder="e.g., username"
                    value={draft?.editor.remote_ssh_user || ''}
                    disabled={isProjectManaged('editor.remote_ssh_user')}
                    onChange={(e) =>
                      updateDraft({
                        editor: {
                          ...draft!.editor,
                          remote_ssh_user: e.target.value || null,
                        },
                      })
                    }
                  />
                  {isProjectManaged('editor.remote_ssh_user') && managedHint && (
                    <p className="text-sm text-muted-foreground">{managedHint}</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    SSH username for the remote connection. If not set, VS Code
                    will use your SSH config or prompt you.
                  </p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Git</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="git-branch-prefix">Branch Prefix</Label>
            <Input
              id="git-branch-prefix"
              type="text"
              placeholder="vb"
              value={draft?.git_branch_prefix ?? ''}
              disabled={isProjectManaged('git_branch_prefix')}
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
              Prefix for auto-generated branch names. Leave empty for no prefix.{' '}
              {draft?.git_branch_prefix ? (
                <>
                  Preview:{' '}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    {`${draft.git_branch_prefix}/1a2b-task-name`}
                  </code>
                </>
              ) : (
                <>
                  Preview:{' '}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    1a2b-task-name
                  </code>
                </>
              )}
            </p>
            {isProjectManaged('git_branch_prefix') && managedHint && (
              <p className="text-sm text-muted-foreground">{managedHint}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Task Creation Guidance</CardTitle>
          <CardDescription>
            These descriptions are given to agents when they are tasked with
            creating tasks in viboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="global-task-title-prompt">Title guidance</Label>
            <Input
              id="global-task-title-prompt"
              type="text"
              value={draft?.task_title_prompt ?? ''}
              disabled={isProjectManaged('task_title_prompt')}
              onChange={(e) =>
                updateDraft({ task_title_prompt: e.target.value || null })
              }
              placeholder="Succinct 2-5 words"
            />
            {isProjectManaged('task_title_prompt') && managedHint && (
              <p className="text-sm text-muted-foreground">{managedHint}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="global-task-description-prompt">
              Description guidance
            </Label>
            <Input
              id="global-task-description-prompt"
              type="text"
              value={draft?.task_description_prompt ?? ''}
              disabled={isProjectManaged('task_description_prompt')}
              onChange={(e) =>
                updateDraft({
                  task_description_prompt: e.target.value || null,
                })
              }
              placeholder="Do not write tests"
            />
            {isProjectManaged('task_description_prompt') && managedHint && (
              <p className="text-sm text-muted-foreground">{managedHint}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="sound-enabled"
              checked={draft?.notifications.sound_enabled}
              disabled={isProjectManaged('notifications.sound_enabled')}
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
                Sound Notifications
              </Label>
              <p className="text-sm text-muted-foreground">
                Play a sound when task attempts finish running.
              </p>
            </div>
          </div>
          {draft?.notifications.sound_enabled && (
            <div className="ml-6 space-y-2">
              <Label htmlFor="sound-file">Sound</Label>
              <div className="flex gap-2">
                <Select
                  value={draft.notifications.sound_file}
                  disabled={isProjectManaged('notifications.sound_file')}
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
                    <SelectValue placeholder="Select sound" />
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
                  disabled={isProjectManaged('notifications.sound_file')}
                  onClick={() => playSound(draft.notifications.sound_file)}
                  className="px-3"
                >
                  <Volume2 className="h-4 w-4" />
                </Button>
              </div>
              {isProjectManaged('notifications.sound_file') && managedHint && (
                <p className="text-sm text-muted-foreground">{managedHint}</p>
              )}
            </div>
          )}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="badge-notifications"
              checked={draft?.notifications.badge_enabled}
              disabled={isProjectManaged('notifications.badge_enabled')}
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
                Badge Notifications
              </Label>
              <p className="text-sm text-muted-foreground">
                Show the red badge on the bell icon when there are unread task
                notifications.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="toast-notifications"
              checked={draft?.notifications.toast_enabled}
              disabled={isProjectManaged('notifications.toast_enabled')}
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
                Toast Notifications
              </Label>
              <p className="text-sm text-muted-foreground">
                Show in-app toast notifications when task attempts finish while
                the app is focused.
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="system-notifications"
              checked={draft?.notifications.system_enabled}
              disabled={isProjectManaged('notifications.system_enabled')}
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
                System Notifications
              </Label>
              <p className="text-sm text-muted-foreground">
                Show system notifications when task attempts finish while the
                app is not focused.
              </p>
            </div>
          </div>
          {isProjectManaged('notifications') && managedHint && (
            <p className="text-sm text-muted-foreground">{managedHint}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Tags</CardTitle>
        </CardHeader>
        <CardContent>
          <TagManager />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Safety &amp; Disclaimers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Disclaimer Acknowledgment</p>
              <p className="text-sm text-muted-foreground">
                Reset the safety disclaimer.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={resetDisclaimer}
              disabled={isProjectManaged('disclaimer_acknowledged')}
            >
              Reset
            </Button>
          </div>
          {isProjectManaged('disclaimer_acknowledged') && managedHint && (
            <p className="text-sm text-muted-foreground">{managedHint}</p>
          )}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="show-new-attempt-drag-warning"
              checked={draft?.show_new_attempt_drag_warning}
              disabled={isProjectManaged('show_new_attempt_drag_warning')}
              onCheckedChange={(checked: boolean) =>
                updateDraft({ show_new_attempt_drag_warning: checked })
              }
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="show-new-attempt-drag-warning"
                className="cursor-pointer"
              >
                Show warning before starting a new attempt from drag-and-drop
              </Label>
            </div>
          </div>
          {isProjectManaged('show_new_attempt_drag_warning') && managedHint && (
            <p className="text-sm text-muted-foreground">{managedHint}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
