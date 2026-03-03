import { createContext, useContext, type ReactNode } from 'react';
import type { TaskWithAttemptStatus } from 'shared/types';

interface ProjectTasksSnapshotContextValue {
  projectId?: string;
  tasks: TaskWithAttemptStatus[];
}

const ProjectTasksSnapshotContext =
  createContext<ProjectTasksSnapshotContextValue | null>(null);

export function ProjectTasksSnapshotProvider({
  value,
  children,
}: {
  value: ProjectTasksSnapshotContextValue;
  children: ReactNode;
}) {
  return (
    <ProjectTasksSnapshotContext.Provider value={value}>
      {children}
    </ProjectTasksSnapshotContext.Provider>
  );
}

export function useProjectTasksSnapshot() {
  return useContext(ProjectTasksSnapshotContext);
}
