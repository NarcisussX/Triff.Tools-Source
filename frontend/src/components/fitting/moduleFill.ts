import type { CalculationResponse, FittingModule, FitMessage, SlotKey } from "./types";

export const FILLABLE_RACKS: SlotKey[] = ["high", "mid", "low", "rig"];

export function moduleForRackFill(module: FittingModule): FittingModule {
  const {
    id: _id,
    mutation,
    abyssalPlaceholder: _abyssalPlaceholder,
    placeholderReason: _placeholderReason,
    spoolType: _spoolType,
    spoolAmount: _spoolAmount,
    ...rest
  } = module;
  const baseTypeId = Number(mutation?.baseTypeId || module.typeId);
  return {
    ...rest,
    typeId: Number.isFinite(baseTypeId) && baseTypeId > 0 ? baseTypeId : module.typeId,
    typeName: mutation?.baseTypeName || module.typeName,
  };
}

function messageTargetsModule(message: FitMessage, module: FittingModule) {
  const text = String(message.message || "").toLowerCase();
  const name = String(module.typeName || "").toLowerCase();
  const detailsTypeId = Number((message as FitMessage & { details?: { typeId?: number } }).details?.typeId);
  return detailsTypeId === Number(module.typeId) || Boolean(name && text.includes(name));
}

export function rackFillBlocker(result: CalculationResponse, slot: SlotKey, module: FittingModule) {
  const messages = [...(result.errors || []), ...(result.warnings || [])];
  return messages.find((message) => {
    const code = String(message.code || "");
    const text = String(message.message || "").toLowerCase();
    if (code === "slot_over") return text.includes(slot) || text.includes(slot === "rig" ? "rig" : `${slot} slot`);
    if (code === "HARDPOINT_LIMIT_EXCEEDED") return slot === "high";
    if (code === "calibration_over") return slot === "rig";
    if (code === "INVALID_SUBSYSTEM") return false;
    if (code === "module_invalid" || code === "module_validation_failed") return messageTargetsModule(message, module);
    return false;
  }) || null;
}
