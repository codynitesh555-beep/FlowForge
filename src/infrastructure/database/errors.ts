export type DatabaseErrorCode = 'UNIQUE_CONSTRAINT' | 'FOREIGN_KEY' | 'RECORD_NOT_FOUND' | 'DATABASE_ERROR';

export interface SafeDatabaseError {
  readonly code: DatabaseErrorCode;
  readonly constraintCode?: string;
}

function prismaCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** Maps Prisma codes without copying database messages or values into public errors. */
export function mapDatabaseError(error: unknown): SafeDatabaseError {
  switch (prismaCode(error)) {
    case 'P2002': return { code: 'UNIQUE_CONSTRAINT' };
    case 'P2003': return { code: 'FOREIGN_KEY' };
    case 'P2025': return { code: 'RECORD_NOT_FOUND' };
    default: return { code: 'DATABASE_ERROR' };
  }
}
