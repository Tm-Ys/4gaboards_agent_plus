// FeaturePoint 前置依赖图：纯内存邻接表，不依赖 Playwright，也不调用 LLM。
// 边方向为 prerequisite -> dependent；输入字段则保存 feature -> prerequisites。

import type { FeaturePoint } from "../schemas";

export class DependencyGraph {
  private readonly featuresById = new Map<string, FeaturePoint>();
  private readonly prerequisites = new Map<string, Set<string>>();
  private readonly dependents = new Map<string, Set<string>>();
  private readonly order = new Map<string, number>();

  constructor(features: FeaturePoint[]) {
    features.forEach((feature, index) => {
      if (this.featuresById.has(feature.id)) {
        throw new Error(`重复的功能点 id：${feature.id}`);
      }
      this.featuresById.set(feature.id, feature);
      this.prerequisites.set(feature.id, new Set());
      this.dependents.set(feature.id, new Set());
      this.order.set(feature.id, index);
    });

    for (const feature of features) {
      const direct = this.prerequisites.get(feature.id)!;
      for (const prerequisiteId of feature.prerequisite_feature_ids) {
        if (!this.featuresById.has(prerequisiteId)) {
          throw new Error(
            `功能点 "${feature.id}" 引用了不存在的前置功能点 "${prerequisiteId}"`,
          );
        }
        if (prerequisiteId === feature.id) {
          direct.add(prerequisiteId);
          this.dependents.get(prerequisiteId)!.add(feature.id);
          continue;
        }
        direct.add(prerequisiteId);
        this.dependents.get(prerequisiteId)!.add(feature.id);
      }
    }
  }

  /** 获取某个功能点的直接前置（一级依赖）。 */
  getDirectPrerequisites(featureId: string): FeaturePoint[] {
    this.requireFeature(featureId);
    return this.sortedFeatures(this.prerequisites.get(featureId) ?? []);
  }

  /** 获取某个功能点的全部传递前置，按拓扑顺序返回。 */
  getTransitivePrerequisites(featureId: string): FeaturePoint[] {
    this.requireFeature(featureId);
    const ancestors = new Set<string>();
    const visit = (id: string): void => {
      for (const prerequisiteId of this.prerequisites.get(id) ?? []) {
        if (ancestors.has(prerequisiteId)) continue;
        ancestors.add(prerequisiteId);
        visit(prerequisiteId);
      }
    };
    visit(featureId);
    return this.topologicalOrder(ancestors);
  }

  /** 获取某个功能点的全部传递下游（谁直接或间接依赖它）。 */
  getDependents(featureId: string): FeaturePoint[] {
    this.requireFeature(featureId);
    const downstream = new Set<string>();
    const visit = (id: string): void => {
      for (const dependentId of this.dependents.get(id) ?? []) {
        if (downstream.has(dependentId)) continue;
        downstream.add(dependentId);
        visit(dependentId);
      }
    };
    visit(featureId);
    return this.topologicalOrder(downstream);
  }

  /** 获取某模块的功能点，保持依赖优先的拓扑顺序。 */
  getByModule(module: string): FeaturePoint[] {
    const ids = new Set(
      [...this.featuresById.values()]
        .filter((feature) => feature.module === module)
        .map((feature) => feature.id),
    );
    return this.topologicalOrder(ids);
  }

  /** 验证整张图是否无环。 */
  validateNoCycles(): boolean {
    try {
      this.topologicalOrder(new Set(this.featuresById.keys()));
      return true;
    } catch {
      return false;
    }
  }

  /** 按拓扑层级分组：Layer 0 无依赖，后续层仅依赖更早层。 */
  getLayers(): FeaturePoint[][] {
    const remaining = new Map<string, number>();
    for (const id of this.featuresById.keys()) {
      remaining.set(id, this.prerequisites.get(id)?.size ?? 0);
    }

    let current = [...remaining.entries()]
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id)
      .sort((a, b) => this.compareIds(a, b));
    const layers: FeaturePoint[][] = [];
    let processed = 0;

    while (current.length > 0) {
      layers.push(current.map((id) => this.featuresById.get(id)!));
      processed += current.length;
      const next: string[] = [];
      for (const id of current) {
        for (const dependentId of this.dependents.get(id) ?? []) {
          const degree = (remaining.get(dependentId) ?? 0) - 1;
          remaining.set(dependentId, degree);
          if (degree === 0) next.push(dependentId);
        }
      }
      current = next.sort((a, b) => this.compareIds(a, b));
    }

    if (processed !== this.featuresById.size) {
      throw new Error("功能点依赖图存在环，无法按层级分组");
    }
    return layers;
  }

  private topologicalOrder(ids: Set<string>): FeaturePoint[] {
    if (ids.size === 0) return [];

    const inDegree = new Map<string, number>();
    for (const id of ids) {
      this.requireFeature(id);
      let degree = 0;
      for (const prerequisiteId of this.prerequisites.get(id) ?? []) {
        if (ids.has(prerequisiteId)) degree++;
      }
      inDegree.set(id, degree);
    }

    const ready = [...inDegree.entries()]
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id)
      .sort((a, b) => this.compareIds(a, b));
    const result: FeaturePoint[] = [];

    while (ready.length > 0) {
      const id = ready.shift()!;
      result.push(this.featuresById.get(id)!);
      for (const dependentId of this.dependents.get(id) ?? []) {
        if (!ids.has(dependentId)) continue;
        const degree = (inDegree.get(dependentId) ?? 0) - 1;
        inDegree.set(dependentId, degree);
        if (degree === 0) {
          ready.push(dependentId);
          ready.sort((a, b) => this.compareIds(a, b));
        }
      }
    }

    if (result.length !== ids.size) {
      const unresolved = [...ids].filter(
        (id) => !result.some((feature) => feature.id === id),
      );
      throw new Error(`功能点依赖图存在环：${unresolved.join(", ")}`);
    }
    return result;
  }

  private sortedFeatures(ids: Iterable<string>): FeaturePoint[] {
    return [...ids]
      .sort((a, b) => this.compareIds(a, b))
      .map((id) => this.featuresById.get(id)!);
  }

  private compareIds(a: string, b: string): number {
    return (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0);
  }

  private requireFeature(featureId: string): FeaturePoint {
    const feature = this.featuresById.get(featureId);
    if (!feature) throw new Error(`未知功能点 id：${featureId}`);
    return feature;
  }
}
