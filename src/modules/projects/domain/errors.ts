export type ProjectTaskErrorCode =
  | 'INVALID_PROJECT_INPUT' | 'INVALID_TASK_INPUT' | 'PROJECT_NOT_FOUND' | 'PROJECT_ARCHIVED'
  | 'TASK_NOT_FOUND' | 'TASK_VERSION_CONFLICT' | 'TASK_DELETED' | 'DEPENDENCY_NOT_FOUND'
  | 'DEPENDENCY_EXISTS' | 'DEPENDENCY_CYCLE' | 'INVALID_PROJECT_GRAPH' | 'ASSIGNMENT_NOT_FOUND' | 'ASSIGNMENT_EXISTS'
  | 'MEMBERSHIP_NOT_ACTIVE' | 'MEMBERSHIP_NOT_FOUND' | 'PERSISTENCE_INVARIANT_VIOLATION';

export class ProjectTaskError extends Error {
  readonly name = 'ProjectTaskError';
  constructor(readonly code: ProjectTaskErrorCode, readonly details?: Readonly<Record<string, unknown>>) {
    super(code);
  }
}
