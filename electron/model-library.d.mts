import type {
  ModelOption,
  ModelLibrary,
  Session,
  Settings,
} from "../src/types";
export const DEFAULT_MODEL: string;
export function modelPresets(baseUrl?: string): ModelOption[];
export function validateModel(input: {
  id: string;
  name?: string;
}): ModelOption;
export function createModelLibrary(
  state: {
    settings: Settings;
    sessions: Session[];
    modelLibraries?: Record<string, ModelLibrary>;
  },
  save?: () => void,
): {
  list(): ModelOption[];
  add(baseUrl: string, input: { id: string; name?: string }): void;
  selectDefault(baseUrl: string, id: string): void;
  remove(baseUrl: string, id: string): void;
  switchProvider(baseUrl: string): void;
};
