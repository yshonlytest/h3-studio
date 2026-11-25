export type StoreListener<S> = (state: Readonly<S>, prevState: Readonly<S>) => void;

export interface CreateStoreOptions<S extends Record<string, unknown>> {
  opaqueKeys?: ReadonlyArray<keyof S>;
}

export interface Store<S extends Record<string, unknown>> {
  getState: () => Readonly<S>;
  setState: (patchOrUpdater: Partial<S> | ((prev: Readonly<S>) => S)) => void;
  select: <T>(selector: (state: Readonly<S>) => T) => T;
  subscribe: (listener: StoreListener<S>) => () => void;
  reset: () => void;
}

function isUnsupportedBuiltin(value: object): boolean {
  return (
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

function freezeDomainValue(value: unknown, path: string, seen: WeakSet<object>): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return value;
  }
  if (typeof value === "function") {
    throw new TypeError(`Unsupported function in store domain state at "${path}". Declare it in opaqueKeys if it is a runtime handle.`);
  }
  const obj = value as object;
  if (isUnsupportedBuiltin(obj)) {
    const typeName = obj.constructor?.name || typeof obj;
    throw new TypeError(
      `Unsupported mutable built-in "${typeName}" in store domain state at "${path}". Use plain objects/arrays or declare an opaqueKey.`
    );
  }
  if (seen.has(obj)) {
    throw new TypeError(`Circular reference in store domain state at "${path}".`);
  }
  seen.add(obj);

  try {
    if (Array.isArray(obj)) {
      const clonedArr = obj.map((item, idx) => freezeDomainValue(item, `${path}[${idx}]`, seen));
      return Object.freeze(clonedArr);
    }

    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      const typeName = obj.constructor?.name || "Object";
      throw new TypeError(
        `Unsupported non-plain object "${typeName}" in store domain state at "${path}". Declare it in opaqueKeys if it is a runtime handle.`
      );
    }

    const clonedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      clonedObj[k] = freezeDomainValue(v, `${path}.${k}`, seen);
    }
    return Object.freeze(clonedObj);
  } finally {
    seen.delete(obj);
  }
}

function freezeStoreState<S extends Record<string, unknown>>(
  rawState: S,
  opaqueKeySet: ReadonlySet<string>
): S {
  if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
    throw new TypeError("Store state must be a plain object.");
  }
  const frozenRoot: Record<string, unknown> = {};
  for (const key of Object.keys(rawState)) {
    const val = rawState[key];
    if (opaqueKeySet.has(key)) {
      frozenRoot[key] = val;
    } else {
      frozenRoot[key] = freezeDomainValue(val, key, new WeakSet<object>());
    }
  }
  return Object.freeze(frozenRoot) as S;
}

export function createStore<S extends Record<string, unknown>>(
  initialFactory: () => S,
  options?: CreateStoreOptions<S>
): Store<S> {
  const opaqueKeySet = new Set<string>((options?.opaqueKeys || []).map((k) => String(k)));
  let state: S = freezeStoreState(initialFactory(), opaqueKeySet);
  const listeners = new Set<StoreListener<S>>();

  function notify(prevState: S): void {
    listeners.forEach((listener) => {
      listener(state, prevState);
    });
  }

  return {
    getState(): Readonly<S> {
      return state;
    },

    setState(patchOrUpdater): void {
      const prevState = state;
      const candidate =
        typeof patchOrUpdater === "function"
          ? patchOrUpdater(prevState)
          : ({ ...prevState, ...patchOrUpdater } as S);
      state = freezeStoreState(candidate, opaqueKeySet);
      notify(prevState);
    },

    select<T>(selector: (current: Readonly<S>) => T): T {
      return selector(state);
    },

    subscribe(listener: StoreListener<S>): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    reset(): void {
      const prevState = state;
      state = freezeStoreState(initialFactory(), opaqueKeySet);
      notify(prevState);
    },
  };
}
