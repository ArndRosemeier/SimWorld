/**
 * Instance lists per model, as the town workers hand them to the views: floats appended per
 * instance under a model key, then one Float32Array each. The one way to collect instances in the
 * build layer (street props, signs).
 */
export interface ModelInstances { model: string; inst: Float32Array }

export class InstanceLists {
  private readonly lists = new Map<string, number[]>();

  /** Append one instance's floats to `model`'s list. */
  add(model: string, ...floats: number[]): void {
    let l = this.lists.get(model);
    if (!l) this.lists.set(model, (l = []));
    l.push(...floats);
  }

  /** Every model's instances. */
  groups(): ModelInstances[] {
    return [...this.lists].map(([model, l]) => ({ model, inst: Float32Array.from(l) }));
  }
}
