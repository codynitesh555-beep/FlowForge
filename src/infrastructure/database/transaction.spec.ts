import { describe, expect, it, vi } from 'vitest';
import type { TransactionClient } from './prisma.js';
import { withTransaction, type TransactionHost } from './transaction.js';

function transactionDouble(marker: string): TransactionClient {
  return { marker } as unknown as TransactionClient;
}

describe('withTransaction', () => {
  it('passes the transaction-scoped client to work and does not substitute the root client', async () => {
    const transactionQuery = vi.fn(() => 'transaction result');
    const rootQuery = vi.fn(() => 'root result');
    const transaction = { marker: 'tx-client', query: transactionQuery } as unknown as TransactionClient;
    const rootClient = {
      query: rootQuery,
      async $transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T> {
        return callback(transaction);
      },
    } satisfies TransactionHost & { query: typeof rootQuery };
    const work = vi.fn(async (tx: TransactionClient) => {
      expect(tx).toBe(transaction);
      return (tx as unknown as { query: () => string }).query();
    });

    await expect(withTransaction(rootClient, work)).resolves.toBe('transaction result');
    expect(work).toHaveBeenCalledOnce();
    expect(work).toHaveBeenCalledWith(transaction);
    expect(transactionQuery).toHaveBeenCalledOnce();
    expect(rootQuery).not.toHaveBeenCalled();
  });

  it('propagates transaction failures so the transaction host can roll back', async () => {
    const transaction = transactionDouble('tx-client');
    const failure = new Error('transaction failure');
    let rolledBack = false;
    const rootClient: TransactionHost = {
      async $transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T> {
        try {
          return await callback(transaction);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
    };
    const work = async (_tx: TransactionClient): Promise<never> => { throw failure; };

    await expect(withTransaction(rootClient, work)).rejects.toBe(failure);
    expect(rolledBack).toBe(true);
  });
});
