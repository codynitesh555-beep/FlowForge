import { describe, it, expect } from 'vitest';
import { BinaryMinHeap } from './binary-min-heap.js';
import { compareStringDeterministic } from '../utils/comparator.js';

describe('BinaryMinHeap', () => {
  it('should handle empty heap gracefully', () => {
    const heap = new BinaryMinHeap<string>(compareStringDeterministic);
    expect(heap.isEmpty).toBe(true);
    expect(heap.size).toBe(0);
    expect(heap.peek()).toBeUndefined();
    expect(heap.pop()).toBeUndefined();
  });

  it('should maintain min-heap property and pop in deterministic sorted order', () => {
    const heap = new BinaryMinHeap<string>(compareStringDeterministic);
    const items = ['PAY-9', 'AUTH-1', 'PAY-2', 'CHECKOUT-1', 'AUTH-2'];

    for (const item of items) {
      heap.push(item);
    }

    expect(heap.size).toBe(5);
    expect(heap.peek()).toBe('AUTH-1');

    const popped: string[] = [];
    while (!heap.isEmpty) {
      popped.push(heap.pop()!);
    }

    expect(popped).toEqual(['AUTH-1', 'AUTH-2', 'CHECKOUT-1', 'PAY-2', 'PAY-9']);
  });

  it('should correctly handle duplicate elements', () => {
    const heap = new BinaryMinHeap<number>((a, b) => a - b);
    heap.push(5);
    heap.push(2);
    heap.push(5);
    heap.push(1);
    heap.push(2);

    const result: number[] = [];
    while (!heap.isEmpty) {
      result.push(heap.pop()!);
    }

    expect(result).toEqual([1, 2, 2, 5, 5]);
  });
});
