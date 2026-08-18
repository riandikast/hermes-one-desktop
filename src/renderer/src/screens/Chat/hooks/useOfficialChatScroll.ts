import { useStickToBottom, type GetTargetScrollTop } from "use-stick-to-bottom";

export const SCROLL_TARGET_EPSILON_PX = 0.5;

export const resolveOfficialScrollTarget: GetTargetScrollTop = (
  targetScrollTop,
  { scrollElement },
) => {
  const remaining = targetScrollTop - scrollElement.scrollTop;
  return remaining >= 0 && remaining <= SCROLL_TARGET_EPSILON_PX
    ? scrollElement.scrollTop
    : targetScrollTop;
};

export function useOfficialChatScroll() {
  return useStickToBottom({
    initial: "instant",
    resize: "instant",
    targetScrollTop: resolveOfficialScrollTarget,
  });
}

type ScrollMetrics = Pick<
  HTMLElement,
  "scrollTop" | "scrollHeight" | "clientHeight"
>;

export function isOfficialScrollAtBottom(
  scrollElement: ScrollMetrics,
  tolerance = 60,
): boolean {
  return (
    scrollElement.scrollHeight -
      scrollElement.scrollTop -
      scrollElement.clientHeight <
    tolerance
  );
}

export function jumpOfficialScrollToBottom(
  scrollElement: ScrollMetrics,
): void {
  scrollElement.scrollTop = scrollElement.scrollHeight;
}

export default useOfficialChatScroll;
