import { useSyncExternalStore } from "react";
import { getDB, subscribe } from "./db";
import type { DBShape } from "../types";

export function useDB(): DBShape {
  return useSyncExternalStore(subscribe, getDB, getDB);
}
