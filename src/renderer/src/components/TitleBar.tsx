import { WindowControls } from "./WindowControls";

/**
 * The window's title-bar row (Windows hidden frame only). Full-width drag
 * region at the very top — the ActiveSessionsBar tab strip lives on its own
 * line BELOW this, so tabs can never overlap the window controls.
 *
 * macOS keeps native traffic lights (hiddenInset) and its own fixed
 * .drag-region strip — this component renders nothing there.
 */
export function TitleBar(): React.JSX.Element | null {
  if (window.electron?.process?.platform !== "win32") return null;

  return (
    <div className="title-bar">
      <div className="title-bar-drag" aria-hidden="true" />
      <WindowControls />
    </div>
  );
}
