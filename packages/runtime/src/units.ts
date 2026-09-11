import type { InstRequestContext } from "@instjs/core";
import type { Capability, CapabilityBinding, InstUnit } from "@instjs/core/units";

export interface UnitGraphNode {
  readonly name: string;
  readonly requires: readonly string[];
  readonly dependencies: readonly string[];
}

export function compileUnit(
  entry: InstUnit<Response>,
  bindings: readonly CapabilityBinding[],
): { nodes: readonly UnitGraphNode[]; execute(context: InstRequestContext): Promise<Response> } {
  const capabilities = new Map<Capability<unknown>, unknown>();
  const capabilityNames = new Map<string, Capability<unknown>>();
  for (const binding of bindings) {
    if (capabilities.has(binding.capability)) throw new Error(`Duplicate capability binding: ${binding.capability.name}`);
    capabilities.set(binding.capability, binding.value);
  }
  const visiting = new Set<InstUnit<unknown>>();
  const nodes = new Map<InstUnit<unknown>, { requires: readonly Capability<unknown>[]; dependencies: readonly InstUnit<unknown>[]; execute: InstUnit<unknown>["execute"] }>();
  const names = new Map<string, InstUnit<unknown>>();
  const visit = (unit: InstUnit<unknown>): void => {
    if (visiting.has(unit)) throw new Error(`Cyclic Unit dependency: ${unit.name}`);
    if (nodes.has(unit)) return;
    if (names.has(unit.name) && names.get(unit.name) !== unit) throw new Error(`Duplicate Unit name: ${unit.name}`);
    names.set(unit.name, unit);
    visiting.add(unit);
    const requires = [...(unit.requires ?? [])];
    const dependencies = [...(unit.dependencies ?? [])];
    for (const capability of requires) {
      if (!capabilities.has(capability)) throw new Error(`Missing capability ${capability.name} for Unit ${unit.name}`);
      if (capabilityNames.has(capability.name) && capabilityNames.get(capability.name) !== capability) {
        throw new Error(`Duplicate capability name: ${capability.name}`);
      }
      capabilityNames.set(capability.name, capability);
    }
    for (const dependency of dependencies) visit(dependency);
    visiting.delete(unit);
    nodes.set(unit, { requires, dependencies, execute: unit.execute.bind(unit) });
  };
  visit(entry);
  return {
    nodes: [...nodes].map(([unit, node]) => ({
      name: unit.name,
      requires: node.requires.map((capability) => capability.name).sort(),
      dependencies: node.dependencies.map((dependency) => dependency.name),
    })),
    async execute(context) {
      const results = new Map<InstUnit<unknown>, Promise<unknown>>();
      const run = <T>(unit: InstUnit<T>): Promise<T> => {
        const cached = results.get(unit);
        if (cached) return cached as Promise<T>;
        const node = nodes.get(unit)!;
        const result = (async () => {
          context.signal.throwIfAborted();
          for (const dependency of node.dependencies) await run(dependency);
          context.signal.throwIfAborted();
          return node.execute({
            request: context,
            get<C>(capability: Capability<C>): C {
              if (!node.requires.includes(capability)) throw new Error(`Undeclared capability ${capability.name} in Unit ${unit.name}`);
              return capabilities.get(capability) as C;
            },
            use<U>(dependency: InstUnit<U>): Promise<U> {
              if (!node.dependencies.includes(dependency)) throw new Error(`Undeclared dependency ${dependency.name} in Unit ${unit.name}`);
              return run(dependency);
            },
          });
        })();
        results.set(unit, result);
        return result as Promise<T>;
      };
      return run(entry);
    },
  };
}
