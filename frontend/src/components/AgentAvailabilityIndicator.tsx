import { Check, AlertCircle, Loader2 } from 'lucide-react';
import type { AgentAvailabilityState } from '@/hooks/useAgentAvailability';

interface AgentAvailabilityIndicatorProps {
  availability: AgentAvailabilityState;
}

export function AgentAvailabilityIndicator({
  availability,
}: AgentAvailabilityIndicatorProps) {
  if (!availability) return null;

  return (
    <div className="flex flex-col gap-1 text-sm">
      {availability.status === 'checking' && (
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Checking...</span>
        </div>
      )}
      {availability.status === 'login_detected' && (
        <>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-success" />
            <span className="text-success">Recent Usage Detected</span>
          </div>
          <p className="text-xs text-muted-foreground pl-6">
            Recent authentication credentials found for this agent
          </p>
        </>
      )}
      {availability.status === 'installation_found' && (
        <>
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-success" />
            <span className="text-success">Previous Usage Detected</span>
          </div>
          <p className="text-xs text-muted-foreground pl-6">
            Agent configuration found. You may need to log in to use it.
          </p>
        </>
      )}
      {availability.status === 'not_found' && (
        <>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-warning" />
            <span className="text-warning">Not Found</span>
          </div>
          <p className="text-xs text-muted-foreground pl-6">
            No previous usage detected. Agent may require installation and/or
            login.
          </p>
        </>
      )}
    </div>
  );
}
