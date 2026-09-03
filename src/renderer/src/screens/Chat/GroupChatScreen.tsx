import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Users, Bot, X, Check } from "../../assets/icons";
import { ArrowLeft, ImagePlus } from "lucide-react";
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
  initialAvatar?: string | null;
  onBack?: () => void;
  onGroupNameChange?: (newName: string) => void;
  onGroupImageChange?: (dataUrl: string | null) => void;
}

const GROUP_META_KEY = "hermes.groupChat.meta";

function loadGroupMeta(): Record<string, { name?: string; image?: string | null }> {
  try {
    return JSON.parse(localStorage.getItem(GROUP_META_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveGroupMeta(meta: Record<string, { name?: string; image?: string | null }>): void {
  try {
    localStorage.setItem(GROUP_META_KEY, JSON.stringify(meta));
  } catch {}
}

export function GroupChatScreen({
  groupId,
  groupName,
  memberIds,
  initialAvatar,
  onBack,
  onGroupNameChange,
  onGroupImageChange,
}: GroupChatScreenProps): React.JSX.Element {
  const [meta, setMeta] = useState(() => loadGroupMeta()[groupId] || { image: initialAvatar });
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
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(groupName);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  const currentName = meta.name || groupName;

  const handleRename = useCallback(() => {
    if (!newName.trim()) return;
    const updatedMeta = { ...meta, name: newName.trim() };
    setMeta(updatedMeta);
    const allMeta = loadGroupMeta();
    allMeta[groupId] = updatedMeta;
    saveGroupMeta(allMeta);
    setEditingName(false);
    onGroupNameChange?.(newName.trim());
  }, [meta, newName, groupId, onGroupNameChange]);

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const updatedMeta = { ...meta, image: dataUrl };
        setMeta(updatedMeta);
        const allMeta = loadGroupMeta();
        allMeta[groupId] = updatedMeta;
        saveGroupMeta(allMeta);
        onGroupImageChange?.(dataUrl);
      };
      reader.readAsDataURL(file);
    },
    [meta, groupId, onGroupImageChange],
  );

  const handleRemoveImage = useCallback(() => {
    const updatedMeta = { ...meta, image: null };
    setMeta(updatedMeta);
    const allMeta = loadGroupMeta();
    allMeta[groupId] = updatedMeta;
    saveGroupMeta(allMeta);
    onGroupImageChange?.(null);
  }, [meta, groupId, onGroupImageChange]);

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
      for (const botId of memberIds) {
        try {
          const res = await window.hermesAPI.sendMessage(text, botId);
          if (res?.response) {
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}-${botId}`,
                sender: botId,
                senderName: botId.replace(/^9r-/, "").replace(/-/g, " "),
                text: res.response,
                timestamp: Date.now(),
              },
            ]);
          }
        } catch (err) {
          setMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}-${botId}-err`,
              sender: botId,
              senderName: botId.replace(/^9r-/, "").replace(/-/g, " "),
              text: `⚠️ Error: ${(err as Error).message || "Bot did not respond"}`,
              timestamp: Date.now(),
            },
          ]);
        }
      }
    } finally {
      setIsResponding(false);
    }
  }, [draft, isResponding, memberIds]);

  return (
    <div className="group-workspace-root">
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />

      {/* ── Header ── */}
      <div className="group-workspace-header">
        <div className="group-header-left">
          {onBack && (
            <button type="button" className="btn-ghost group-back-btn" onClick={onBack} title="Back">
              <ArrowLeft size={16} />
            </button>
          )}
          <button type="button" className="group-avatar-btn" onClick={() => fileInputRef.current?.click()}>
            {meta.image ? (
              <img src={meta.image} alt={currentName} className="group-header-image" />
            ) : (
              <div className="group-icon-circle">
                <Users size={18} />
              </div>
            )}
          </button>
          <div className="group-title-col">
            {editingName ? (
              <div className="group-rename-row">
                <input
                  className="input group-rename-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  autoFocus
                />
                <button type="button" className="btn btn-primary btn-sm" onClick={handleRename}>
                  <Check size={13} />
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingName(false)}>
                  <X size={13} />
                </button>
              </div>
            ) : (
              <h2
                className="group-header-title group-header-editable"
                onClick={() => {
                  setNewName(currentName);
                  setEditingName(true);
                }}
                title="Click to rename"
              >
                {currentName}
              </h2>
            )}
            <div className="group-members-subtitle">
              {memberIds.map((id) => (
                <span key={id} className="group-member-tag">@{id}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="group-header-actions">
          <button
            type="button"
            className="btn-ghost group-settings-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Change group image"
          >
            <ImagePlus size={16} />
          </button>
          {meta.image && (
            <button type="button" className="btn-ghost group-settings-btn" onClick={handleRemoveImage} title="Remove image">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* ── Message Log ── */}
      <div className="group-workspace-log">
        {messages.length === 0 ? (
          <div className="group-log-empty">
            <Users size={36} className="group-empty-icon" />
            <h3>Welcome to #{currentName}</h3>
            <p>Send a prompt to start a multi-bot collaborative discussion between {memberIds.map((m) => `@${m}`).join(", ")}.</p>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.sender === "user";
            return (
              <div key={m.id} className={`group-message-row ${isUser ? "user" : "bot"}`}>
                <div className="group-msg-avatar">
                  {!isUser && <ProfileAvatar name={m.sender} size={30} />}
                </div>
                <div className="group-msg-bubble-wrap">
                  <div className="group-msg-author-row">
                    <span className="group-msg-author">{isUser ? "You" : m.senderName}</span>
                    <span className="group-msg-time">
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
                <span /><span /><span />
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
          placeholder={`Message #${currentName}…`}
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
