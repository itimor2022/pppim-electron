export const getDisplayMemberCount = (memberCount?: number, ex?: string) => {
  const realMemberCount = memberCount ?? 0;
  try {
    const extra = (ex ? JSON.parse(ex) : {}) as Record<string, unknown>;
    const displayMemberCount = Number(extra?.displayMemberCount);
    if (Number.isFinite(displayMemberCount) && displayMemberCount > 0) {
      const displayMemberCountBase = Number(extra?.displayMemberCountBase);
      if (Number.isFinite(displayMemberCountBase) && displayMemberCountBase >= 0) {
        return Math.max(
          0,
          Math.trunc(displayMemberCount + realMemberCount - displayMemberCountBase),
        );
      }
      return Math.trunc(displayMemberCount);
    }
  } catch (error) {
    return realMemberCount;
  }
  return realMemberCount;
};
