export const getDisplayMemberCount = (
  memberCount?: number,
  ex?: string,
) => {
  try {
    const extra = ex ? JSON.parse(ex) : {};
    const displayMemberCount = Number(extra?.displayMemberCount);
    return Number.isFinite(displayMemberCount) && displayMemberCount > 0
      ? displayMemberCount
      : memberCount ?? 0;
  } catch (error) {
    return memberCount ?? 0;
  }
};
