// #medicate
// n8n relay — the browser posts to the FastAPI backend (/agent/n8n/*), which
// forwards to N8N_WEBHOOK_URL with a 10 s timeout. The webhook URL never
// reaches the browser. Every call is non-blocking: failures show a toast and
// the game carries on.

import type { PatientCase } from '../game/types';
import type { ChatMessage } from '../voice/claude';
import { toast } from '../components/Toaster';

/** Backend times out n8n at 10 s; give the round trip a little headroom. */
const CLIENT_TIMEOUT_MS = 12_000;

export interface TranscriptLine {
  speaker: 'doctor' | 'patient';
  text: string;
}

export function toTranscriptLines(msgs: ReadonlyArray<ChatMessage>): TranscriptLine[] {
  return msgs
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ speaker: m.role === 'user' ? 'doctor' : 'patient', text: m.content }));
}

export function patientSummary(c: PatientCase, extra: Record<string, unknown> = {}) {
  return {
    case_id: c.id,
    name: c.name,
    age: c.age,
    gender: c.gender,
    chief_complaint: c.chiefComplaint,
    ...extra,
  };
}

async function post(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fire-and-forget: encounter finished and the attending grader returned. */
export function reportEncounterComplete(payload: {
  patient: Record<string, unknown>;
  transcript: TranscriptLine[];
  grader_output: unknown;
}): void {
  void post('/agent/n8n/encounter', payload).then((ok) => {
    if (!ok) toast("Couldn't send this encounter to n8n — your debrief is unaffected.", 'error');
  });
}

/** "Ask my tutor" — escalation with the last 6 transcript lines. */
export async function askTutor(payload: {
  patient: Record<string, unknown>;
  transcript: TranscriptLine[];
}): Promise<boolean> {
  const ok = await post('/agent/n8n/escalation', {
    patient: payload.patient,
    transcript: payload.transcript.slice(-6),
  });
  toast(ok ? 'Sent to your tutor.' : "Couldn't reach your tutor — keep going.", ok ? 'success' : 'error');
  return ok;
}
