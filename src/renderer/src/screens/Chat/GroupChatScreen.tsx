import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Users, Bot } from "../../assets/icons";
import { ArrowLeft } from "lucide-react";
import ProfileAvatar from "../../components/common/ProfileAvatar";

interface GroupMessage {
  id: string;
  sender: string;
  senderName: string;
  text: string;
  timestamp: number;
}

interface GroupChatScreenProps {
  groupId: string;
  groupName: string;
  memberIds: string[];
  onBack?: () => void;
}

export function GroupChatScreen({
  groupId,
  groupName,
  memberIds,
  onBack,
}: GroupChatScreenProps): React.JSX.Element {
  const [messages, setMessages] = useState<GroupMessage[]>(() => {
    try {
      const stored = localStorage.getItem(`hermes.groupChat.log.${groupId}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState("");
  const [isResponding, setIsResponding] = useState(false);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(
        `hermes.groupChat.log.${groupId}`,
        JSON.stringify(messages),
      );
    } catch {}
  }, [groupId, messages]);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || isResponding) return;

    const userMsg: GroupMessage = {
      id: `msg-${Date.now()}-user`,
      sender: "user",
      senderName: "You",
      text,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setDraft("");
    setIsResponding(true);

    try {
      // Broadcast sequentially to group member bots
      for (const botId of memberIds) {
        try {
          const res = await window.hermesAPI.sendMessage(
            text,
            botId,
          );

          if (res?.response) {
            const botMsg: GroupMessage = {
              id: `msg-${Date.now()}-${botId}`,
              sender: botId,
              senderName: botId.replace(/^9r-/, "").replace(/-/g, " "),
              text: res.response,
              timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, botMsg]);
          }
        } catch {
          // If a bot fails to respond, continue with next member
        }
      }
    } finally {
      setIsResponding(false);
    }
  }, [draft, isResponding, memberIds]);

  return (
    <div className="group-workspace-root">
      {/* ── Header ── */}
      <div className="group-workspace-header">
        <div className="group-header-left">
          {onBack && (
            <button
              type="button"
              className="btn-ghost group-back-btn"
              onClick={onBack}
              title="Back"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="group-avatar-stack">
            <div className="group-icon-circle">
              <Users size={18} />
            </div>
          </div>
          <div className="group-title-col">
            <h2 className="group-header-title">{groupName}</h2>
            <div className="group-members-subtitle">
              {memberIds.map((id) => (
                <span key={id} className="group-member-tag">
                  @{id}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Message Log ── */}
      <div className="group-workspace-log">
        {messages.length === 0 ? (
          <div className="group-log-empty">
            <Users size={36} className="group-empty-icon" />
            <h3>Welcome to #{groupName}</h3>
            <p>
              Send a prompt to start a multi-bot collaborative discussion between{" "}
              {memberIds.map((m) => `@${m}`).join(", ")}.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.sender === "user";
            return (
              <div
                key={m.id}
                className={`group-message-row ${isUser ? "user" : "bot"}`}
              >
                <div className="group-msg-avatar">
                  {isUser ? (
                    <div className="group-user-avatar">You</div>
                  ) : (
                    <ProfileAvatar name={m.sender} size={30} />
                  )}
                </div>
                <div className="group-msg-bubble-wrap">
                  <div className="group-msg-author-row">
                    <span className="group-msg-author">{m.senderName}</span>
                    <span className="group-msg-time">
                      {new Date(m.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="group-msg-text">{m.text}</div>
                </div>
              </div>
            );
          })
        )}
        {isResponding && (
          <div className="group-message-row bot thinking">
            <div className="group-msg-avatar">
              <Bot size={24} />
            </div>
            <div className="group-msg-bubble-wrap">
              <span className="group-msg-author">Bots responding…</span>
              <div className="group-typing-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}
        <div ref={scrollEndRef} />
      </div>

      {/* ── Composer ── */}
      <div className="group-workspace-composer">
        <textarea
          className="group-composer-textarea"
          placeholder={`Message #${groupName}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          rows={1}
        />
        <button
          type="button"
          className="btn btn-primary group-composer-send"
          onClick={() => void handleSend()}
          disabled={!draft.trim() || isResponding}
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
