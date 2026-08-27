/**
 * The one conversation behind both the workspace composer and the dashboard's COMMAND CHAT plate.
 *
 * SAME MODEL, NEW PLACEMENT. Answers still come from `answerOwnerQuestion` — deterministic, offline,
 * built only from the project's own governed state. There is no AI model, no network and no metered
 * API here, and moving the input to the bottom of the workspace changed none of that. A suggested
 * governed command still comes from `matchActionIntent` and is still never dispatched by itself.
 *
 * ATTACHMENTS ARE NAMED, NOT READ. A file the owner drops in is listed by name and size in the
 * message that goes out. Nothing in this renderer opens it, uploads it or sends it anywhere: saying
 * "I have read your spreadsheet" would be the exact class of claim this product exists to prevent.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OWNER_MODELS, PROJECTOS_V3 } from './ownerSnapshot';
import { answerOwnerQuestion } from './ownerChatModel';
import { matchActionIntent, type ChatAction } from './ownerChatActions';
import { ownerModelFromGoverned } from './governedOwnerModel';
import { useGovernedProjects, useGovernedRun, useGovernedState } from '../daemon/DaemonProvider';
import type { OwnerControlModel } from './ownerModel';

export interface Attachment {
  readonly id: string;
  readonly name: string;
  readonly size: string;
}

export interface ConversationTurn {
  readonly id: number;
  readonly role: 'you' | 'os';
  readonly text: string;
  readonly fileLine: string | null;
  readonly action?: ChatAction;
}

/** How long the projection keeps articulating after a reply. README §Interactions. */
const SPEAKING_MS = 3200;

function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface OwnerConversation {
  readonly turns: readonly ConversationTurn[];
  readonly draft: string;
  readonly setDraft: (next: string) => void;
  readonly files: readonly Attachment[];
  readonly addFiles: (list: FileList | null) => void;
  readonly removeFile: (id: string) => void;
  readonly send: () => void;
  readonly canSend: boolean;
  readonly speaking: boolean;
  readonly placeholder: string;
}

export function useOwnerConversation(): OwnerConversation {
  const inventory = useGovernedProjects();
  const projectId = inventory?.selectedProjectId ?? PROJECTOS_V3.projectId;
  const governed = useGovernedState();
  const live = governed !== null && governed.connected ? governed : null;
  const run = useGovernedRun();

  const model: OwnerControlModel = useMemo(
    () =>
      live !== null
        ? ownerModelFromGoverned(live)
        : (OWNER_MODELS.find((m) => m.projectId === projectId) ?? PROJECTOS_V3),
    [live, projectId],
  );

  const [turns, setTurns] = useState<readonly ConversationTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<readonly Attachment[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const nextId = useRef(1);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // WHAT THE ANSWERS CAME FROM. An answer is only true of the state it was built from, so when the
  // source changes underneath the thread — the runtime connects, or the project is switched — the
  // thread is cleared rather than left as stale claims about a project this is no longer describing.
  // Same discipline as the panel this composer replaces.
  const sourceKey = live !== null ? `live:${model.projectId}` : `recorded:${projectId}`;
  const [answeredFrom, setAnsweredFrom] = useState(sourceKey);
  if (answeredFrom !== sourceKey) {
    setAnsweredFrom(sourceKey);
    nextId.current = 1;
    setTurns([]);
  }

  useEffect(() => () => {
    if (speakTimer.current !== null) clearTimeout(speakTimer.current);
  }, []);

  const addFiles = useCallback((list: FileList | null) => {
    const picked = Array.from(list ?? []).map((f) => ({
      id: `f${Math.random().toString(36).slice(2)}`,
      name: f.name,
      size: sizeOf(f.size),
    }));
    if (picked.length > 0) setFiles((prev) => [...prev, ...picked]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const canSend = draft.trim() !== '' || files.length > 0;

  const send = useCallback(() => {
    const text = draft.trim();
    if (text === '' && files.length === 0) return;
    const fileLine = files.length > 0 ? files.map((f) => f.name).join(', ') : null;
    const question = text === '' ? 'Have a look at this.' : text;

    const answer = answerOwnerQuestion(model, question, live?.gatekeeperStatus ?? null);
    const action = live !== null ? (matchActionIntent(question, live, run.active) ?? undefined) : undefined;

    const you: ConversationTurn = { id: nextId.current++, role: 'you', text: question, fileLine };
    const os: ConversationTurn = {
      id: nextId.current++,
      role: 'os',
      // FILES ARE NAMED, NEVER CLAIMED AS READ.
      text:
        fileLine !== null
          ? `${answer.answer}\n\nI have noted ${files.length === 1 ? 'the file' : `${files.length} files`} you attached by name. Nothing here opens or sends them.`
          : answer.answer,
      fileLine: null,
      action,
    };
    setTurns((prev) => [...prev, you, os]);
    setDraft('');
    setFiles([]);
    setSpeaking(true);
    if (speakTimer.current !== null) clearTimeout(speakTimer.current);
    speakTimer.current = setTimeout(() => setSpeaking(false), SPEAKING_MS);
  }, [draft, files, live, model, run.active]);

  const placeholder =
    live === null || live.phases.length === 0
      ? 'Tell it what you want, in your own words…'
      : 'Ask for a change, or ask what is going on…';

  return { turns, draft, setDraft, files, addFiles, removeFile, send, canSend, speaking, placeholder };
}
