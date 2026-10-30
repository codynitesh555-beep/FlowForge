/**
 * FlowForge Graph Engine - Binary Min Heap
 * Provides deterministic O(log N) priority queue operations.
 */

export class BinaryMinHeap<T> {
  private readonly heap: T[] = [];

  constructor(private readonly comparator: (a: T, b: T) => number) {}

  get size(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  push(item: T): void {
    this.heap.push(item);
    this.siftUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) return this.heap.pop();

    const root = this.heap[0]!;
    this.heap[0] = this.heap.pop()!;
    this.siftDown(0);
    return root;
  }

  private siftUp(index: number): void {
    let curr = index;
    while (curr > 0) {
      const parent = Math.floor((curr - 1) / 2);
      if (this.comparator(this.heap[curr]!, this.heap[parent]!) < 0) {
        this.swap(curr, parent);
        curr = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(index: number): void {
    let curr = index;
    const len = this.heap.length;

    while (true) {
      const left = 2 * curr + 1;
      const right = 2 * curr + 2;
      let smallest = curr;

      if (left < len && this.comparator(this.heap[left]!, this.heap[smallest]!) < 0) {
        smallest = left;
      }

      if (right < len && this.comparator(this.heap[right]!, this.heap[smallest]!) < 0) {
        smallest = right;
      }

      if (smallest !== curr) {
        this.swap(curr, smallest);
        curr = smallest;
      } else {
        break;
      }
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i]!;
    this.heap[i] = this.heap[j]!;
    this.heap[j] = temp;
  }
}
