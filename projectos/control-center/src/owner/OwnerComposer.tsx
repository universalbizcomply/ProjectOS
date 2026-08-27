/**
 * The composer — README §Screens 2, pinned to the bottom of the canvas.
 *
 * This is Owner Chat's input, moved. Enter sends, Shift+Enter starts a new line, any format can be
 * attached, and each attachment shows as a removable chip with its name and size. The mic is wired
 * to real speech-to-text where the platform provides it and is visibly unavailable where it does
 * not — see `speech.ts`.
 */
import { useEffect, useRef } from 'react';
import type { OwnerConversation } from './ownerConversation';
import { useVoiceInput } from './speech';
import { IconClose, IconFile, IconMic, IconPaperclip, IconSend } from './icons';

export function OwnerComposer({ conversation }: { conversation: OwnerConversation }) {
  const { draft, setDraft, files, addFiles, removeFile, send, canSend, placeholder } = conversation;
  const area = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceInput((text) => setDraft(draft === '' ? text : `${draft} ${text}`));

  // Auto-grow, bounded by the max-height the design gives the field.
  useEffect(() => {
    const el = area.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  return (
    <div className="os-composerdock">
      <div className="os-composerwrap">
        {files.length > 0 && (
          <div className="os-chips">
            {files.map((f) => (
              <span className="os-chip" key={f.id}>
                <IconFile />
                <span className="os-chip-name">{f.name}</span>
                <span className="os-chip-size">{f.size}</span>
                <button type="button" onClick={() => removeFile(f.id)} aria-label={`Remove ${f.name}`}>
                  <IconClose size={13} width={1.8} />
                </button>
              </span>
            ))}
          </div>
        )}

        {voice.listening && (
          <div className="os-listening" role="status">
            <span className="os-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
            <span className="t">Listening — just say what you want.</span>
            <button type="button" className="os-sec" onClick={voice.stop}>Done</button>
          </div>
        )}

        <div className="os-composer os-glass os-hud">
          <label className="os-vh" htmlFor="os-composer-field">Message ProjectOS</label>
          <textarea
            id="os-composer-field"
            ref={area}
            rows={1}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <label className="os-iconbtn" title="Attach a file — any format">
            <span className="os-vh">Attach a file — any format</span>
            <input
              type="file"
              multiple
              className="os-vh"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <IconPaperclip />
          </label>
          <button
            type="button"
            className={`os-iconbtn${voice.listening ? ' on' : ''}`}
            onClick={voice.toggle}
            disabled={!voice.supported}
            aria-label={voice.supported ? 'Talk instead of typing' : voice.unavailableReason}
            title={voice.supported ? 'Talk instead of typing' : voice.unavailableReason}
          >
            <IconMic />
          </button>
          <button
            type="button"
            className="os-pri os-sendbtn"
            onClick={send}
            disabled={!canSend}
            aria-label="Send"
          >
            <IconSend />
          </button>
        </div>
        <p className="os-composernote">
          Type, talk, or drop in a file of any kind. Nothing goes live, gets sent or gets paid without
          your yes.
        </p>
        {!voice.supported && (
          <p className="os-composernote" role="note">{voice.unavailableReason}</p>
        )}
      </div>
    </div>
  );
}
