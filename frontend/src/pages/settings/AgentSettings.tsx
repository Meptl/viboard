import { useEffect, useRef, useState } from 'react';
import { cloneDeep, isEqual } from 'lodash';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChevronDown, Loader2 } from 'lucide-react';

import { ExecutorConfigForm } from '@/components/ExecutorConfigForm';
import { useProfiles } from '@/hooks/useProfiles';
import { useUserSystem } from '@/components/ConfigProvider';
import { CreateConfigurationDialog } from '@/components/dialogs/settings/CreateConfigurationDialog';
import { DeleteConfigurationDialog } from '@/components/dialogs/settings/DeleteConfigurationDialog';
import { useAgentAvailability } from '@/hooks/useAgentAvailability';
import { AgentAvailabilityIndicator } from '@/components/AgentAvailabilityIndicator';
import type {
  BaseCodingAgent,
  ExecutorConfigs,
  ExecutorProfileId,
} from 'shared/types';

type ExecutorsMap = Record<string, Record<string, Record<string, unknown>>>;

export function AgentSettings() {
  // Use profiles hook for server state
  const {
    profilesContent: serverProfilesContent,
    isLoading: profilesLoading,
    isSaving: profilesSaving,
    error: profilesError,
    save: saveProfiles,
  } = useProfiles();

  const { config, updateAndSaveConfig, profiles, reloadSystem } =
    useUserSystem();

  // Local editor state (draft that may differ from server)
  const [saveError, setSaveError] = useState<string | null>(null);

  const [selectedExecutorType, setSelectedExecutorType] =
    useState<BaseCodingAgent>('CLAUDE_CODE' as BaseCodingAgent);
  const [selectedConfiguration, setSelectedConfiguration] =
    useState<string>('DEFAULT');
  const [localParsedProfiles, setLocalParsedProfiles] =
    useState<ExecutorConfigs | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Default executor profile state
  const [executorDraft, setExecutorDraft] = useState<ExecutorProfileId | null>(
    () => (config?.executor_profile ? cloneDeep(config.executor_profile) : null)
  );
  const [executorError, setExecutorError] = useState<string | null>(null);
  const executorSaveSeqRef = useRef(0);

  // Check agent availability when draft executor changes
  const agentAvailability = useAgentAvailability(executorDraft?.executor);

  // Sync server state to local state when not dirty
  useEffect(() => {
    if (!isDirty && serverProfilesContent) {
      try {
        const parsed = JSON.parse(serverProfilesContent);
        setLocalParsedProfiles(parsed);
      } catch (err) {
        console.error('Failed to parse profiles JSON:', err);
        setLocalParsedProfiles(null);
      }
    }
  }, [serverProfilesContent, isDirty]);

  // Check if executor draft differs from saved config
  const executorDirty =
    executorDraft && config?.executor_profile
      ? !isEqual(executorDraft, config.executor_profile)
      : false;

  // Sync executor draft when config changes (only if not dirty)
  useEffect(() => {
    if (config?.executor_profile) {
      setExecutorDraft((currentDraft) => {
        // Only update if draft matches the old config (not dirty)
        if (!currentDraft || isEqual(currentDraft, config.executor_profile)) {
          return cloneDeep(config.executor_profile);
        }
        return currentDraft;
      });
    }
  }, [config?.executor_profile]);

  // Update executor draft
  const updateExecutorDraft = (newProfile: ExecutorProfileId) => {
    setExecutorDraft(newProfile);
  };

  // Mark profiles as dirty
  const markDirty = (nextProfiles: unknown) => {
    setLocalParsedProfiles(nextProfiles as ExecutorConfigs);
    setIsDirty(true);
  };

  useEffect(() => {
    if (!executorDraft || !config?.executor_profile) return;
    if (!executorDirty) return;

    const snapshot = cloneDeep(executorDraft);
    const saveSeq = ++executorSaveSeqRef.current;

    setExecutorError(null);

    updateAndSaveConfig({ executor_profile: snapshot })
      .then((saved) => {
        if (!saved) {
          setExecutorError('Failed to save configuration');
          return;
        }
        if (saveSeq === executorSaveSeqRef.current) {
          reloadSystem();
        }
      })
      .catch((err) => {
        setExecutorError('Failed to save configuration');
        console.error('Error saving executor profile:', err);
      });
  }, [
    config?.executor_profile,
    executorDirty,
    executorDraft,
    reloadSystem,
    updateAndSaveConfig,
  ]);

  // Open create dialog
  const openCreateDialog = async () => {
    try {
      const result = await CreateConfigurationDialog.show({
        executorType: selectedExecutorType,
        existingConfigs: Object.keys(
          localParsedProfiles?.executors?.[selectedExecutorType] || {}
        ),
      });

      if (result.action === 'created' && result.configName) {
        void createConfiguration(
          selectedExecutorType,
          result.configName,
          result.cloneFrom
        );
      }
    } catch (error) {
      // User cancelled - do nothing
    }
  };

  // Create new configuration
  const createConfiguration = async (
    executorType: string,
    configName: string,
    baseConfig?: string | null
  ) => {
    if (!localParsedProfiles || !localParsedProfiles.executors) return;

    const executorsMap =
      localParsedProfiles.executors as unknown as ExecutorsMap;
    const base =
      baseConfig && executorsMap[executorType]?.[baseConfig]?.[executorType]
        ? executorsMap[executorType][baseConfig][executorType]
        : {};

    const updatedProfiles = {
      ...localParsedProfiles,
      executors: {
        ...localParsedProfiles.executors,
        [executorType]: {
          ...executorsMap[executorType],
          [configName]: {
            [executorType]: base,
          },
        },
      },
    };

    markDirty(updatedProfiles);
    setSelectedConfiguration(configName);

    try {
      setSaveError(null);
      await saveProfiles(JSON.stringify(updatedProfiles, null, 2));
      setIsDirty(false);
      reloadSystem();
    } catch (err: unknown) {
      console.error('Failed to save new configuration:', err);
      setSaveError('Failed to save configuration. Please try again.');
    }
  };

  // Open delete dialog
  const openDeleteDialog = async (configName: string) => {
    try {
      const result = await DeleteConfigurationDialog.show({
        configName,
        executorType: selectedExecutorType,
      });

      if (result === 'deleted') {
        await handleDeleteConfiguration(configName);
      }
    } catch (error) {
      // User cancelled - do nothing
    }
  };

  // Handle delete configuration
  const handleDeleteConfiguration = async (configToDelete: string) => {
    if (!localParsedProfiles) {
      return;
    }

    // Clear any previous errors
    setSaveError(null);

    try {
      // Validate that the configuration exists
      if (
        !localParsedProfiles.executors[selectedExecutorType]?.[configToDelete]
      ) {
        return;
      }

      // Check if this is the last configuration
      const currentConfigs = Object.keys(
        localParsedProfiles.executors[selectedExecutorType] || {}
      );
      if (currentConfigs.length <= 1) {
        return;
      }

      // Remove the configuration from the executor
      const remainingConfigs = {
        ...localParsedProfiles.executors[selectedExecutorType],
      };
      delete remainingConfigs[configToDelete];

      const updatedProfiles = {
        ...localParsedProfiles,
        executors: {
          ...localParsedProfiles.executors,
          [selectedExecutorType]: remainingConfigs,
        },
      };

      const executorsMap = updatedProfiles.executors as unknown as ExecutorsMap;
      // If no configurations left, create a blank DEFAULT (should not happen due to check above)
      if (Object.keys(remainingConfigs).length === 0) {
        executorsMap[selectedExecutorType] = {
          DEFAULT: { [selectedExecutorType]: {} },
        };
      }

      try {
        // Save using hook
        await saveProfiles(JSON.stringify(updatedProfiles, null, 2));

        // Update local state and reset dirty flag
        setLocalParsedProfiles(updatedProfiles);
        setIsDirty(false);

        // Select the next available configuration
        const nextConfigs = Object.keys(
          executorsMap[selectedExecutorType] || {}
        );
        const nextSelected = nextConfigs[0] || 'DEFAULT';
        setSelectedConfiguration(nextSelected);

        // Refresh global system so deleted configs are removed elsewhere
        reloadSystem();
      } catch (saveError: unknown) {
        console.error('Failed to save deletion to backend:', saveError);
        setSaveError('Failed to delete configuration. Please try again.');
      }
    } catch (error) {
      console.error('Error deleting configuration:', error);
    }
  };

  const handleExecutorConfigChange = (
    executorType: string,
    configuration: string,
    formData: unknown
  ) => {
    if (!localParsedProfiles || !localParsedProfiles.executors) return;

    const executorsMap =
      localParsedProfiles.executors as unknown as ExecutorsMap;
    // Update the parsed profiles with the new config
    const updatedProfiles = {
      ...localParsedProfiles,
      executors: {
        ...localParsedProfiles.executors,
        [executorType]: {
          ...executorsMap[executorType],
          [configuration]: {
            [executorType]: formData,
          },
        },
      },
    };

    markDirty(updatedProfiles);
  };

  const handleExecutorConfigSave = async (formData: unknown) => {
    if (!localParsedProfiles || !localParsedProfiles.executors) return;

    // Clear any previous errors
    setSaveError(null);

    // Update the parsed profiles with the saved config
    const updatedProfiles = {
      ...localParsedProfiles,
      executors: {
        ...localParsedProfiles.executors,
        [selectedExecutorType]: {
          ...localParsedProfiles.executors[selectedExecutorType],
          [selectedConfiguration]: {
            [selectedExecutorType]: formData,
          },
        },
      },
    };

    // Update state
    setLocalParsedProfiles(updatedProfiles);

    // Save the updated profiles directly
    try {
      await saveProfiles(JSON.stringify(updatedProfiles, null, 2));
      setIsDirty(false);

      // Refresh global system so new profiles are available elsewhere
      reloadSystem();
    } catch (err: unknown) {
      console.error('Failed to save profiles:', err);
      setSaveError('Failed to save configuration. Please try again.');
    }
  };

  if (profilesLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading agent configurations...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!!profilesError && (
        <Alert variant="destructive">
          <AlertDescription>
            {profilesError instanceof Error
              ? profilesError.message
              : String(profilesError)}
          </AlertDescription>
        </Alert>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {executorError && (
        <Alert variant="destructive">
          <AlertDescription>{executorError}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Default Coding Agent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="executor">Default Agent Configuration</Label>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={executorDraft?.executor ?? ''}
                onValueChange={(value: string) => {
                  const variants = profiles?.[value];
                  const keepCurrentVariant =
                    variants &&
                    executorDraft?.variant &&
                    variants[executorDraft.variant];

                  const newProfile: ExecutorProfileId = {
                    executor: value as BaseCodingAgent,
                    variant: keepCurrentVariant ? executorDraft!.variant : null,
                  };
                  updateExecutorDraft(newProfile);
                }}
                disabled={!profiles}
              >
                <SelectTrigger id="executor">
                  <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles &&
                    Object.entries(profiles)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([profileKey]) => (
                        <SelectItem key={profileKey} value={profileKey}>
                          {profileKey}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>

              {/* Show variant selector if selected profile has variants */}
              {(() => {
                const currentProfileVariant = executorDraft;
                const selectedProfile =
                  profiles?.[currentProfileVariant?.executor || ''];
                const hasVariants =
                  selectedProfile && Object.keys(selectedProfile).length > 0;

                if (hasVariants) {
                  return (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full h-10 px-2 flex items-center justify-between"
                        >
                          <span className="text-sm truncate flex-1 text-left">
                            {currentProfileVariant?.variant || 'Default'}
                          </span>
                          <ChevronDown className="h-4 w-4 ml-1 flex-shrink-0" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {Object.entries(selectedProfile).map(
                          ([variantLabel]) => (
                            <DropdownMenuItem
                              key={variantLabel}
                              onClick={() => {
                                const newProfile: ExecutorProfileId = {
                                  executor: currentProfileVariant!.executor,
                                  variant: variantLabel,
                                };
                                updateExecutorDraft(newProfile);
                              }}
                              className={
                                currentProfileVariant?.variant === variantLabel
                                  ? 'bg-accent'
                                  : ''
                              }
                            >
                              {variantLabel}
                            </DropdownMenuItem>
                          )
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                } else if (selectedProfile) {
                  // Show disabled button when profile exists but has no variants
                  return (
                    <Button
                      variant="outline"
                      className="w-full h-10 px-2 flex items-center justify-between"
                      disabled
                    >
                      <span className="text-sm truncate flex-1 text-left">
                        Default
                      </span>
                    </Button>
                  );
                }
                return null;
              })()}
            </div>
            <AgentAvailabilityIndicator availability={agentAvailability} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coding Agent Configurations</CardTitle>
          <CardDescription>
            Customize the behavior of coding agents with different
            configurations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {localParsedProfiles && localParsedProfiles.executors ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="executor-type">Agent</Label>
                  <Select
                    value={selectedExecutorType}
                    onValueChange={(value) => {
                      setSelectedExecutorType(value as BaseCodingAgent);
                      // Reset configuration selection when executor type changes
                      setSelectedConfiguration('DEFAULT');
                    }}
                  >
                    <SelectTrigger id="executor-type">
                      <SelectValue placeholder="Select executor type" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(localParsedProfiles.executors).map(
                        (type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="configuration">Configuration</Label>
                  <div className="flex gap-2">
                    <Select
                      value={selectedConfiguration}
                      onValueChange={(value) => {
                        if (value === '__create__') {
                          openCreateDialog();
                        } else {
                          setSelectedConfiguration(value);
                        }
                      }}
                      disabled={
                        !localParsedProfiles.executors[selectedExecutorType]
                      }
                    >
                      <SelectTrigger id="configuration">
                        <SelectValue placeholder="Select configuration" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(
                          localParsedProfiles.executors[selectedExecutorType] ||
                            {}
                        ).map((configuration) => (
                          <SelectItem key={configuration} value={configuration}>
                            {configuration}
                          </SelectItem>
                        ))}
                        <SelectItem value="__create__">
                          Create new...
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-10"
                      onClick={() => openDeleteDialog(selectedConfiguration)}
                      disabled={
                        profilesSaving ||
                        !localParsedProfiles.executors[selectedExecutorType] ||
                        Object.keys(
                          localParsedProfiles.executors[selectedExecutorType] ||
                            {}
                        ).length <= 1
                      }
                      title={
                        Object.keys(
                          localParsedProfiles.executors[selectedExecutorType] ||
                            {}
                        ).length <= 1
                          ? 'Cannot delete the last configuration'
                          : `Delete ${selectedConfiguration}`
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>

              {(() => {
                const executorsMap =
                  localParsedProfiles.executors as unknown as ExecutorsMap;
                return (
                  !!executorsMap[selectedExecutorType]?.[
                    selectedConfiguration
                  ]?.[selectedExecutorType] && (
                    <ExecutorConfigForm
                      key={`${selectedExecutorType}-${selectedConfiguration}`}
                      executor={selectedExecutorType}
                      value={
                        (executorsMap[selectedExecutorType][
                          selectedConfiguration
                        ][selectedExecutorType] as Record<string, unknown>) ||
                        {}
                      }
                      onChange={(formData) =>
                        handleExecutorConfigChange(
                          selectedExecutorType,
                          selectedConfiguration,
                          formData
                        )
                      }
                      onSave={handleExecutorConfigSave}
                      autoSave
                      disabled={profilesSaving}
                      isSaving={profilesSaving}
                      isDirty={isDirty}
                    />
                  )
                );
              })()}
            </div>
          ) : (
            <Alert variant="destructive">
              <AlertDescription>
                Failed to save agent configurations. Please try again.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
