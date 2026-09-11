import type { InstRequestContext } from "./index.js";

declare const capabilityValue: unique symbol;

export interface Capability<T> {
  readonly name: string;
  readonly [capabilityValue]?: T;
}

export interface CapabilityBinding {
  readonly capability: Capability<unknown>;
  readonly value: unknown;
}

export interface HttpTrigger {
  readonly kind: "http";
  readonly method?: string;
  readonly path: string;
}

export type InstTrigger = HttpTrigger;

export interface UnitContext {
  readonly request: InstRequestContext;
  get<T>(capability: Capability<T>): T;
  use<T>(unit: InstUnit<T>): Promise<T>;
}

export interface InstUnit<T> {
  readonly name: string;
  readonly trigger?: InstTrigger;
  readonly requires?: readonly Capability<unknown>[];
  readonly dependencies?: readonly InstUnit<unknown>[];
  execute(context: UnitContext): T | Promise<T>;
}

function assertName(name: string): void {
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(name)) throw new Error(`Invalid Inst graph name: ${name}`);
}

function assertHttpPath(path: string): void {
  if (!path.startsWith("/")) throw new Error(`Invalid Inst HTTP path: ${path}`);
}

function httpTrigger(method: string | undefined, path: string): HttpTrigger {
  assertHttpPath(path);
  return Object.freeze({
    kind: "http" as const,
    ...(method === undefined ? {} : { method }),
    path,
  });
}

export const http = Object.freeze({
  any(path: string): HttpTrigger {
    return httpTrigger(undefined, path);
  },
  get(path: string): HttpTrigger {
    return httpTrigger("GET", path);
  },
  post(path: string): HttpTrigger {
    return httpTrigger("POST", path);
  },
  put(path: string): HttpTrigger {
    return httpTrigger("PUT", path);
  },
  patch(path: string): HttpTrigger {
    return httpTrigger("PATCH", path);
  },
  delete(path: string): HttpTrigger {
    return httpTrigger("DELETE", path);
  },
});

export function defineCapability<T>(name: string): Capability<T> {
  assertName(name);
  return Object.freeze({ name });
}

export function provide<T>(capability: Capability<T>, value: NoInfer<T>): CapabilityBinding {
  return Object.freeze({ capability, value });
}

export function defineUnit<T>(unit: InstUnit<T>): InstUnit<T> {
  assertName(unit.name);
  return Object.freeze({
    ...unit,
    ...(unit.trigger === undefined ? {} : { trigger: Object.freeze({ ...unit.trigger }) }),
    requires: Object.freeze([...(unit.requires ?? [])]),
    dependencies: Object.freeze([...(unit.dependencies ?? [])]),
  });
}
