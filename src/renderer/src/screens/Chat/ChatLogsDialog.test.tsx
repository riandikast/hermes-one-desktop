import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatLogsDialog } from "./ChatLogsDialog";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

const mockErrorsLog = `2026-10-23 15:10:00 ERROR openai.InternalServerError: Error code: 503
  File "chat_completion_helpers.py", line 3083, in _open_chat_stream
2026-10-23 15:10:02 WARNING agent.conversation_loop: Retrying API call in 30.0s
2026-10-23 15:10:35 ERROR HTTP 403: Forbidden - request restricted`;

const mockAgentLog = `2026-10-23 15:14:19 INFO agent.conversation_loop: API call #41: model=ag/gemini-3.8-flash-high provider=9r in=183622 out=65 total=183687 latency=5.6s
2026-10-23 15:14:20 INFO agent.tool_executor: tool read_file completed (1.29s, 2518 chars)
2026-10-23 15:14:26 INFO agent.conversation_loop: API call #42: model=ag/gemini-3.8-flash-high provider=9r in=184717 out=292 total=185009 latency=6.1s
2026-10-23 15:14:30 INFO agent.tool_executor: tool search_files completed (4.14s, 4374 chars)
2026-10-23 15:14:35 WARNING agent.conversation_loop: Retrying API call in 5s (attempt 1/3) provider=9r model=test`;

beforeEach(() => {
  Object.assign(window, {
    hermesAPI: {
      readLogs: vi.fn(async (file: string) => {
        if (file === "errors.log") {
          return { content: mockErrorsLog, path: "C:/path/logs/errors.log" };
        }
        return { content: mockAgentLog, path: "C:/path/logs/agent.log" };
      }),
      copyToClipboard: vi.fn(async () => true),
    },
  });
});

describe("ChatLogsDialog", () => {
  it("renders both Crash & Errors and Request Log tabs", async () => {
    render(<ChatLogsDialog open={true} onClose={vi.fn()} />);

    expect(screen.getByRole("tab", { name: /Crash & Errors/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Request Log/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/InternalServerError: Error code: 503/i)).toBeInTheDocument();
    });
    expect(screen.getByText("C:/path/logs/errors.log")).toBeInTheDocument();
  });

  it("switches to Request Log tab and defaults to requests-only filter", async () => {
    render(<ChatLogsDialog open={true} onClose={vi.fn()} />);

    const requestTab = screen.getByRole("tab", { name: /Request Log/i });
    fireEvent.click(requestTab);

    // Requests-only filter is active by default:
    // API calls and retries should be visible
    await waitFor(() => {
      expect(screen.getByText(/API call #41/i)).toBeInTheDocument();
      expect(screen.getByText(/API call #42/i)).toBeInTheDocument();
    });
    // Normal tool execution lines should be filtered out
    expect(screen.queryByText(/tool read_file completed/i)).toBeNull();

    // Toggle requests-only off to show all lines
    const toggleChip = screen.getByRole("button", { name: /Requests only/i });
    fireEvent.click(toggleChip);

    await waitFor(() => {
      expect(screen.getByText(/tool read_file completed/i)).toBeInTheDocument();
    });
  });

  it("filters log lines with search query input", async () => {
    render(<ChatLogsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/InternalServerError/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Filter log entries/i);
    fireEvent.change(searchInput, { target: { value: "403" } });

    await waitFor(() => {
      expect(screen.getByText(/HTTP 403: Forbidden/i)).toBeInTheDocument();
      expect(screen.queryByText(/InternalServerError/i)).toBeNull();
    });
  });

  it("copies filtered lines to clipboard", async () => {
    render(<ChatLogsDialog open={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/InternalServerError/i)).toBeInTheDocument();
    });

    const copyBtn = screen.getByRole("button", { name: /Copy/i });
    fireEvent.click(copyBtn);

    expect(window.hermesAPI.copyToClipboard).toHaveBeenCalledWith(mockErrorsLog);
    await waitFor(() => {
      expect(screen.getByText(/Copied/i)).toBeInTheDocument();
    });
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<ChatLogsDialog open={true} onClose={onClose} />);

    const closeBtn = screen.getByLabelText(/Close/i);
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
