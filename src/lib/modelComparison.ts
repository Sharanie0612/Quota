import { compareNames } from "./ladderModels";
import type { TaskCostModel } from "./types";

export const latestModelCount = 30;

export interface ModelFamily {
  id: string;
  name: string;
  creator: string;
  releaseDate: string | null;
  configurations: TaskCostModel[];
  preferred: TaskCostModel;
}

export function modelFamiliesForComparison(models: TaskCostModel[]): ModelFamily[] {
  const groups = new Map<string, TaskCostModel[]>();
  for (const model of models) {
    const id = JSON.stringify([model.creator.trim().toLowerCase(), (model.modelName || model.name).trim().toLowerCase()]);
    const entries = groups.get(id) ?? [];
    entries.push(model);
    groups.set(id, entries);
  }
  return [...groups].map(([id, entries]) => {
    // Use a whole reported configuration so the score and cost always agree.
    entries.sort((a, b) => Number(b.costPerTask !== null) - Number(a.costPerTask !== null)
      || b.index - a.index || (a.costPerTask ?? 0) - (b.costPerTask ?? 0)
      || compareNames(a.name, b.name) || a.id.localeCompare(b.id));
    const preferred = entries[0];
    const dates = entries.flatMap(model => model.releaseDate ? [model.releaseDate] : []).sort();
    return {
      id,
      name: preferred.modelName || preferred.name,
      creator: preferred.creator,
      releaseDate: dates[0] ?? null,
      configurations: entries,
      preferred,
    };
  }).sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "")
    || compareNames(a.name, b.name) || compareNames(a.creator, b.creator) || a.id.localeCompare(b.id));
}

export interface ComparisonSelection {
  included: string[];
  excluded: string[];
  configurations: Record<string, string>;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1200;
}

export function restoreComparison(raw: string | null): ComparisonSelection {
  const next: ComparisonSelection = { included: [], excluded: [], configurations: {} };
  try {
    const value = JSON.parse(raw ?? "null");
    if (Array.isArray(value?.included)) next.included = [...new Set<string>(value.included.filter(validId))];
    if (Array.isArray(value?.excluded)) next.excluded = [...new Set<string>(value.excluded.filter(validId))];
    if (value?.configurations && typeof value.configurations === "object") {
      next.configurations = Object.fromEntries(Object.entries(value.configurations)
        .filter((entry): entry is [string, string] => validId(entry[0]) && validId(entry[1])));
    }
  } catch { /* Use the default selection if preferences are not readable. */ }
  return next;
}

export function selectedComparison(families: ModelFamily[], selection: ComparisonSelection) {
  const defaults = new Set(families.filter(model => model.releaseDate !== null).slice(0, latestModelCount).map(model => model.id));
  const included = new Set(selection.included);
  const excluded = new Set(selection.excluded);
  return {
    defaults,
    selected: families.filter(model => included.has(model.id) || defaults.has(model.id) && !excluded.has(model.id)),
  };
}

export function selectedConfiguration(family: ModelFamily, selection: ComparisonSelection) {
  return family.configurations.find(model => model.id === selection.configurations[family.id]) ?? family.preferred;
}

export function matchesModel(family: ModelFamily, search: string, creator: string) {
  const query = search.trim().toLowerCase();
  return (!creator || family.creator === creator)
    && (!query || family.creator.toLowerCase().includes(query)
      || family.configurations.some(model => model.name.toLowerCase().includes(query)));
}

export function configurationLabel(model: TaskCostModel) {
  return model.name.startsWith(model.modelName + " (") && model.name.endsWith(")")
    ? model.name.slice(model.modelName.length + 2, -1)
    : model.name;
}
