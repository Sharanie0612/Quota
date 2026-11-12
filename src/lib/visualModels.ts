import type { AiModelSnapshot, BenchmarkBoard, BenchmarkEdition, BenchmarkModel, BenchmarkProfile, LadderEntry, LadderSnapshot, ModelRelease } from "./types";
import { aaSource, aaVersion, profileBreakdown } from "./aaMethodology";

const configuration = /\s*\((?:non-reasoning|reasoning|minimal|low|medium|high|xhigh|max)(?:,\s*default fallback)?\)\s*$/i;
export const modelIdentity = (value: string) => value.replace(configuration, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const vendorIdentity = (value: string) => {
  const key = modelIdentity(value);
  return ({ zai: "zhipu", spacexai: "xai" } as Record<string, string>)[key] ?? key;
};

export function inEvaluationWindow(value: string | undefined, days: number, now = new Date()) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const age = (today - date.getTime()) / 86400000;
  return age >= 0 && age < days;
}

export type EvaluationScope = "main30" | "main" | "all30" | "all";
export interface VisualModel {
  entry: LadderEntry;
  profile: BenchmarkProfile;
  model: BenchmarkModel;
  release?: ModelRelease;
  edition?: BenchmarkEdition;
  breakdown: ReturnType<typeof profileBreakdown>;
}

export function filterVisualModels(models: VisualModel[], scope: EvaluationScope, now = new Date()) {
  return models.filter(model => {
    if (scope === "all") return true;
    if (model.profile.version !== model.edition?.version) return false;
    if (scope !== "main" && !inEvaluationWindow(model.edition?.publishedAt, 30, now)) return false;
    return scope === "all30" || !!model.edition?.primaryProfiles.includes(model.profile.id);
  });
}

export function rankVisualModels(models: VisualModel[], metric: string) {
  const ranked = models.filter(model => model.entry.rankings[metric] != null)
    .sort((a, b) => b.entry.rankings[metric].score - a.entry.rankings[metric].score || a.profile.name.localeCompare(b.profile.name) || a.profile.id.localeCompare(b.profile.id));
  let rank = 0;
  return ranked.map((model, index) => {
    const score = model.entry.rankings[metric].score;
    if (index === 0 || score !== ranked[index - 1].entry.rankings[metric].score) rank = index + 1;
    return { model, rank, score };
  });
}

export function visualModels(board: BenchmarkBoard, registry: AiModelSnapshot | null, legacy: LadderSnapshot | null): VisualModel[] {
  const source = board.sources.find(source => source.id === aaSource);
  const models = new Map(board.models.map(model => [model.id, model]));
  return board.profiles.flatMap(profile => {
    if (profile.sourceId !== aaSource || !aaVersion(profile.version) || !Number.isFinite(profile.index)
      || profile.index < 0 || profile.index > 100) return [];
    const model = models.get(profile.modelId);
    const result = model?.results.find(result => result.sourceId === aaSource && result.profileId === profile.id);
    if (!model || !result || modelIdentity(model.name) !== modelIdentity(profile.name)) return [];
    const key = modelIdentity(model.name);
    const vendor = vendorIdentity(profile.vendor);
    const same = (name: string, owner: string) => modelIdentity(name) === key && vendorIdentity(owner) === vendor;
    const official = registry?.models.find(model => model.available && !!model.verifiedAt
      && (same(model.name, model.vendor) || same(model.apiId, model.vendor)));
    const old = legacy?.entries.find(entry => same(entry.name, entry.vendor) && !!entry.verifiedAt);
    const release = board.releases?.find(release => release.id === key && vendorIdentity(release.vendor) === vendor);
    const edition = source?.edition?.version === profile.version ? source.edition : undefined;
    const breakdown = profileBreakdown(profile, model.observations);
    const rankings: LadderEntry["rankings"] = {
      general: { rank: 0, score: profile.index, source: result.url, updatedAt: source?.checkedAt ?? "" },
    };
    for (const [domain, score] of Object.entries(breakdown.scores)) {
      rankings[domain] = { rank: 0, score, source: result.url, updatedAt: source?.checkedAt ?? "" };
    }
    const price = official?.price ?? old?.price ?? { currency: "CNY", unit: "每百万 Tokens", input: null, output: null, note: null };
    const entry = {
      id: profile.id, name: profile.name, vendor: profile.vendor, provider: official?.provider ?? old?.provider ?? "",
      rankings, price, priceSource: official?.source ?? old?.priceSource ?? "",
      verifiedAt: official?.verifiedAt ?? old?.verifiedAt ?? null, releasedAt: release?.releasedAt ?? null,
    };
    return [{ entry, profile, model, release, edition, breakdown }];
  }).sort((a, b) => b.profile.index - a.profile.index || a.profile.id.localeCompare(b.profile.id));
}
