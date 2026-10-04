/**
 * The family tree of the living population. It keeps every living creature
 * and only those dead ancestors where the tree branches, so its size stays
 * near twice the population however long the run.
 */

export interface LineageNode {
  id: number;
  /** Nearest kept ancestor, or 0 for a creature with none. */
  parentId: number;
  birthTick: number;
  /** Tick of death, or -1 while alive. */
  deathTick: number;
  hue: number;
  /** Ids of kept descendants whose nearest kept ancestor is this node. */
  children: number[];
}

export class Lineage {
  private nodes = new Map<number, LineageNode>();

  get size(): number {
    return this.nodes.size;
  }

  get(id: number): LineageNode | undefined {
    return this.nodes.get(id);
  }

  all(): IterableIterator<LineageNode> {
    return this.nodes.values();
  }

  /** Record a birth. `parentId` is 0 for a creature with no parent. */
  born(id: number, parentId: number, tick: number, hue: number): void {
    const parent = parentId === 0 ? undefined : this.nodes.get(parentId);
    this.nodes.set(id, { id, parentId: parent ? parentId : 0, birthTick: tick, deathTick: -1, hue, children: [] });
    parent?.children.push(id);
  }

  /** Record a death, and drop whatever no longer joins two living branches. */
  died(id: number, tick: number): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.deathTick = tick;
    this.prune(node);
  }

  /**
   * A dead node with no children is a dead end: remove it. A dead node with
   * one child is a link in a chain: splice it out so the child hangs off the
   * node's own parent. Either may leave the parent prunable in turn.
   */
  private prune(start: LineageNode): void {
    let node: LineageNode | undefined = start;
    while (node && node.deathTick >= 0 && node.children.length <= 1) {
      const parent: LineageNode | undefined = node.parentId === 0 ? undefined : this.nodes.get(node.parentId);
      const onlyChild: LineageNode | undefined = node.children.length === 1 ? this.nodes.get(node.children[0]!) : undefined;
      if (onlyChild) onlyChild.parentId = parent ? parent.id : 0;
      if (parent) {
        const at = parent.children.indexOf(node.id);
        if (onlyChild) parent.children[at] = onlyChild.id;
        else parent.children.splice(at, 1);
      }
      this.nodes.delete(node.id);
      // Splicing leaves the parent's child count unchanged, so only a removal can cascade.
      node = onlyChild ? undefined : parent;
    }
  }

  save(): LineageNode[] {
    return [...this.nodes.values()].map((node) => ({ ...node, children: node.children.slice() }));
  }

  static load(nodes: LineageNode[]): Lineage {
    const lineage = new Lineage();
    for (const node of nodes) lineage.nodes.set(node.id, { ...node, children: node.children.slice() });
    return lineage;
  }
}
