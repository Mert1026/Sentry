/**
 * Options for the run that re-tests picked findings. It always runs on the CURRENT revision: no
 * revision is named, so the "Run revision" choice of the QA section cannot move it to an older one.
 */
export function retestStartOptions(
  input: {
    findings: Array<{ runId: string; findingId: string }>;
    who: 'reporter' | 'all';
  },
  options: { stacks: readonly string[]; webAccess: boolean; toolDownloads: boolean },
): {
  mode: 'full';
  agentStackIds?: string[];
  webAccess?: boolean;
  toolDownloads?: boolean;
  retest: typeof input;
} {
  return {
    mode: 'full',
    ...(input.who === 'all' && options.stacks.length > 0
      ? { agentStackIds: [...options.stacks] }
      : {}),
    ...(options.webAccess ? { webAccess: true } : {}),
    ...(options.toolDownloads ? { toolDownloads: true } : {}),
    retest: input,
  };
}
