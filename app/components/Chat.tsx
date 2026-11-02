"use client";
import { FormEvent, useEffect, useRef, useState } from "react";

export interface Msg { role: "user" | "assistant" | "error"; text: string; actions?: string[] }

const SUGGESTIONS = ["Résume le projet", "Qu'est-ce qui a glissé par rapport au plan ?", "Qui est le plus chargé ?"];

export default function Chat({ projectName, msgs, busy, onSend }: {
  projectName: string; msgs: Msg[]; busy: boolean; onSend: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo(0, 1e6); }, [msgs, busy]);
  const submit = (e: FormEvent) => { e.preventDefault(); if (input.trim()) { onSend(input.trim()); setInput(""); } };

  return (
    <aside className="chat" aria-label="Assistant">
      <div className="head"><strong>Assistant</strong><div className="muted">{projectName}</div></div>
      <div className="log" ref={logRef} aria-live="polite">
        {msgs.length === 0 && <div className="msg assistant">Je connais le contexte de ce projet. Que voulez-vous faire ?</div>}
        {msgs.map((m, k) => (
          <div key={k} className={`msg ${m.role}`}>
            {m.text}
            {m.actions && m.actions.length > 0 && <div className="acts">{m.actions.map((a) => `✓ ${a}`).join("\n")}</div>}
          </div>
        ))}
        {busy && <div className="msg assistant muted">Je réfléchis…</div>}
      </div>
      {msgs.length === 0 && <div className="sugg">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => onSend(s)} disabled={busy}>{s}</button>)}</div>}
      <form onSubmit={submit}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Votre demande…" aria-label="Message à l'assistant" />
        <button className="btn primary" disabled={busy}>Envoyer</button>
      </form>
    </aside>
  );
}
