import { useState, useEffect, useMemo } from "react";
import { X, Search, Check, Users } from "../assets/icons";
import ProfileAvatar from "./common/ProfileAvatar";
import { AppModal, AppModalTitle } from "./modal/AppModal";

interface ProfileItem {
  id: string;
  name: string;
  color?: string;
  avatar?: string | null;
  model?: string;
}

interface CreateGroupChatModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (groupName: string, memberIds: string[]) => void;
}

export function CreateGroupChatModal({
  open,
  onClose,
  onCreated,
}: CreateGroupChatModalProps): React.JSX.Element | null {
  const [profiles, setProfiles] = useState<ProfileItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setGroupName("");
      setQuery("");
      setSelectedIds(new Set());
      setError("");
      void window.hermesAPI
        .listProfiles()
        .then((list) => setProfiles(list))
        .catch(() => {});
    }
  }, [open]);

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return profiles;
    const q = query.toLowerCase();
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.model || "").toLowerCase().includes(q),
    );
  }, [profiles, query]);

  const placeholderName = useMemo(() => {
    const names = profiles
      .filter((p) => selectedIds.has(p.id))
      .map((p) => p.name);
    return names.length > 0 ? names.join(", ") : "Group Chat";
  }, [profiles, selectedIds]);

  const handleCreate = (): void => {
    if (selectedIds.size < 2) {
      setError("Pick at least 2 bots to start a group chat");
      return;
    }
    const finalName = groupName.trim() || placeholderName;
    setCreating(true);
    try {
      onCreated(finalName, Array.from(selectedIds));
      onClose();
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <AppModal
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      className="create-group-chat-modal"
      labelledBy="group-create-title"
    >
      <div className="group-modal-header">
        <div className="group-modal-title-row">
          <Users size={18} className="group-modal-icon" />
          <AppModalTitle id="group-create-title" className="group-modal-title">
            New Group Chat
          </AppModalTitle>
        </div>
        <button
          type="button"
          className="profile-modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      <div className="group-modal-body">
        <label className="group-field">
          <span className="group-field-label">Group Name (Optional)</span>
          <input
            type="text"
            className="input"
            placeholder={placeholderName}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            autoFocus
          />
        </label>

        <div className="group-members-section">
          <div className="group-members-header">
            <span>Select Bots ({selectedIds.size} selected)</span>
          </div>

          <div className="group-search-row">
            <Search size={13} className="group-search-icon" />
            <input
              type="text"
              className="input group-search-input"
              placeholder="Search bots…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="group-bots-list">
            {filtered.map((p) => {
              const isChecked = selectedIds.has(p.id);
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  className={`group-bot-item ${isChecked ? "checked" : ""}`}
                  onClick={() => toggleSelect(p.id)}
                >
                  <ProfileAvatar
                    name={p.id}
                    color={p.color}
                    avatar={p.avatar}
                    size={28}
                  />
                  <div className="group-bot-item-info">
                    <span className="group-bot-item-name">{p.name}</span>
                    <span className="group-bot-item-sub">@{p.id}</span>
                  </div>
                  <div
                    className={`group-bot-checkbox ${isChecked ? "active" : ""}`}
                  >
                    {isChecked && <Check size={12} />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {error && <div className="agents-create-error">{error}</div>}

        <div className="group-modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={selectedIds.size < 2 || creating}
          >
            {creating ? "Creating…" : `Create Group (${selectedIds.size})`}
          </button>
        </div>
      </div>
    </AppModal>
  );
}
