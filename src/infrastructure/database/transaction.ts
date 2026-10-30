import type { TransactionClient } from './prisma.js';

export type TransactionWork<T> = (transaction: TransactionClient) => Promise<T>;
export interface TransactionHost {
  $transaction<T>(callback: (transaction: TransactionClient) => Promise<T>): Promise<T>;
}

/** Run work against the transaction-scoped client; repositories must use this argument. */
export function withTransaction<T>(client: TransactionHost, work: TransactionWork<T>): Promise<T> {
  return client.$transaction((transaction) => work(transaction));
}
