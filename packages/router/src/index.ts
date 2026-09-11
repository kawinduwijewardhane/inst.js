export interface RouteRecord<T = unknown> {
  readonly method?: string;
  readonly path: string;
  readonly value: T;
}

export interface RouteMatch<T = unknown> {
  readonly route: RouteRecord<T>;
  readonly params: Readonly<Record<string, string>>;
}

interface CompiledRoute<T> {
  readonly record: RouteRecord<T>;
  readonly pattern: RegExp;
  readonly keys: readonly string[];
  readonly score: number;
}

const httpToken = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const routeParameterName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const reservedRouteParameterNames = new Set(["__proto__", "prototype", "constructor"]);

export class Router<T = unknown> {
  readonly #routes: CompiledRoute<T>[] = [];

  add(record: RouteRecord<T>): this {
    assertRoutePath(record.path);
    const normalized = normalizePath(record.path);
    const method = normalizeMethod(record.method);
    const compiled = compilePath(normalized);

    const duplicate = this.#routes.some(
      (route) => route.record.method === method && route.pattern.source === compiled.pattern.source,
    );
    if (duplicate) {
      throw new Error(`Duplicate route pattern for ${method ?? "*"} ${normalized}`);
    }

    const { method: _method, ...rest } = record;
    this.#routes.push({
      record: {
        ...rest,
        ...(method === undefined ? {} : { method }),
        path: normalized,
      },
      ...compiled,
    });

    this.#routes.sort((a, b) => b.score - a.score);
    return this;
  }

  match(pathname: string, method = "GET"): RouteMatch<T> | null {
    const path = normalizePath(pathname);
    const targetMethod = normalizeMethod(method) ?? "GET";
    let best: RouteMatch<T> | null = null;
    let bestScore = -1;
    let bestMethodPriority = -1;

    for (const route of this.#routes) {
      if (best && route.score < bestScore) break;

      const priority = methodPriority(route.record.method, targetMethod);
      if (priority === 0) continue;

      const match = route.pattern.exec(path);
      if (!match) continue;

      const params = decodeParams(route.keys, match);
      if (!params) continue;

      if (!best || route.score > bestScore || priority > bestMethodPriority) {
        best = { route: route.record, params };
        bestScore = route.score;
        bestMethodPriority = priority;
      }
    }

    return best;
  }

  methods(pathname: string): readonly string[] {
    const path = normalizePath(pathname);
    const methods = new Set<string>();
    let bestScore = -1;

    for (const route of this.#routes) {
      if (bestScore >= 0 && route.score < bestScore) break;
      if (!route.record.method) continue;

      const match = route.pattern.exec(path);
      if (!match || !decodeParams(route.keys, match)) continue;

      if (route.score > bestScore) {
        methods.clear();
        bestScore = route.score;
      }

      const method = route.record.method;
      methods.add(method);
      if (method === "GET") methods.add("HEAD");
    }

    return [...methods].sort();
  }

  routes(): readonly RouteRecord<T>[] {
    return this.#routes.map((route) => route.record);
  }
}

function assertRoutePath(path: string): void {
  if (!path || path.includes("?") || path.includes("#")) {
    throw new Error(`Route path must be a pathname without query or fragment: ${path}`);
  }
}

function normalizeMethod(method: string | undefined): string | undefined {
  if (method === undefined) return undefined;
  if (!httpToken.test(method)) throw new Error(`Invalid HTTP method: ${method}`);
  return method.toUpperCase();
}

function methodPriority(routeMethod: string | undefined, targetMethod: string): number {
  if (!routeMethod) return 1;
  if (routeMethod === targetMethod) return 3;
  if (targetMethod === "HEAD" && routeMethod === "GET") return 2;
  return 0;
}

function decodeParams(
  keys: readonly string[],
  match: RegExpExecArray,
): Readonly<Record<string, string>> | null {
  const params: Record<string, string> = {};

  try {
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const value = match[index + 1];
      if (key && value !== undefined) params[key] = decodeURIComponent(value);
    }
  } catch {
    return null;
  }

  return params;
}

function compilePath(path: string): Pick<CompiledRoute<never>, "pattern" | "keys" | "score"> {
  if (path === "/") {
    return { pattern: /^\/$/, keys: [], score: 1000 };
  }

  const keys: string[] = [];
  let score = 0;
  const segments = path.slice(1).split("/");

  const source = segments
    .map((segment) => {
      if (segment.startsWith(":")) {
        const key = segment.slice(1);
        if (!routeParameterName.test(key) || reservedRouteParameterNames.has(key)) {
          throw new Error(`Invalid route parameter :${key} in ${path}`);
        }
        if (keys.includes(key)) throw new Error(`Duplicate route parameter :${key} in ${path}`);
        keys.push(key);
        score += 10;
        return "([^/]+)";
      }

      score += 100;
      return escapeRegExp(segment);
    })
    .join("/");

  return {
    pattern: new RegExp(`^/${source}/?$`),
    keys,
    score: score + segments.length,
  };
}

function normalizePath(path: string): string {
  const pathname = path.split("?")[0] || "/";
  if (pathname === "/") return pathname;
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withLeadingSlash.replace(/\/{2,}/g, "/").replace(/\/$/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
