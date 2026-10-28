export type TriffMonRequiredSkillTarget = {
  skillTypeId: number;
  targetLevel: number;
};

export function parseTriffMonRequiredSkills(value: string | null | undefined): TriffMonRequiredSkillTarget[] {
  if (!value) return [];
  const targets = new Map<number, number>();
  value.split(",").forEach((part) => {
    const [rawTypeId, rawLevel] = part.trim().split(":");
    const skillTypeId = Number(rawTypeId);
    const targetLevel = Number(rawLevel);
    if (!Number.isSafeInteger(skillTypeId) || skillTypeId <= 0) return;
    if (!Number.isSafeInteger(targetLevel) || targetLevel < 1 || targetLevel > 5) return;
    targets.set(skillTypeId, Math.max(targets.get(skillTypeId) ?? 0, targetLevel));
  });
  return [...targets.entries()].map(([skillTypeId, targetLevel]) => ({ skillTypeId, targetLevel }));
}

export function buildTriffMonRequirementsUrl(input: {
  typeId?: number | null;
  requiredSkills?: TriffMonRequiredSkillTarget[];
  label?: string | null;
}): string {
  const query = new URLSearchParams();
  if (input.typeId && Number.isSafeInteger(input.typeId) && input.typeId > 0) query.set("type_id", String(input.typeId));
  const normalized = input.requiredSkills
    ?.filter((skill) => Number.isSafeInteger(skill.skillTypeId) && skill.skillTypeId > 0 && Number.isSafeInteger(skill.targetLevel) && skill.targetLevel >= 1 && skill.targetLevel <= 5)
    .map((skill) => `${skill.skillTypeId}:${skill.targetLevel}`)
    .join(",");
  if (normalized) query.set("skills", normalized);
  if (input.label?.trim()) query.set("label", input.label.trim().slice(0, 160));
  const suffix = query.toString();
  return `/skillnix/requirements${suffix ? `?${suffix}` : ""}`;
}
